import { type Chunk } from '../../../core/src/evolution/replayCodec.js';
import { type SampleRun } from '../../../core/src/evolution/sampleRun.js';

export async function loadSample(): Promise<SampleRun> {
  const response = await fetch('/api/arena/sample');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Sample unavailable. Please retry.');
  return data;
}
export async function loadSampleChunk(run: SampleRun, start: number): Promise<Chunk> {
  const response = await fetch(`/api/arena/sample?id=${encodeURIComponent(run.id)}&start=${start}`);
  if (!response.ok) throw new Error('Sample could not be loaded. Please retry.');
  if (!response.body) throw new Error('Empty sample recording.');
  return JSON.parse(
    await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text(),
  );
}
