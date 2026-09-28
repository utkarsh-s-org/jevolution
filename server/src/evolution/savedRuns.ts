import { gunzipSync } from 'node:zlib';

import { GRID } from '../../../core/src/evolution/constants.js';
import { apply, type Chunk, CHUNK_SIZE } from '../../../core/src/evolution/replayCodec.js';
import { AccountError } from './accountStore.js';
export const validRunId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function decodeRunChunk(bytes: Uint8Array, runId: string, start: number) {
  let chunk: Chunk;
  try {
    chunk = JSON.parse(gunzipSync(bytes, { maxOutputLength: 24 * 1024 * 1024 }).toString());
  } catch {
    throw new AccountError('Invalid or oversized replay chunk.', 400);
  }
  if (
    !chunk ||
    chunk.start !== start ||
    !Array.isArray(chunk.changes) ||
    chunk.changes.length >= CHUNK_SIZE ||
    !chunk.base?.world ||
    chunk.base.status?.runId !== runId ||
    chunk.base.world.tiles?.length !== GRID * GRID ||
    !Array.isArray(chunk.base.world.groups) ||
    !Array.isArray(chunk.base.world.rabbits) ||
    !Array.isArray(chunk.base.world.wolves)
  )
    throw new AccountError('Invalid replay data.', 400);
  for (const patches of chunk.changes) {
    if (!Array.isArray(patches) || patches.length > 100000)
      throw new AccountError('Invalid replay changes.', 400);
    for (const patch of patches) {
      if (
        !Array.isArray(patch) ||
        patch.length < 1 ||
        patch.length > 2 ||
        !Array.isArray(patch[0]) ||
        !patch[0].length ||
        patch[0].length > 25 ||
        patch[0].some(
          (key: unknown) =>
            typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key),
        )
      )
        throw new AccountError('Invalid replay path.', 400);
    }
  }
  const last = structuredClone(chunk.base);
  try {
    for (const patches of chunk.changes) apply(last, patches);
  } catch {
    throw new AccountError('Invalid replay changes.', 400);
  }
  if (
    last.status?.runId !== runId ||
    !Number.isFinite(last.world?.time) ||
    last.world.time < 0 ||
    !last.status?.config ||
    !Array.isArray(last.world.groups) ||
    last.world.groups.length > 6 ||
    !Number.isInteger(last.world.seed) ||
    !Array.isArray(last.world.rabbits) ||
    !Array.isArray(last.world.wolves)
  )
    throw new AccountError('Invalid replay snapshot.', 400);
  return { chunk, last, frames: start + chunk.changes.length + 1 };
}
