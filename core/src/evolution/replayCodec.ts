import type { Snapshot } from './types.js';

export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
type Patch = [string[], Value?];
export interface Chunk {
  start: number;
  base: Snapshot;
  changes: Patch[][];
}
export const CHUNK_SIZE = 100;
// Deltas retain exact engine values. No simulation or model calls run during replay.
export function changes(
  before: Value,
  after: Value,
  at: string[] = [],
  out: Patch[] = [],
): Patch[] {
  if (before === after) return out;
  if (
    !before ||
    !after ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) !== Array.isArray(after) ||
    (Array.isArray(before) && Array.isArray(after) && before.length !== after.length)
  ) {
    out.push([at, after]);
    return out;
  }
  const a = before as Record<string, Value>,
    b = after as Record<string, Value>;
  for (const key of Object.keys(a)) if (!Object.hasOwn(b, key)) out.push([[...at, key]]);
  for (const key of Object.keys(b)) {
    if (!Object.hasOwn(a, key)) out.push([[...at, key], b[key]]);
    else changes(a[key], b[key], [...at, key], out);
  }
  return out;
}
export function apply(snapshot: Snapshot, patches: Patch[]) {
  for (const [keys, value] of patches) {
    let target = snapshot as unknown as Record<string, Value>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, Value>;
    const key = keys[keys.length - 1];
    if (value === undefined) delete target[key];
    else target[key] = structuredClone(value);
  }
}
