// Pins how mechanism switches change model instructions. Switching demographics or resources on
// replaces the prompt wholesale, so on/off comparisons change instructions as well as rules.
import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { BASELINE_EXPERIMENTS } from '../../../core/src/evolution/experiments.js';
import { instructionsFor } from './models.js';

const pp = { predatorPrey: true, relief: false };

test('baseline switches leave the original predator–prey prompts untouched', () => {
  for (const wolf of [false, true])
    assert.equal(
      instructionsFor(wolf, { ...pp, experiments: { ...BASELINE_EXPERIMENTS } }),
      instructionsFor(wolf, pp),
    );
});

test('communication off only appends a disabled-signals notice', () => {
  const base = instructionsFor(false, pp);
  const off = instructionsFor(false, {
    ...pp,
    experiments: { ...BASELINE_EXPERIMENTS, communication: false },
  });
  assert.ok(off.startsWith(base));
  assert.match(off.slice(base.length), /Communication is disabled/);
});

test('demographics and resources replace the prompt rather than extend it', () => {
  const base = instructionsFor(false, pp);
  for (const on of [{ demographics: true }, { resources: true }]) {
    const prompt = instructionsFor(false, {
      ...pp,
      experiments: { ...BASELINE_EXPERIMENTS, ...on },
    });
    assert.ok(!prompt.includes(base));
  }
  assert.match(
    instructionsFor(false, { ...pp, experiments: { ...BASELINE_EXPERIMENTS, demographics: true } }),
    /never happens alone/,
  );
});

test('decisions adds the chosen objective and lets wolves signal', () => {
  const lineage = instructionsFor(true, {
    ...pp,
    experiments: { ...BASELINE_EXPERIMENTS, decisions: true, goal: 'lineage' },
  });
  const individual = instructionsFor(true, {
    ...pp,
    experiments: { ...BASELINE_EXPERIMENTS, decisions: true, goal: 'individual' },
  });
  assert.match(lineage, /sustain your local lineage/);
  assert.match(individual, /prioritize your own survival/);
  assert.match(lineage, /Wolves can signal/);
  assert.doesNotMatch(instructionsFor(true, pp), /Wolves can signal/);
});
