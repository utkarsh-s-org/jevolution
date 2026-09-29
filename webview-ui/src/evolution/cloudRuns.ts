import { type Chunk, CHUNK_SIZE } from '../../../core/src/evolution/replayCodec.js';
import type { ModelGroup, RunConfig } from '../../../core/src/evolution/types.js';
export interface SavedRun {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  seed: number;
  duration_seconds: number;
  frames: number;
  config: RunConfig;
  groups: ModelGroup[];
  populations: Record<string, number>;
  estimated_cost: number | null;
}
export async function compressedChunk(chunk: Chunk) {
  return new Response(
    new Blob([JSON.stringify(chunk)]).stream().pipeThrough(new CompressionStream('gzip')),
  ).blob();
}
export async function loadCloudChunk(
  runId: string,
  start: number,
  ownerId: string,
): Promise<Chunk> {
  const response = await fetch(
    `/api/arena/runs?runId=${encodeURIComponent(runId)}&start=${start}`,
    { headers: { 'x-account-id': ownerId } },
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Saved replay unavailable.');
  }
  const text = await new Response(
    response.body!.pipeThrough(new DecompressionStream('gzip')),
  ).text();
  return JSON.parse(text);
}
export { recordedFrame } from '../../../core/src/evolution/replayCodec.js';
export const chunkStart = (index: number) => Math.floor(index / CHUNK_SIZE) * CHUNK_SIZE;
