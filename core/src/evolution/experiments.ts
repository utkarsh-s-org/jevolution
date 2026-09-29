/** Opt-in mechanisms. Seconds and energy remain illustrative simulation units, not field calibration. */
export interface Experiments {
  demographics: boolean;
  resources: boolean;
  decisions: boolean;
  researchClock: boolean;
  communication: boolean;
  goal: 'individual' | 'lineage';
  immigration: 'closed' | 'boundary';
}
export const BASELINE_EXPERIMENTS: Experiments = {
  demographics: false,
  resources: false,
  decisions: false,
  researchClock: false,
  communication: true,
  immigration: 'closed',
  goal: 'lineage',
};
export function validateExperiments(input: unknown): Experiments {
  if (input === undefined) return { ...BASELINE_EXPERIMENTS };
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid mechanism settings.');
  const result = { ...BASELINE_EXPERIMENTS };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(result, key)) throw new Error(`Unknown mechanism: ${key}`);
    if (key === 'goal') {
      if (value !== 'individual' && value !== 'lineage') throw new Error('Invalid objective');
      result.goal = value;
    } else if (key === 'immigration') {
      if (value !== 'closed' && value !== 'boundary') throw new Error('Invalid immigration mode.');
      result.immigration = value;
    } else {
      if (typeof value !== 'boolean') throw new Error(`Expected boolean for ${key}`);
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
export const LIFE = {
  rabbit: { gestation: 12, litter: 3, dependent: 6, maturity: 24, lifespan: 480, childEnergy: 12 },
  wolf: { gestation: 24, litter: 2, dependent: 12, maturity: 45, lifespan: 720, childEnergy: 25 },
} as const;
