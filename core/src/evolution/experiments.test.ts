import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_GROUPS, rulesFor } from './constants.js';
import { defaultExperimentPreview, validateExperimentPreview } from './experimentPreview.js';
import { applyDecision, observe, stepWorld } from './simulation.js';
import { createWorld } from './world.js';
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
    disasterSeverity: 100,
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
