// Loops a short clip cut from a real recorded Jev run (scripts/make-landing-clip.mjs) through the
// habitat renderer. Replay only: nothing is simulated and no model is called.
import { useEffect, useRef, useState } from 'react';

import { RULES } from '../../../core/src/evolution/constants.js';
import type { Snapshot, Tile, World } from '../../../core/src/evolution/types.js';
import { attachRenderer } from './renderer.js';
import type { MapEditorState } from './useMapEditor.js';

interface Clip {
  source: { runId: string };
  intervalMs?: number;
  tiles: Tile[];
  frames: Partial<World>[];
}
const CLOSED_EDITOR = { open: false } as MapEditorState;

export function LandingClip() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/evolution/landing-clip.json', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('clip unavailable'))))
      .then(setClip)
      .catch((error: Error) => error.name !== 'AbortError' && setFailed(true));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!clip || !canvas.current) return;
    const started = performance.now();
    const snapshots = clip.frames.map(
      (frame) =>
        ({
          world: { ...frame, tiles: clip.tiles, mapRevision: 0 },
          status: { runId: `landing:${clip.source.runId}` },
        }) as unknown as Snapshot,
    );
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = attachRenderer(
      canvas.current,
      () =>
        snapshots[
          still
            ? 0
            : Math.floor((performance.now() - started) / (clip.intervalMs ?? RULES.tickMs)) %
              snapshots.length
        ],
      () => null,
      () => {},
      () => setFailed(true),
      () => CLOSED_EDITOR,
      () => false,
      () => {},
    );
    renderer.zoomIn();
    renderer.zoomIn();
    return () => renderer.dispose();
  }, [clip]);
  return (
    <div className="landing-clip">
      {failed ? (
        <p>Habitat preview unavailable.</p>
      ) : (
        <canvas ref={canvas} aria-label="Replay of a recorded Jev rabbits and wolves run" />
      )}
      <span className="landing-clip-badge">● Replay · real Jev run</span>
    </div>
  );
}
