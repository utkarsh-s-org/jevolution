import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import { storedReport } from './evidence.js';
import { ReplayStore } from './replay.js';

// A read-only view of a real recording; no ArenaRuntime, provider keys or model calls.
async function main() {
  const root = process.env.ARENA_LOG_DIRECTORY;
  const id = process.env.ARENA_REVIEW_RUN;
  if (!root || !id || !/^[a-zA-Z0-9-]+$/.test(id))
    throw new Error('Set ARENA_LOG_DIRECTORY and ARENA_REVIEW_RUN to an existing recorded run.');
  const port = Number(process.env.ARENA_PORT || 4322);
  const manifest = JSON.parse(
    await readFile(path.join(root, `${id}.replay/manifest.json`), 'utf8'),
  );
  const replay = new ReplayStore(root, id);
  replay.frames = manifest.frames;
  const original = replay.get(manifest.frames - 1);
  original.status.replay.frames = manifest.frames;
  const report = await storedReport(root, original);
  const readonly = (snapshot: typeof original) => {
    snapshot.status.running = false;
    snapshot.status.readOnly = true;
    snapshot.status.reason = `Read-only recording · ${report.completion}`;
    snapshot.status.ready = Object.fromEntries(snapshot.world.groups.map((g) => [g.id, false]));
    snapshot.status.providerReady = {
      typesafe: false,
      anthropic: false,
      openai: false,
      google: false,
    };
    return snapshot;
  };
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request, reply) => {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host || ''))
      return reply.code(403).send({ error: 'Invalid host' });
    if (!['GET', 'HEAD'].includes(request.method))
      return reply
        .code(403)
        .send({ error: 'This recording is read-only. Use port 4321 for a new local experiment.' });
  });
  app.get('/api/arena/state', async () => readonly(structuredClone(original)));
  app.get('/api/arena/report', async () => report);
  app.get('/api/arena/export', async (_request, reply) =>
    reply.header('content-disposition', `attachment; filename="${id}.json"`).send(original),
  );
  app.get('/api/arena/bundle', async (_request, reply) => {
    const file = process.env.ARENA_REVIEW_BUNDLE;
    if (!file)
      return reply.code(409).send({ error: 'Use arena:report to package this recording first.' });
    return reply
      .header('content-disposition', `attachment; filename="${id}.tar.gz"`)
      .type('application/gzip')
      .send(createReadStream(file));
  });
  app.get('/api/arena/events', (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(`data: ${JSON.stringify(readonly(structuredClone(original)))}\n\n`);
    const timer = setInterval(() => reply.raw.write(': recorded view\n\n'), 15000);
    reply.raw.on('close', () => clearInterval(timer));
  });
  app.get('/api/arena/replay/:index', async (request, reply) => {
    const { index } = request.params as { index: string };
    if ((request.query as { runId?: string }).runId !== id || !/^\d+$/.test(index))
      return reply.code(400).send({ error: 'Invalid frame request' });
    try {
      return { index: Number(index), snapshot: readonly(replay.get(Number(index))) };
    } catch {
      return reply.code(404).send({ error: 'Frame unavailable' });
    }
  });
  app.get('/api/arena/decisions/:animalId', async (request, reply) => {
    const { animalId } = request.params as { animalId: string };
    if (!/^\d+$/.test(animalId)) return reply.code(400).send({ error: 'Invalid animal ID' });
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    reply.raw.end(
      `data: ${JSON.stringify({ runId: id, animalId: Number(animalId), traces: original.decisions?.[animalId] ?? [] })}\n\n`,
    );
  });
  await app.register(fastifyStatic, { root: path.join(process.cwd(), 'dist/arena'), prefix: '/' });
  app.get('/', async (_request, reply) => reply.sendFile('arena.html'));
  await app.listen({ host: '127.0.0.1', port });
  console.log(`Read-only recorded experiment: http://127.0.0.1:${port}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
