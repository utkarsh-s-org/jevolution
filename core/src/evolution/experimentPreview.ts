import { DEFAULT_GROUPS, PREDATOR_PREY_GROUPS, rulesFor } from './constants.js';
import type { ModelGroup, Scenario } from './types.js';

// Legacy preview records remain unapplied. Active defaults preserve the selected preset.
export const EXPERIMENT_GROUPS = [
  {
    name: 'Communication',
    controls: [
      {
        key: 'signalRange',
        label: 'Signal range',
        min: 1,
        max: 30,
        step: 1,
        initial: 8,
        unit: 'tiles',
        help: 'Maximum range; sociability scales range from 37.5% to 100%.',
      },
      {
        key: 'signalDelay',
        label: 'Delivery delay',
        min: 0,
        max: 5000,
        step: 100,
        initial: 200,
        unit: 'ms',
        help: 'Time between sending and receiving.',
      },
      {
        key: 'messageLoss',
        label: 'Message loss',
        min: 0,
        max: 100,
        step: 5,
        initial: 0,
        unit: '%',
        help: 'Share of messages that never arrive.',
      },
      {
        key: 'signalCost',
        label: 'Signal energy cost',
        min: 0,
        max: 10,
        step: 0.1,
        initial: 0.6,
        unit: 'energy',
        help: 'Base energy per message, multiplied by 1 + sociability.',
      },
    ],
  },
  {
    name: 'Resources',
    controls: [
      {
        key: 'foodAbundance',
        label: 'Food abundance',
        min: 0,
        max: 200,
        step: 10,
        initial: 100,
        unit: '%',
        help: 'Food supply relative to the baseline.',
      },
      {
        key: 'foodClustering',
        label: 'Food clustering',
        min: 0,
        max: 100,
        step: 5,
        initial: 50,
        unit: '%',
        help: 'Scattered food at 0%; concentrated patches at 100%.',
      },
      {
        key: 'foodRegrowth',
        label: 'Food regrowth',
        min: 0,
        max: 200,
        step: 10,
        initial: 100,
        unit: '%',
        help: 'Recovery rate of depleted food patches.',
      },
    ],
  },
  {
    name: 'Environment',
    controls: [
      {
        key: 'temperature',
        label: 'Temperature',
        min: -10,
        max: 45,
        step: 1,
        initial: 20,
        unit: '°C',
        help: 'Toy model: cold raises metabolism; heat raises thirst; extremes slow food growth.',
      },
      {
        key: 'disasterFrequency',
        label: 'Drought frequency',
        min: 0,
        max: 12,
        step: 1,
        initial: 0,
        unit: '/hour',
        help: 'Regular 60-second droughts per simulation hour. Zero disables automatic droughts.',
      },
      {
        key: 'disasterSeverity',
        label: 'Drought strength',
        min: 0,
        max: 200,
        step: 5,
        initial: 100,
        unit: '%',
        help: '100% keeps the scenario’s drought. 0% removes growth loss and withering; 200% stops regrowth and doubles withering.',
      },
      {
        key: 'disasterArea',
        label: 'Affected area',
        min: 5,
        max: 100,
        step: 5,
        initial: 100,
        unit: '%',
        help: 'Share of habitat affected by each drought.',
      },
    ],
  },
  {
    name: 'Predator pressure',
    controls: [
      {
        key: 'wolfCount',
        label: 'Wolf count',
        min: 0,
        max: 20,
        step: 1,
        initial: 10,
        unit: 'wolves',
        help: 'Starting wolves, distributed across configured wolf groups.',
      },
      {
        key: 'wolfSpeed',
        label: 'Wolf speed',
        min: 25,
        max: 200,
        step: 5,
        initial: 100,
        unit: '%',
        help: 'Movement speed relative to the baseline.',
      },
      {
        key: 'wolfVision',
        label: 'Wolf vision',
        min: 1,
        max: 30,
        step: 1,
        initial: 10,
        unit: 'tiles',
        help: 'Distance at which a wolf could detect prey.',
      },
    ],
  },
  {
    name: 'Inheritance',
    controls: [
      {
        key: 'mutationRate',
        label: 'Mutation probability',
        min: 0,
        max: 100,
        step: 5,
        initial: 100,
        unit: '%',
        help: 'Chance of mutating each inherited trait at birth.',
      },
      {
        key: 'traitDiversity',
        label: 'Starting trait diversity',
        min: 0,
        max: 100,
        step: 5,
        initial: 50,
        unit: '%',
        help: 'Spread of founder traits, from uniform to varied.',
      },
    ],
  },
] as const;

export type ExperimentKey = (typeof EXPERIMENT_GROUPS)[number]['controls'][number]['key'];
export interface ExperimentPreview {
  mode: 'active' | 'preview-only';
  appliedToSimulation: boolean;
  values: Record<ExperimentKey, number>;
}
export function defaultExperimentPreview(
  scenario: Scenario = 'arena',
  groups: readonly ModelGroup[] = scenario === 'predatorPrey'
    ? PREDATOR_PREY_GROUPS
    : DEFAULT_GROUPS,
): ExperimentPreview {
  return {
    mode: 'active',
    appliedToSimulation: true,
    values: {
      ...(Object.fromEntries(
        EXPERIMENT_GROUPS.flatMap((g) => g.controls.map((c) => [c.key, c.initial])),
      ) as Record<ExperimentKey, number>),
      wolfVision: rulesFor({ scenario }).wolfSight,
      wolfCount: groups
        .filter((g) => g.species === 'wolf')
        .reduce((n, g) => n + (g.population || 0), 0),
    },
  };
}
export function validateExperimentPreview(input: unknown): ExperimentPreview | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object') throw new Error('Invalid experiment preview.');
  const data = input as Partial<ExperimentPreview>;
  if (
    !['active', 'preview-only'].includes(data.mode || '') ||
    data.appliedToSimulation !== (data.mode === 'active') ||
    !data.values
  )
    throw new Error('Invalid experiment mode.');
  const result = {
    ...defaultExperimentPreview(),
    mode: data.mode!,
    appliedToSimulation: data.appliedToSimulation!,
  };
  for (const group of EXPERIMENT_GROUPS)
    for (const c of group.controls) {
      const value = data.values[c.key];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < c.min ||
        value > c.max ||
        Math.abs((value - c.min) / c.step - Math.round((value - c.min) / c.step)) > 1e-8
      )
        throw new Error(`Invalid experiment preview value: ${c.key}`);
      result.values[c.key] = value;
    }
  return result;
}
