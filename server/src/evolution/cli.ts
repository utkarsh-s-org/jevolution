import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseEnv } from 'node:util';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import {
  DEFAULT_CONFIG,
  PROVIDER_KEYS,
  RULES,
  validateGroups,
} from '../../../core/src/evolution/constants.js';
import type { RunConfig } from '../../../core/src/evolution/types.js';
import { ArenaRuntime } from './runtime.js';

const root = process.cwd();
function loadKeys() {
  try {
    const parsed = parseEnv(readFileSync(path.join(root, '.env.arena'), 'utf8'));
    for (const key of [...Object.values(PROVIDER_KEYS), 'JEV_MODEL', 'CLAUDE_MODEL'])
      if (Object.hasOwn(parsed, key)) process.env[key] = parsed[key];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn('[Evolution Arena] Could not read .env.arena');
  }
}
function configFrom(input: Record<string, unknown>): RunConfig {
  const next = { ...DEFAULT_CONFIG };
  const ranges: Record<string, [number, number]> = {
    deadlineMs: [250, 15000],
    decisionIntervalMs: [100, 15000],
    maxInFlight: [1, 8],
    equalizedMs: [500, 15000],
    maxRequests: [2, 20000],
    maxSeconds: [10, 1200],
    timeScale: [1, 4],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (input[key] === undefined) continue;
    const n = input[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max)
      throw new Error(`Invalid ${key}; expected an integer between ${min} and ${max}.`);
    (next as unknown as Record<string, unknown>)[key] = n;
  }
  if (input.timing !== undefined && !['realtime', 'equalized'].includes(String(input.timing)))
    throw new Error('Invalid timing mode.');
  if (input.timing) next.timing = input.timing as RunConfig['timing'];
  if (input.scenario !== undefined && !['arena', 'predatorPrey'].includes(String(input.scenario)))
    throw new Error('Invalid scenario.');
  if (input.scenario) next.scenario = input.scenario as RunConfig['scenario'];
  return next;
}
async function main() {
  loadKeys();
  const port = Number(process.env.ARENA_PORT || 4317);
  const runtime = new ArenaRuntime(path.join(root, 'logs/evolution'));
  const app = Fastify({ logger: false, bodyLimit: 16384 });
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  app.addHook('onRequest', async (request, reply) => {
    if (!allowed.has(request.headers.host || ''))
      return reply.code(403).send({ error: 'Invalid host' });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin && ![...allowed].some((host) => origin === `http://${host}`))
        return reply.code(403).send({ error: 'Cross-origin control is disabled' });
      if (!request.headers['content-type']?.startsWith('application/json'))
        return reply.code(415).send({ error: 'JSON required' });
    }
  });
  app.get('/api/arena/state', async () => {
    loadKeys();
    return runtime.snapshot();
  });
  app.get('/api/arena/events', (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    runtime.connections++;
    const send = () => {
      if (!reply.raw.writableEnded && reply.raw.writableLength < 1e6)
        reply.raw.write(`data: ${JSON.stringify(runtime.snapshot())}\n\n`);
    };
    send();
    const timer = setInterval(send, RULES.snapshotMs);
    reply.raw.on('close', () => {
      clearInterval(timer);
      runtime.connections--;
      if (!runtime.connections && runtime.running)
        runtime.pause('Viewer disconnected. Paused to stop unattended API calls.');
    });
  });
  app.post('/api/arena/control', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      if (!body || typeof body !== 'object') throw new Error('JSON object required');
      if (body.action === 'start') {
        loadKeys();
        runtime.start();
      } else if (body.action === 'pause') runtime.pause();
      else if (body.action === 'drought') runtime.drought();
      else if (body.action === 'reset') {
        if (runtime.running) throw new Error('Pause before resetting the habitat.');
        const seed = body.seed ?? runtime.world.seed;
        if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 1 || seed > 2147483647)
          throw new Error('Seed must be an integer between 1 and 2147483647.');
        const config = configFrom((body.config || {}) as Record<string, unknown>);
        // The predator–prey preset supplies its own roster (see runtime.reset).
        runtime.reset(
          seed,
          config,
          config.scenario === 'predatorPrey' || body.groups === undefined
            ? runtime.world.groups
            : validateGroups(body.groups),
        );
      } else throw new Error('Unknown control action');
      return runtime.snapshot();
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Control failed' });
    }
  });
  app.post('/api/arena/map', { bodyLimit: 262144 }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      if (!body || typeof body !== 'object') throw new Error('JSON object required');
      runtime.editMap(body.runId, body.revision, body.edits);
      return runtime.snapshot();
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Map edit failed' });
    }
  });
  app.get('/api/arena/replay/:index', async (request, reply) => {
    const { index } = request.params as { index: string };
    const { runId } = request.query as { runId?: string };
    if (runId !== runtime.runId)
      return reply.code(409).send({ error: 'Run changed. Return to the live habitat.' });
    if (!/^\d+$/.test(index)) return reply.code(400).send({ error: 'Invalid frame index.' });
    try {
      return { index: Number(index), snapshot: runtime.replay.get(Number(index)) };
    } catch {
      return reply.code(404).send({ error: 'Replay frame unavailable.' });
    }
  });
  app.get('/api/arena/decisions/:animalId', (request, reply) => {
    const { animalId: input } = request.params as { animalId: string };
    const { runId } = request.query as { runId?: string };
    if (runId !== runtime.runId) return reply.code(409).send({ error: 'Run changed.' });
    const animalId = Number(input);
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(animalId) || animalId < 1)
      return reply.code(400).send({ error: 'Invalid animal ID.' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = () => {
      if (reply.raw.writableEnded) return;
      if (runtime.runId !== runId) {
        reply.raw.end();
        return;
      }
      if (reply.raw.writableLength > 1e6) {
        reply.raw.end();
        return;
      }
      reply.raw.write(
        `data: ${JSON.stringify({ runId, animalId, traces: runtime.decisions.get(animalId) })}\n\n`,
      );
    };
    send();
    const unsubscribe = runtime.decisions.subscribe((changed) => {
      if (changed === animalId || changed === null) send();
    });
    // Keep the connection alive even when the simulation is paused.
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
    }, 15000);
    reply.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });
  app.get('/api/arena/export', async (_request, reply) =>
    reply
      .header('content-disposition', `attachment; filename="evolution-${runtime.runId}.json"`)
      .send({
        exportedAt: new Date().toISOString(),
        caveat:
          'An illustrative ecosystem. Only live returned API decisions are model evidence; no biological prediction or statistical superiority claim. Estimated cost excludes unreported usage from interrupted requests.',
        ...runtime.snapshot(),
      }),
  );
  await app.register(fastifyStatic, { root: path.join(root, 'dist/arena'), prefix: '/' });
  app.get('/', async (_request, reply) => reply.sendFile('arena.html'));
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  const close = async () => {
    runtime.dispose();
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  await app.listen({ host: '127.0.0.1', port });
  console.log(
    `[Evolution Arena] http://127.0.0.1:${port} · API keys remain server-side · Ctrl+C to stop`,
  );
}
void main().catch((error) => {
  console.error('[Evolution Arena]', error instanceof Error ? error.message : 'Startup failed');
  process.exitCode = 1;
});
