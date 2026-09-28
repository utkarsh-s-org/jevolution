import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseEnv } from 'node:util';
import { PROVIDER_KEYS, validateGroups } from '../core/src/evolution/constants.js';
import type { RunConfig, World } from '../core/src/evolution/types.js';
import { ArenaRuntime } from '../server/src/evolution/runtime.js';
import { ReplayStore } from '../server/src/evolution/replay.js';
import { exportBundle } from '../server/src/evolution/evidence.js';

// Explicit execution only. Inputs are recorded initial worlds, never generated evaluation cases.
async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const input = value('--manifest');
  if (!input) throw new Error('Usage: tsx scripts/batch-arena.ts --manifest JOBS.json [--execute]');
  const plan = JSON.parse(readFileSync(input, 'utf8')) as {
    initialFiles: string[];
    output: string;
    maxRequests: number;
    maxWallSeconds: number;
  };
  if (
    !Array.isArray(plan.initialFiles) ||
    plan.initialFiles.length < 1 ||
    plan.initialFiles.length > 20 ||
    !Number.isInteger(plan.maxRequests) ||
    plan.maxRequests < 1 ||
    plan.maxRequests > 20000 ||
    !Number.isInteger(plan.maxWallSeconds) ||
    plan.maxWallSeconds < 1 ||
    plan.maxWallSeconds > 7200 ||
    !plan.output
  )
    throw new Error(
      'Require 1–20 recorded inputs, output directory, total maxRequests 1–20000 and total maxWallSeconds 1–7200.',
    );
  const jobs = plan.initialFiles.map((file) => {
    const initial = JSON.parse(readFileSync(file, 'utf8')) as { world: World; config: RunConfig };
    if (
      initial.world.time !== 0 ||
      Object.values(initial.world.stats).some((s) => s.requested !== 0)
    )
      throw new Error('Batch inputs must be recorded, unstarted initial worlds.');
    validateGroups(initial.world.groups);
    if (
      !['arena', 'predatorPrey', undefined].includes(initial.config.scenario) ||
      !['realtime', 'equalized'].includes(initial.config.timing)
    )
      throw new Error('Invalid recorded scenario or timing.');
    for (const [key, min, max] of [
      ['timeScale', 1, 4],
      ['maxSeconds', 10, 1200],
      ['maxRequests', 2, 20000],
      ['maxInFlight', 1, 8],
      ['decisionIntervalMs', 100, 15000],
      ['deadlineMs', 250, 15000],
      ['equalizedMs', 500, 15000],
    ] as const) {
      const v = initial.config[key] ?? (key === 'timeScale' ? 1 : NaN);
      if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Invalid recorded ${key}`);
    }
    return initial;
  });
  if (!execute) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry run; no API calls',
          ...plan,
          jobs: jobs.map((j) => ({
            seed: j.world.seed,
            models: j.world.groups.map((g) => g.model),
            seconds: j.config.maxSeconds,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  // Exclusive creation prevents accidentally repeating an existing batch.
  await mkdir(plan.output, { recursive: false });
  try {
    const env = parseEnv(readFileSync('.env.arena', 'utf8'));
    for (const key of Object.values(PROVIDER_KEYS)) if (env[key]) process.env[key] = env[key];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const deadline = performance.now() + plan.maxWallSeconds * 1000;
  let remaining = plan.maxRequests,
    stopped = false;
  const interrupt = () => {
    stopped = true;
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const results = [];
  try {
    for (
      let i = 0;
      i < jobs.length && remaining > 0 && !stopped && performance.now() < deadline;
      i++
    ) {
      const root = path.join(plan.output, `job-${i + 1}`);
      const runtime = new ArenaRuntime(root);
      try {
        const config = {
          ...jobs[i].config,
          maxRequests: Math.min(jobs[i].config.maxRequests, remaining),
        };
        runtime.reset(jobs[i].world.seed, config, jobs[i].world.groups);
        runtime.world = structuredClone(jobs[i].world);
        runtime.replay = new ReplayStore(root, runtime.runId);
        runtime.start();
        while (runtime.running && !stopped && performance.now() < deadline)
          await new Promise((r) => setTimeout(r, 100));
        if (runtime.running)
          runtime.pause(stopped ? 'Batch interrupted.' : 'Batch wall-clock limit reached.');
        // Await cancellation accounting before exporting. Abort requests have a finite provider timeout.
        const drain = performance.now() + 17000;
        while (Object.values(runtime.status().inFlight).some(Boolean) && performance.now() < drain)
          await new Promise((r) => setTimeout(r, 50));
        runtime.replay.flush();
        const snapshot = structuredClone(runtime.snapshot());
        const used = Object.values(snapshot.world.stats).reduce((sum, s) => sum + s.requested, 0);
        remaining -= used;
        const bundle = await exportBundle(
          root,
          snapshot,
          path.join(plan.output, `job-${i + 1}.tar.gz`),
        );
        results.push({
          job: i + 1,
          runId: runtime.runId,
          used,
          report: bundle.report,
          performance: runtime.report().performance,
        });
        if (Object.values(snapshot.world.stats).some((s) => s.errors > 0)) {
          stopped = true;
        }
      } catch (error) {
        runtime.pause('Batch failed; recording retained.');
        results.push({
          job: i + 1,
          runId: runtime.runId,
          error: error instanceof Error ? error.message : String(error),
        });
        stopped = true;
        process.exitCode = 1;
      } finally {
        runtime.dispose();
      }
      await writeFile(
        path.join(plan.output, 'batch-results.json'),
        JSON.stringify(results, null, 2),
      );
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  console.log(
    JSON.stringify({
      jobsCompleted: results.length,
      requestsUsed: plan.maxRequests - remaining,
      output: plan.output,
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
