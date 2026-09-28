// All provider responses in this file are transport fixtures, never model-quality evidence.
import * as assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_CONFIG,
  DEFAULT_GROUPS,
  MODEL_PRESETS,
  PROVIDER_KEYS,
  rulesFor,
  SCENARIO_CONFIG,
  validateGroups,
} from '../../../core/src/evolution/constants.js';
import {
  defaultExperimentPreview,
  validateExperimentPreview,
} from '../../../core/src/evolution/experimentPreview.js';
import { applyDecision, observe, stepWorld } from '../../../core/src/evolution/simulation.js';
import type { ModelGroup, Provider, Snapshot } from '../../../core/src/evolution/types.js';
import { createWorld } from '../../../core/src/evolution/world.js';
import { choose, INSTRUCTIONS, ProviderError } from './models.js';
import { ReplayStore } from './replay.js';
import { ArenaRuntime } from './runtime.js';

function roster(n: number): ModelGroup[] {
  return Array.from({ length: n }, (_, i) => ({
    ...MODEL_PRESETS[i % MODEL_PRESETS.length],
    id: `team-${i}`,
    color: i,
    delayMs: 0,
  }));
}
test('resetting untouched settings or changing only timing preserves either scenario baseline', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'arena-baseline-'));
  const runtime = new ArenaRuntime(directory);
  try {
    for (const scenario of ['arena', 'predatorPrey'] as const) {
      const config = { ...SCENARIO_CONFIG[scenario] };
      const groups = DEFAULT_GROUPS.map((g) => ({
        ...g,
        population: g.species === 'wolf' ? 6 : g.population,
      }));
      runtime.reset(123, config, groups);
      const baseline = structuredClone(runtime.world);
      runtime.reset(123, { ...config, deadlineMs: 1500 }, groups);
      assert.deepEqual(runtime.world, baseline);
      const experimentPreview = defaultExperimentPreview(scenario, runtime.world.groups);
      // Living population must not become the starting population when settings are opened.
      runtime.world.wolves.splice(0, 2);
      runtime.reset(123, { ...config, experimentPreview }, groups);
      assert.deepEqual({ ...runtime.world, experiment: undefined }, baseline);
      assert.deepEqual(rulesFor(runtime.world), rulesFor(baseline));
    }
  } finally {
    runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('preview controls survive snapshots and replay without changing the seeded world or observations', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'arena-preview-'));
  const runtime = new ArenaRuntime(directory);
  try {
    runtime.reset(123, { ...DEFAULT_CONFIG });
    const baseline = structuredClone(runtime.world);
    const observation = observe(runtime.world, runtime.world.rabbits[0]);
    const preview = {
      ...defaultExperimentPreview(),
      mode: 'preview-only' as const,
      appliedToSimulation: false,
    };
    preview.values.temperature = 40;
    preview.values.messageLoss = 95;
    runtime.reset(123, { ...DEFAULT_CONFIG, experimentPreview: preview });
    assert.deepEqual({ ...runtime.world, experiment: undefined }, baseline);
    assert.deepEqual(observe(runtime.world, runtime.world.rabbits[0]), observation);
    assert.deepEqual(runtime.snapshot().status.config.experimentPreview, preview);
    assert.deepEqual(runtime.replay.get(0).status.config.experimentPreview, preview);
    assert.equal(runtime.snapshot().world.seed, 123);
    const runId = runtime.runId;
    assert.throws(() =>
      runtime.reset(321, {
        ...DEFAULT_CONFIG,
        experimentPreview: { ...preview, appliedToSimulation: true } as never,
      }),
    );
    assert.equal(runtime.runId, runId);
    assert.throws(() =>
      validateExperimentPreview({ ...preview, values: { ...preview.values, messageLoss: 101 } }),
    );
  } finally {
    runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(provider: Provider, choice = 'rest') {
  const decision = { choice, signal: 'none' };
  if (provider === 'typesafe')
    return {
      answers: { action: { choice }, signal: { choice: 'none' } },
      usage: { input_tokens: 10, output_tokens: 2 },
    };
  if (provider === 'anthropic')
    return {
      content: [{ type: 'tool_use', name: 'choose_action', input: decision }],
      usage: { input_tokens: 10, output_tokens: 2 },
    };
  if (provider === 'openai')
    return {
      output: [
        { type: 'function_call', name: 'choose_action', arguments: JSON.stringify(decision) },
      ],
      usage: { input_tokens: 10, output_tokens: 2 },
    };
  return {
    candidates: [
      { content: { parts: [{ functionCall: { name: 'choose_action', args: decision } }] } },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, thoughtsTokenCount: 1 },
  };
}
test('1–6 rabbit groups share the fixed budget, matched gene prefixes, independent stats, and histories', () => {
  for (let n = 1; n <= 6; n++) {
    const groups = roster(n),
      world = createWorld(42, groups),
      each = Math.floor(80 / n);
    assert.equal(world.rabbits.length, 80);
    for (const [i, g] of groups.entries()) {
      const count = each + (i < 80 % n ? 1 : 0);
      assert.equal(world.rabbits.filter((r) => r.lineage === g.id).length, count);
      assert.equal(world.history[0].populations[g.id], count);
    }
    for (let i = 0; i < each; i++)
      for (let j = 1; j < n; j++)
        assert.deepEqual(world.rabbits[i * n].genes, world.rabbits[i * n + j].genes);
    groups[0].label = 'changed outside world';
    assert.notEqual(world.groups[0].label, groups[0].label);
    world.stats['team-0'].births++;
    if (n > 1) assert.equal(world.stats['team-1'].births, 0);
    stepWorld(world, 2);
    assert.deepEqual(
      Object.keys(world.history.at(-1)!.populations),
      world.groups.map((g) => g.id),
    );
  }
});
test('model roster rejects duplicate IDs/colors, unsafe IDs, unknown providers and invalid delays', () => {
  for (const groups of [
    [],
    roster(7),
    [{ ...DEFAULT_GROUPS[0], id: '__proto__' }],
    [{ ...DEFAULT_GROUPS[0], provider: 'constructor' }],
    [{ ...DEFAULT_GROUPS[0], delayMs: -1 }],
    [...DEFAULT_GROUPS, { ...DEFAULT_GROUPS[0] }],
    [...DEFAULT_GROUPS, { ...DEFAULT_GROUPS[0], id: 'new' }],
  ])
    assert.throws(() => validateGroups(groups));
});
test('follow counters count accepted opportunities, not forced reactions or invalid decisions', () => {
  const world = createWorld(42),
    r = world.rabbits[0];
  const choices = [
    { id: 'rest', action: 'rest' as const, description: 'Rest' },
    { id: 'follow', action: 'follow' as const, description: 'Follow', followId: -1 },
  ];
  assert.ok(applyDecision(world, r, { choice: 'rest', signal: 'none' }, choices));
  assert.deepEqual(r.behavior, { offered: 1, followed: 0, other: 1 });
  assert.ok(!applyDecision(world, r, { choice: 'follow', signal: 'none' }, choices));
  assert.deepEqual(world.stats[r.lineage].behavior, r.behavior);
});
test('all provider adapters send the same observation and validate returned legal actions', async (t) => {
  const world = createWorld(42);
  const o = JSON.parse(JSON.stringify(observe(world, world.rabbits[0])));
  const previous = Object.fromEntries(Object.values(PROVIDER_KEYS).map((k) => [k, process.env[k]]));
  try {
    for (const provider of Object.keys(PROVIDER_KEYS) as Provider[]) {
      process.env[PROVIDER_KEYS[provider]] = 'fixture-key';
      let payload: Record<string, unknown> = {};
      let url = '';
      const mock = t.mock.method(
        globalThis,
        'fetch',
        async (input: string | URL | Request, init?: RequestInit) => {
          url = String(input);
          payload = JSON.parse(String(init?.body));
          assert.equal(init?.signal instanceof AbortSignal, true);
          assert.ok(!url.includes('fixture-key'));
          return new Response(JSON.stringify(fixture(provider)), { status: 200 });
        },
      );
      const g = {
        ...DEFAULT_GROUPS[0],
        provider,
        model: provider === 'openai' ? 'gpt-5.6-luna' : 'test-model',
      };
      const result = await choose(g, o, new AbortController().signal);
      assert.equal(result.decision.choice, 'rest');
      const native = JSON.parse(result.nativeResponse!.json);
      assert.equal(result.nativeResponse!.truncated, false);
      assert.equal('usage' in native, false);
      if (provider === 'typesafe')
        assert.deepEqual(native, { action: { choice: 'rest' }, signal: { choice: 'none' } });
      else if (provider === 'openai')
        assert.equal(native.arguments, JSON.stringify({ choice: 'rest', signal: 'none' }));
      else if (provider === 'anthropic')
        assert.deepEqual(native.input, { choice: 'rest', signal: 'none' });
      else assert.deepEqual(native.args, { choice: 'rest', signal: 'none' });
      assert.equal(result.inputTokens, 10);
      assert.equal(result.outputTokens, 2);
      if (provider === 'typesafe') assert.deepEqual(payload.state, o);
      else if (provider === 'openai') {
        assert.equal(payload.instructions, INSTRUCTIONS);
        assert.deepEqual(JSON.parse(payload.input as string), o);
        assert.equal(url, 'https://api.openai.com/v1/responses');
      } else if (provider === 'anthropic') {
        assert.equal(payload.system, INSTRUCTIONS);
        assert.deepEqual(JSON.parse((payload.messages as { content: string }[])[0].content), o);
      } else
        assert.deepEqual(
          JSON.parse((payload.contents as { parts: { text: string }[] }[])[0].parts[0].text),
          o,
        );
      mock.mock.restore();
      const bad = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response(JSON.stringify(fixture(provider, 'invented_action'))),
      );
      await assert.rejects(choose(g, o, new AbortController().signal), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.match(error.message, /invalid choice/);
        assert.match(error.nativeResponse!.json, /invented_action/);
        assert.ok(error.latencyMs! >= 0);
        return true;
      });
      bad.mock.restore();
    }
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
test('replay reconstructs exact frames across disk chunks without changing live state', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'arena-replay-test-'));
  const runtime = new ArenaRuntime(dir);
  const store = new ReplayStore(dir, 'replay-fixture');
  const expected = new Map<number, Snapshot>();
  const times: number[] = [];
  try {
    runtime.world = createWorld(42, roster(4));
    for (let i = 0; i < 205; i++) {
      if (i === 20) runtime.world.rabbits.splice(4, 1);
      if (i === 21) runtime.world.rabbits[0].target = { x: 20, y: 20 };
      if (i === 22) delete runtime.world.rabbits[0].target;
      runtime.world.stats['team-0'].latencies.push(i + 1);
      stepWorld(runtime.world, 0.05);
      const snapshot = runtime.snapshot();
      if ([0, 1, 20, 21, 22, 98, 99, 100, 101, 199, 200, 204].includes(i))
        expected.set(i, JSON.parse(JSON.stringify(snapshot)));
      const before = performance.now();
      store.capture(snapshot);
      times.push(performance.now() - before);
    }
    store.flush();
    for (const [i, snapshot] of expected) assert.deepEqual(store.get(i), snapshot, `Frame ${i}`);
    const f = store.get(20);
    f.world.rabbits[0].energy = -999;
    assert.notEqual(store.get(20).world.rabbits[0].energy, -999);
    assert.equal(store.frames, 205);
    assert.equal(store.error, undefined);
    assert.throws(() => store.get(-1));
    assert.throws(() => store.get(205));
    assert.ok(readdirSync(path.join(dir, 'replay-fixture.replay')).includes('100.json.gz'));
    console.log(
      `Replay capture p95: ${times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)].toFixed(1)} ms`,
    );
  } finally {
    runtime.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('runtime schedules arbitrary groups, freezes roster during a run and respects the global request cap', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'arena-runtime-test-'));
  const saved = Object.fromEntries(Object.values(PROVIDER_KEYS).map((k) => [k, process.env[k]]));
  const calls: string[] = [];
  const fake = t.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      calls.push(payload.model || String(url));
      const provider: Provider = String(url).includes('anthropic')
        ? 'anthropic'
        : String(url).includes('openai')
          ? 'openai'
          : String(url).includes('googleapis')
            ? 'google'
            : 'typesafe';
      return new Response(JSON.stringify(fixture(provider)));
    },
  );
  const runtime = new ArenaRuntime(dir);
  try {
    for (const key of Object.values(PROVIDER_KEYS)) process.env[key] = 'fixture-key';
    const groups = roster(4);
    runtime.reset(42, { ...DEFAULT_CONFIG, maxRequests: 8, maxInFlight: 1 }, groups);
    runtime.start();
    groups[0].model = 'mutated';
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.ok(calls.length <= 8);
    assert.ok(calls.length >= 4);
    for (const group of runtime.world.groups)
      assert.ok(runtime.world.stats[group.id].requested >= 1, group.id);
    assert.notEqual(runtime.world.groups[0].model, 'mutated');
    assert.ok(runtime.replay.frames > 2);
    runtime.pause();
    const state = JSON.stringify(runtime.world);
    runtime.replay.get(0);
    assert.equal(JSON.stringify(runtime.world), state);
    assert.equal(runtime.running, false);
  } finally {
    runtime.dispose();
    fake.mock.restore();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('decision feed exposes actual returns before the timing hold and replay never sees future JSON', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'arena-decisions-test-'));
  const runtime = new ArenaRuntime(dir);
  // Drive one dispatch explicitly, keeping this transport fixture independent of scheduler timing.
  const internal = runtime as unknown as {
    tickTimer: ReturnType<typeof setInterval>;
    dispatch: (animal: (typeof runtime.world.rabbits)[number]) => Promise<void>;
  };
  clearInterval(internal.tickTimer);
  const key = PROVIDER_KEYS[runtime.world.groups[0].provider];
  const saved = process.env[key];
  process.env[key] = 'fixture-key';
  let resolveResponse!: (value: Response) => void;
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const mock = t.mock.method(globalThis, 'fetch', () => response);
  const states: string[] = [];
  const rabbit = runtime.world.rabbits[0];
  const unsubscribe = runtime.decisions.subscribe(() =>
    states.push(runtime.decisions.get(rabbit.id)[0]?.state),
  );
  try {
    runtime.config = { ...DEFAULT_CONFIG, timing: 'equalized', equalizedMs: 150 };
    runtime.running = true;
    const pending = internal.dispatch(rabbit);
    assert.equal(runtime.decisions.get(rabbit.id)[0].state, 'requesting');
    runtime.replay.capture(runtime.snapshot());
    const waitingFrame = runtime.replay.frames - 1;
    resolveResponse(new Response(JSON.stringify(fixture(runtime.world.groups[0].provider))));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const returned = runtime.decisions.get(rabbit.id)[0];
    assert.equal(returned.state, 'returned');
    assert.deepEqual(returned.decision, { choice: 'rest', signal: 'none' });
    assert.equal(runtime.world.stats[rabbit.lineage].applied, 0);
    assert.ok(returned.latencyMs! < 150);
    assert.equal(runtime.replay.get(waitingFrame).decisions?.[rabbit.id][0].decision, undefined);
    await pending;
    const applied = runtime.decisions.get(rabbit.id)[0];
    assert.equal(applied.state, 'applied');
    assert.ok(applied.effectiveMs! >= 140);
    assert.equal(applied.latencyMs, returned.latencyMs);
    assert.deepEqual(applied.nativeResponse, returned.nativeResponse);
    assert.ok(applied.nativeResponse?.json);
    assert.equal(
      runtime.replay.get(waitingFrame).decisions?.[rabbit.id][0].nativeResponse,
      undefined,
    );
    assert.deepEqual(states, ['requesting', 'returned', 'applied']);
    runtime.pause();
    assert.equal(
      runtime.replay.get(runtime.replay.frames - 1).decisions?.[rabbit.id][0].state,
      'applied',
    );
    assert.deepEqual(
      runtime.replay.get(runtime.replay.frames - 1).decisions?.[rabbit.id][0].nativeResponse,
      applied.nativeResponse,
    );
    runtime.reset(43, DEFAULT_CONFIG, runtime.world.groups);
    assert.deepEqual(runtime.snapshot().decisions, {});
  } finally {
    unsubscribe();
    runtime.dispose();
    mock.mock.restore();
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('decision feed distinguishes late, cancelled, and failed responses', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'arena-decision-outcomes-'));
  const runtime = new ArenaRuntime(dir);
  const internal = runtime as unknown as {
    tickTimer: ReturnType<typeof setInterval>;
    dispatch: (animal: (typeof runtime.world.rabbits)[number]) => Promise<void>;
  };
  clearInterval(internal.tickTimer);
  const group = runtime.world.groups[0],
    rabbit = runtime.world.rabbits[0];
  const key = PROVIDER_KEYS[group.provider],
    saved = process.env[key];
  process.env[key] = 'fixture-key';
  let status = 200;
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify(fixture(group.provider)), { status }),
  );
  try {
    runtime.running = true;
    runtime.config.deadlineMs = 1;
    group.delayMs = 20;
    await internal.dispatch(rabbit);
    assert.equal(runtime.decisions.get(rabbit.id)[0].state, 'late');
    assert.equal(runtime.world.stats[group.id].applied, 0);
    runtime.config = { ...DEFAULT_CONFIG, timing: 'equalized', equalizedMs: 150 };
    group.delayMs = 0;
    const pending = internal.dispatch(rabbit);
    await new Promise((resolve) => setTimeout(resolve, 15));
    runtime.pause();
    await pending;
    assert.equal(runtime.decisions.get(rabbit.id)[0].state, 'cancelled');
    assert.equal(
      runtime.replay.get(runtime.replay.frames - 1).decisions?.[rabbit.id][0].state,
      'cancelled',
    );
    runtime.running = true;
    status = 503;
    await internal.dispatch(rabbit);
    const error = runtime.decisions.get(rabbit.id)[0];
    assert.equal(error.state, 'error');
    assert.match(error.message!, /HTTP 503/);
    assert.equal(error.decision, undefined);
    assert.equal(runtime.decisions.get(rabbit.id).length, 3);
  } finally {
    runtime.dispose();
    mock.mock.restore();
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a provider's long Retry-After pauses a group for at most a few seconds", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'arena-retry-cap-'));
  const runtime = new ArenaRuntime(dir);
  const internal = runtime as unknown as {
    tickTimer: ReturnType<typeof setInterval>;
    backoff: Record<string, number>;
    dispatch: (animal: (typeof runtime.world.rabbits)[number]) => Promise<void>;
  };
  clearInterval(internal.tickTimer);
  const group = runtime.world.groups[0],
    rabbit = runtime.world.rabbits[0];
  const key = PROVIDER_KEYS[group.provider],
    saved = process.env[key];
  process.env[key] = 'fixture-key';
  // The stall seen in a real run: HTTP 520 asking the client to wait ten minutes.
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('bad gateway', { status: 520, headers: { 'retry-after': '600' } }),
  );
  try {
    runtime.running = true;
    const before = performance.now();
    await internal.dispatch(rabbit);
    assert.ok(internal.backoff[group.id] - before <= 5000 + 50);
  } finally {
    runtime.dispose();
    mock.mock.restore();
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('active settings set wolf counts and persist effective metadata in replay', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'arena-active-'));
  const runtime = new ArenaRuntime(directory);
  try {
    const settings = defaultExperimentPreview();
    settings.values.wolfCount = 20;
    settings.values.temperature = 40;
    runtime.reset(123, { ...DEFAULT_CONFIG, experimentPreview: settings });
    assert.equal(runtime.world.wolves.length, 20);
    assert.deepEqual(runtime.replay.get(0).status.config.experimentPreview, settings);
    settings.values.wolfCount = 0;
    runtime.reset(123, { ...DEFAULT_CONFIG, experimentPreview: settings });
    assert.equal(runtime.world.wolves.length, 0);
  } finally {
    runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
