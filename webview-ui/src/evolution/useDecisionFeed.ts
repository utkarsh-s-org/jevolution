import { useEffect, useState } from 'react';

import type { DecisionFeed, Snapshot } from '../../../core/src/evolution/types.js';
import { PUBLIC_PREVIEW } from './publicPreview.js';

export function useDecisionFeed(snapshot: Snapshot | null, animalId: number, reviewing: boolean) {
  const runId = snapshot?.status.runId;
  const [feed, setFeed] = useState<DecisionFeed | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!runId || reviewing || PUBLIC_PREVIEW) return;
    let closed = false;
    const events = new EventSource(
      `/api/arena/decisions/${animalId}?runId=${encodeURIComponent(runId)}`,
    );
    events.onmessage = (event) => {
      if (closed) return;
      const next = JSON.parse(event.data) as DecisionFeed;
      if (next.runId !== runId || next.animalId !== animalId) return;
      setFeed(next);
      setConnected(true);
    };
    events.onerror = () => {
      if (!closed) setConnected(false);
    };
    return () => {
      closed = true;
      events.close();
    };
  }, [runId, animalId, reviewing]);
  const current = feed && feed.runId === runId && feed.animalId === animalId ? feed : null;
  return {
    traces:
      !reviewing && current && connected ? current.traces : snapshot?.decisions?.[animalId] || [],
    connected: !!current && connected && !reviewing,
  };
}
