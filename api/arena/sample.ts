import { accountFailure, AccountError, supabase } from '../../server/src/evolution/accountStore.js';
import { json } from '../../server/src/evolution/hostedAuth.js';
import { SAMPLE_CHUNK_SIZE, type SampleRun } from '../../core/src/evolution/sampleRun.js';

/** Public GET-only catalog. Never accepts an owner, arbitrary path, or uploaded recording. */
export default {
  async fetch(request: Request) {
    if (request.method !== 'GET') return json({ error: 'Sample recordings are read-only.' }, 405);
    try {
      const params = new URL(request.url).searchParams;
      const response = await supabase(
        '/rest/v1/jevolution_samples?active=eq.true&select=id,title,recorded_at,frames,interval_ms,duration_seconds,notes&limit=1',
      );
      if (!response.ok) throw new AccountError('Sample recording is temporarily unavailable.', 503);
      const sample = ((await response.json()) as SampleRun[])[0];
      if (!sample) throw new AccountError('No sample recording has been published yet.', 503);
      if (!params.has('start'))
        return new Response(JSON.stringify(sample), {
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
        });
      const start = Number(params.get('start'));
      if (
        params.get('id') !== sample.id ||
        !/^\d+$/.test(params.get('start') || '') ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        start >= sample.frames ||
        start % SAMPLE_CHUNK_SIZE !== 0
      )
        throw new AccountError('Sample frame unavailable. Reload the sample.', 404);
      const chunk = await supabase(
        `/storage/v1/object/public/jevolution-samples/${sample.id}/${start}.json.gz`,
      );
      if (!chunk.ok)
        throw new AccountError('Sample recording could not be loaded. Please retry.', 503);
      return new Response(chunk.body, {
        headers: {
          'content-type': 'application/gzip',
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      return accountFailure(error);
    }
  },
};
