import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_GROUPS,
  PREDATOR_PREY_GROUPS,
  PREDATOR_PREY_RULES,
  RULES,
  rulesFor,
} from './constants.js';
import { configureExperiments } from './demographics.js';
import { defaultExperimentPreview, validateExperimentPreview } from './experimentPreview.js';
import { BASELINE_EXPERIMENTS } from './experiments.js';
import { applyDecision, observe, stepWorld } from './simulation.js';
import { createWorld } from './world.js';

for (const scenario of ['arena', 'predatorPrey'] as const) {
  const groups = scenario === 'predatorPrey' ? PREDATOR_PREY_GROUPS : DEFAULT_GROUPS;
  test(`${scenario}: active defaults preserve every rule, seeded tile, founder and random state`, () => {
    const defaults = defaultExperimentPreview(scenario, groups);
    for (const seed of [123, 8675309]) {
      const baseline = createWorld(seed, groups, scenario);
      const active = createWorld(seed, groups, scenario, defaults);
      assert.deepEqual(rulesFor(active), rulesFor(baseline));
      assert.deepEqual({ ...active, experiment: undefined }, baseline);
      assert.equal(defaults.values.wolfCount, baseline.wolves.length);
    }
  });
  test(`${scenario}: neutral communication and full-area drought preserve the seeded trajectory`, () => {
    const baseline = createWorld(123, groups, scenario);
    const active = createWorld(123, groups, scenario, defaultExperimentPreview(scenario, groups));
    for (const signal of ['food', 'follow', 'danger', 'help'] as const) {
      for (const w of [baseline, active]) {
        const rabbit = w.rabbits[0];
        const choices = observe(w, rabbit).choices;
        assert.ok(applyDecision(w, rabbit, { choice: 'rest', signal }, choices));
      }
      assert.deepEqual({ ...active, experiment: undefined }, baseline);
    }
    baseline.droughtUntil = active.droughtUntil = 60;
    for (let frame = 0; frame < 40; frame++) {
      stepWorld(baseline, 0.05);
      stepWorld(active, 0.05);
    }
    assert.deepEqual({ ...active, experiment: undefined }, baseline);
  });
  test(`${scenario}: changing only communication leaves predator and drought rules intact`, () => {
    const experiment = defaultExperimentPreview(scenario, groups);
    experiment.values.signalDelay = 1500;
    const changed = rulesFor({ scenario, experiment });
    const base = rulesFor({ scenario });
    assert.deepEqual(changed, { ...base, signalDelay: 1.5 });
    assert.equal(changed.droughtRegrowth, 0.0064);
    assert.equal(changed.droughtWither, 0.025);
    assert.equal(changed.wolfSight, scenario === 'predatorPrey' ? 9 : 10);
  });
}

test('drought strength is relative to each preset and food regrowth scales both rates', () => {
  for (const scenario of ['arena', 'predatorPrey'] as const) {
    const experiment = defaultExperimentPreview(scenario);
    const base = scenario === 'predatorPrey' ? PREDATOR_PREY_RULES : RULES;
    experiment.values.disasterSeverity = 0;
    assert.equal(rulesFor({ scenario, experiment }).droughtRegrowth, base.foodRegrowth);
    assert.equal(rulesFor({ scenario, experiment }).droughtWither, 0);
    experiment.values.disasterSeverity = 100;
    experiment.values.foodRegrowth = 200;
    assert.equal(rulesFor({ scenario, experiment }).foodRegrowth, base.foodRegrowth * 2);
    assert.equal(rulesFor({ scenario, experiment }).droughtRegrowth, base.droughtRegrowth * 2);
    experiment.values.disasterSeverity = 200;
    assert.equal(rulesFor({ scenario, experiment }).droughtRegrowth, 0);
    assert.equal(rulesFor({ scenario, experiment }).droughtWither, base.droughtWither * 2);
  }
});

test('default mutation preserves offspring genes and random sequence', () => {
  const baseline = createWorld(123, PREDATOR_PREY_GROUPS, 'predatorPrey');
  const active = createWorld(
    123,
    PREDATOR_PREY_GROUPS,
    'predatorPrey',
    defaultExperimentPreview('predatorPrey'),
  );
  for (const w of [baseline, active]) {
    w.wolves = [];
    for (const rabbit of w.rabbits) {
      rabbit.energy = rabbit.water = 100;
      rabbit.age = 60;
      rabbit.cooldown = 0;
      rabbit.action = 'rest';
    }
    stepWorld(w, 0.05);
  }
  assert.ok(baseline.rabbits.some((rabbit) => rabbit.generation > 0));
  assert.deepEqual({ ...active, experiment: undefined }, baseline);
});

function world(values: Record<string, number> = {}) {
  const e = defaultExperimentPreview();
  Object.assign(e.values, values);
  return createWorld(123, DEFAULT_GROUPS, 'arena', validateExperimentPreview(e));
}
test('temperature changes physiology and growth; food sliders change supply and distribution', () => {
  const normal = world(),
    hot = world({ temperature: 40 }),
    cold = world({ temperature: 0 });
  assert.ok(rulesFor(hot).thirst > rulesFor(normal).thirst);
  assert.ok(rulesFor(cold).baseMetabolism > rulesFor(normal).baseMetabolism);
  assert.ok(rulesFor(cold).wolfMetabolism > rulesFor(normal).wolfMetabolism);
  assert.ok(rulesFor(hot).foodRegrowth < rulesFor(normal).foodRegrowth);
  assert.equal(
    world({ foodAbundance: 0 }).tiles.reduce((n, t) => n + t.food, 0),
    0,
  );
  const dispersed = world({ foodClustering: 0 }),
    clustered = world({ foodClustering: 100 });
  assert.ok(
    dispersed.tiles.filter((t) => t.food > 0).length >
      clustered.tiles.filter((t) => t.food > 0).length,
  );
  assert.equal(rulesFor(world({ foodRegrowth: 0 })).foodRegrowth, 0);
  assert.ok(
    world({ traitDiversity: 0 }).rabbits.every((r) =>
      Object.values(r.genes).every((v) => v === 0.5),
    ),
  );
});
test('signal delay, range, cost and loss affect emitted messages', () => {
  const w = world({ signalDelay: 2000, signalRange: 20, signalCost: 2, messageLoss: 0 });
  const r = w.rabbits[0];
  const before = r.energy;
  assert.ok(applyDecision(w, r, { choice: 'rest', signal: 'danger' }, observe(w, r).choices));
  assert.equal(w.signals[0].delivered, 2);
  assert.ok(w.signals[0].range >= 7.5);
  assert.ok(r.energy < before - 2);
  const lost = world({ messageLoss: 100 });
  const a = lost.rabbits[0];
  applyDecision(lost, a, { choice: 'rest', signal: 'food' }, observe(lost, a).choices);
  assert.equal(lost.signals.length, 0);
});
test('scheduled drought has bounded area and severity; predators use configured speed and sight', () => {
  const w = world({
    disasterFrequency: 12,
    disasterArea: 25,
    disasterSeverity: 200,
    wolfSpeed: 200,
    wolfVision: 2,
  });
  w.time = 299.99;
  stepWorld(w, 0.05);
  assert.ok(w.droughtUntil > w.time);
  assert.equal(w.droughtTiles?.length, 1024);
  assert.equal(rulesFor(w).droughtRegrowth, 0);
  assert.equal(rulesFor(w).wolfSight, 2);
  assert.equal(rulesFor(w).wolfSpeed, rulesFor(world()).wolfSpeed * 2);
  const off = world({ disasterFrequency: 0 });
  off.time = 301;
  stepWorld(off, 0.05);
  assert.equal(off.droughtUntil, 0);
});

test('mutation zero preserves identical parental traits across births', () => {
  const w = world({ mutationRate: 0, traitDiversity: 0 });
  // Use the automatic single-parent preset to isolate inheritance from model choices.
  w.scenario = 'predatorPrey';
  w.wolves = [];
  for (const r of w.rabbits) {
    r.energy = 100;
    r.water = 100;
    r.cooldown = 0;
    r.age = 60;
    r.action = 'rest';
  }
  stepWorld(w, 0.05);
  const children = w.rabbits.filter((r) => r.generation > 0);
  assert.ok(children.length > 0);
  assert.ok(children.every((r) => Object.values(r.genes).every((g) => g === 0.5)));
});

test('neutral environmental controls preserve opt-in mechanism rules and seeded trajectories', () => {
  for (const scenario of ['arena', 'predatorPrey'] as const) {
    const groups = scenario === 'predatorPrey' ? PREDATOR_PREY_GROUPS : DEFAULT_GROUPS;
    for (const switches of [
      { resources: true },
      { demographics: true },
      { decisions: true },
      { resources: true, demographics: true, decisions: true },
    ]) {
      const baseline = createWorld(123, groups, scenario);
      const active = createWorld(123, groups, scenario, defaultExperimentPreview(scenario, groups));
      for (const w of [baseline, active]) {
        configureExperiments(w, { ...BASELINE_EXPERIMENTS, ...switches });
        w.droughtUntil = 60;
      }
      assert.deepEqual(rulesFor(active), rulesFor(baseline));
      for (let frame = 0; frame < 20; frame++) {
        stepWorld(baseline, 0.05);
        stepWorld(active, 0.05);
      }
      assert.deepEqual({ ...active, experiment: undefined }, baseline);
    }
  }
});

test('environmental sliders scale the selected resource mechanism instead of restoring preset rules', () => {
  const experiment = defaultExperimentPreview('predatorPrey');
  const experiments = { ...BASELINE_EXPERIMENTS, resources: true, demographics: true };
  const baseline = rulesFor({ scenario: 'predatorPrey', experiments });
  experiment.values.foodRegrowth = 200;
  experiment.values.disasterSeverity = 200;
  const changed = rulesFor({ scenario: 'predatorPrey', experiment, experiments });
  assert.deepEqual(changed, {
    ...baseline,
    foodRegrowth: baseline.foodRegrowth * 2,
    droughtRegrowth: 0,
    droughtWither: baseline.droughtWither * 2,
  });
});
