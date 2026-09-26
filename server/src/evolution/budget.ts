import type {
  ModelGroup,
  ModelObservation,
  Result,
  World,
} from '../../../core/src/evolution/types.js';
import { INSTRUCTIONS } from './models.js';

// Existing arena prices, scoped to exact known models. Unknown prices are never zero.
export function price(group: ModelGroup): { input: number; output: number } | undefined {
  if (group.provider === 'typesafe' && group.model === 'jev-1.13.0')
    return { input: 0.042, output: 0 };
  if (group.provider === 'anthropic' && group.model === 'claude-haiku-4-5-20251001')
    return { input: 1, output: 5 };
  return undefined;
}
export class RunBudget {
  validate(groups: ModelGroup[]) {
    if (groups.some((g) => g.controller !== 'deterministic' && !price(g)))
      throw new Error('A dollar limit requires models with known arena pricing.');
  }
  estimateCost(world: World): number | null {
    const groups = world.groups.filter((g) => g.controller !== 'deterministic');
    if (!groups.every((g) => !!price(g))) return null;
    return groups.reduce((sum, group) => {
      const rates = price(group)!;
      const stats = world.stats[group.id];
      return sum + (stats.inputTokens * rates.input + stats.outputTokens * rates.output) / 1e6;
    }, 0);
  }
  charged = 0;
  private reservations = new Map<string, number>();
  get exposure() {
    return this.charged + [...this.reservations.values()].reduce((a, b) => a + b, 0);
  }
  reserve(id: string, group: ModelGroup, observation: ModelObservation, cap?: number) {
    if (cap === undefined) return true;
    const rates = price(group);
    if (!rates) throw new Error('A dollar limit requires a model with known arena pricing.');
    // Conservative upper allowance: UTF-8 bytes of twice the observation plus prompt/tool
    // overhead, and the adapter's maximum output. Interrupted calls retain reservations.
    const input =
      2 * Buffer.byteLength(JSON.stringify(observation)) +
      2 * Buffer.byteLength(INSTRUCTIONS) +
      8192;
    const reserve = (input * rates.input + 512 * rates.output) / 1e6;
    if (this.exposure + reserve > cap) return false;
    this.reservations.set(id, reserve);
    return true;
  }
  settle(id: string, group: ModelGroup, result: Result) {
    const rates = price(group);
    if (!rates) return;
    this.reservations.delete(id);
    this.charged += (result.inputTokens * rates.input + result.outputTokens * rates.output) / 1e6;
  }
}
