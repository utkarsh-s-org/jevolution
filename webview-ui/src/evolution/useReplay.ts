import { useEffect, useRef, useState } from 'react';

import type { Snapshot } from '../../../core/src/evolution/types.js';

export function useReplay(live: Snapshot | null) {
  const [request, setRequest] = useState<{ runId: string; index: number } | null>(null);
  const [loaded, setLoaded] = useState<{ runId: string; index: number; snapshot: Snapshot } | null>(
    null,
  );
  const [error, setError] = useState('');
  const generation = useRef(0);
  const loadFrame = useRef<((index: number) => void) | null>(null);
  const active = request?.runId === live?.status.runId && !live?.status.running ? request : null;
  const activeIndex = active?.index;
  const activeRunId = active?.runId;
  useEffect(() => {
    const id = ++generation.current;
    if (!activeRunId) return;
    const controller = new AbortController();
    let nextIndex: number | undefined;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      // Finish previews during a drag instead of repeatedly cancelling them.
      // Coalesce intermediate positions so only the latest target loads next.
      while (nextIndex !== undefined && !controller.signal.aborted && id === generation.current) {
        const index = nextIndex;
        nextIndex = undefined;
        try {
          const r = await fetch(
            `/api/arena/replay/${index}?runId=${encodeURIComponent(activeRunId)}`,
            { signal: controller.signal },
          );
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || 'Replay unavailable');
          if (!controller.signal.aborted && id === generation.current) {
            setLoaded({
              index,
              runId: activeRunId,
              snapshot: { ...data.snapshot, status: { ...data.snapshot.status, running: false } },
            });
            setError('');
          }
        } catch (e) {
          if (!controller.signal.aborted && id === generation.current)
            setError(e instanceof Error ? e.message : 'Replay unavailable');
        }
      }
      loading = false;
    };
    loadFrame.current = (index) => {
      nextIndex = index;
      void load();
    };
    return () => {
      loadFrame.current = null;
      controller.abort();
    };
  }, [activeRunId]);
  useEffect(() => {
    if (activeIndex !== undefined) loadFrame.current?.(activeIndex);
  }, [activeIndex, activeRunId]);
  const shown = active && loaded?.runId === active.runId ? loaded.snapshot : live;
  return {
    shown,
    reviewing: !!active,
    loading: !!active && (loaded?.runId !== active.runId || loaded?.index !== active.index),
    index: active?.index ?? Math.max(0, (live?.status.replay.frames || 1) - 1),
    error: active ? error : '',
    seek: (index: number) => {
      if (live && !live.status.running) {
        setError('');
        setRequest({ runId: live.status.runId, index });
      }
    },
    goLive: () => {
      generation.current++;
      setRequest(null);
      setError('');
    },
  };
}
