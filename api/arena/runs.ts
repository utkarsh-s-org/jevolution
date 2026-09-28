import { CHUNK_SIZE } from '../../core/src/evolution/replayCodec.js';
import {
  AccountError,
  accountFailure,
  requireAccount,
  storeJson,
  supabase,
} from '../../server/src/evolution/accountStore.js';
import { json } from '../../server/src/evolution/hostedAuth.js';
import { decodeRunChunk, validRunId } from '../../server/src/evolution/savedRuns.js';
export default {
  async fetch(request: Request) {
    try {
      const user = await requireAccount(request);
      const url = new URL(request.url);
      const runId = url.searchParams.get('runId');
      if (request.method === 'GET' && !runId) {
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
          throw new AccountError('Invalid page.', 400);
        return json({
          runs: await storeJson(
            `jevolution_runs?select=*&order=created_at.desc&limit=25&offset=${offset}`,
            user,
          ),
        });
      }
      if (!runId || !validRunId(runId)) throw new AccountError('Invalid run.', 400);
      const start = Number(url.searchParams.get('start'));
      if (
        !url.searchParams.has('start') ||
        !Number.isInteger(start) ||
        start < 0 ||
        start >= 150000 ||
        start % CHUNK_SIZE
      )
        throw new AccountError('Invalid frame.', 400);
      const storagePath = `/storage/v1/object/jevolution-replays/${user.id}/${runId}/${start}.json.gz`;
      if (request.method === 'GET') {
        const response = await supabase(storagePath, user.token);
        if (!response.ok)
          throw new AccountError(
            'This saved frame is unavailable.',
            response.status === 404 || response.status === 400 ? 404 : 503,
          );
        return new Response(response.body, {
          headers: {
            'content-type': 'application/gzip',
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
          },
        });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (request.headers.get('content-type') !== 'application/gzip')
        throw new AccountError('Compressed replay required.', 415);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > 4 * 1024 * 1024) throw new AccountError('Replay chunk too large.', 413);
      const { last, frames } = decodeRunChunk(bytes, runId, start);
      const prior = await storeJson<{ frames: number }[]>(
        `jevolution_runs?id=eq.${runId}&select=frames`,
        user,
      );
      const previousFrames = prior?.[0]?.frames || 0;
      if (start > previousFrames) throw new AccountError('Upload earlier frames first.', 409);
      // Serial upload per run. Never regress a completed or newer partial chunk.
      if (frames < previousFrames) return json({ saved: true, frames: previousFrames });
      const upload = await supabase(storagePath, user.token, {
        method: 'POST',
        headers: { 'content-type': 'application/gzip', 'x-upsert': 'true' },
        body: bytes,
      });
      if (!upload.ok)
        throw new AccountError('Could not save replay. Your local copy is retained.', 503);
      const populations = Object.fromEntries(
        last.world.groups.map((group) => [
          group.label,
          (group.species === 'wolf' ? last.world.wolves : last.world.rabbits).filter(
            (animal) => animal.lineage === group.id,
          ).length,
        ]),
      );
      await storeJson(
        'jevolution_runs?on_conflict=user_id,id',
        user,
        'POST',
        {
          user_id: user.id,
          id: runId,
          seed: last.world.seed,
          duration_seconds: last.world.time,
          frames,
          config: last.status.config,
          groups: last.world.groups,
          populations,
          estimated_cost: last.status.estimatedCost,
          updated_at: new Date().toISOString(),
        },
        { Prefer: 'resolution=merge-duplicates,return=minimal' },
      );
      return json({ saved: true, frames });
    } catch (error) {
      return accountFailure(error);
    }
  },
};
