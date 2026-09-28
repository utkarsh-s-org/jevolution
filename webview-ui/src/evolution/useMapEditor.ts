import { useMemo, useRef, useState } from 'react';

import { GRID } from '../../../core/src/evolution/constants.js';
import {
  type MapBrush,
  type MapEdit,
  paintMapBrush,
  paintTile,
} from '../../../core/src/evolution/mapEditor.js';
import { isTerrainStamp, TERRAIN_STAMP_SIZE } from '../../../core/src/evolution/terrain.js';
import type { Point, Snapshot } from '../../../core/src/evolution/types.js';
import { arenaRequest } from './hostedClient.js';

type Edits = Map<number, MapEdit>;
interface Draft {
  base: Snapshot;
  edits: Edits;
  undo: Edits[];
  redo: Edits[];
  version: number;
}
export function useMapEditor(
  live: Snapshot | null,
  reviewing: boolean,
  onSaved: (s: Snapshot) => void,
) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [brush, setBrush] = useState<MapBrush | 'pan'>('forest');
  const [size, setSize] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const stroke = useRef<Point | null>(null);
  const valid =
    !!draft &&
    !!live &&
    !live.status.running &&
    !reviewing &&
    draft.base.status.runId === live.status.runId &&
    (draft.base.world.mapRevision || 0) === (live.world.mapRevision || 0);
  const preview = useMemo(() => {
    if (!draft || !valid) return null;
    return {
      ...draft.base,
      world: {
        ...draft.base.world,
        tiles: draft.base.world.tiles.map((tile, i) => {
          const edit = draft.edits.get(i);
          return edit ? paintTile(tile, edit.brush) : tile;
        }),
        caches: draft.base.world.caches.filter((c) => {
          const edit = draft.edits.get(Math.floor(c.y) * GRID + Math.floor(c.x));
          return !edit || edit.brush === 'shelter';
        }),
      },
    };
  }, [draft, valid]);
  const paint = (point: Point, first: boolean) => {
    if (!valid || saving || brush === 'pan') return;
    const from = first ? point : stroke.current || point;
    stroke.current = point;
    setDraft((current) => {
      if (!current) return current;
      const edits = new Map(current.edits);
      const steps = Math.max(Math.abs(point.x - from.x), Math.abs(point.y - from.y), 1);
      const points = Array.from({ length: steps + 1 }, (_, i) => ({
        x: Math.round(from.x + ((point.x - from.x) * i) / steps),
        y: Math.round(from.y + ((point.y - from.y) * i) / steps),
      }));
      const tiles = current.base.world.tiles.map((tile, i) => {
        const edit = edits.get(i);
        return edit ? paintTile(tile, edit.brush) : tile;
      });
      for (const edit of paintMapBrush(tiles, points, brush, size))
        edits.set(edit.y * GRID + edit.x, edit);
      return {
        ...current,
        edits,
        version: current.version + 1,
        undo: first ? [...current.undo.slice(-49), current.edits] : current.undo,
        redo: [],
      };
    });
  };
  return {
    open: !!draft,
    brush,
    size: isTerrainStamp(brush) ? TERRAIN_STAMP_SIZE : size,
    stamp: isTerrainStamp(brush),
    saving,
    valid,
    preview,
    version: draft?.version || 0,
    changed: draft?.edits.size || 0,
    canUndo: !!draft?.undo.length,
    canRedo: !!draft?.redo.length,
    error:
      draft && !valid
        ? 'The live habitat changed. Close the editor and reopen it before editing.'
        : error,
    setBrush,
    setSize,
    paint,
    begin: () => {
      if (!live || live.status.running || reviewing) return;
      setDraft({ base: structuredClone(live), edits: new Map(), undo: [], redo: [], version: 0 });
      setError('');
    },
    cancel: () => {
      if (!saving) {
        setDraft(null);
        setError('');
        stroke.current = null;
      }
    },
    undo: () =>
      setDraft((d) =>
        !d?.undo.length
          ? d
          : {
              ...d,
              edits: d.undo[d.undo.length - 1],
              undo: d.undo.slice(0, -1),
              redo: [...d.redo, d.edits],
              version: d.version + 1,
            },
      ),
    redo: () =>
      setDraft((d) =>
        !d?.redo.length
          ? d
          : {
              ...d,
              edits: d.redo[d.redo.length - 1],
              redo: d.redo.slice(0, -1),
              undo: [...d.undo, d.edits],
              version: d.version + 1,
            },
      ),
    apply: async () => {
      if (!draft || !valid || saving || !draft.edits.size) return;
      setSaving(true);
      setError('');
      try {
        const data = await arenaRequest('map', {
          runId: draft.base.status.runId,
          revision: draft.base.world.mapRevision || 0,
          edits: [...draft.edits.values()],
        });
        onSaved(data);
        setDraft(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not apply map changes.');
      } finally {
        setSaving(false);
      }
    },
  };
}
export type MapEditorState = ReturnType<typeof useMapEditor>;
