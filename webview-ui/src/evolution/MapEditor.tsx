import { useEffect, useRef, useState } from 'react';

import type { MapBrush } from '../../../core/src/evolution/mapEditor.js';
import { atlas } from './atlas.js';
import type { MapEditorState } from './useMapEditor.js';

const tools: { brush: MapBrush | 'pan'; name: string; hint: string }[] = [
  { brush: 'grass', name: 'Ground', hint: 'Clear land without food' },
  { brush: 'food', name: 'Food grass', hint: 'Fertile grass that regrows food' },
  { brush: 'forest', name: 'Trees', hint: 'Place one tree in a 3 × 3 footprint' },
  { brush: 'water', name: 'Water', hint: 'Blocks movement; animals drink from the shore' },
  {
    brush: 'mountain',
    name: 'Mountain',
    hint: 'Place one 3 × 3 mountain; blocks movement and sight',
  },
  { brush: 'shelter', name: 'Burrow', hint: 'Rabbit shelter with an empty food cache' },
  { brush: 'pan', name: 'Pan', hint: 'Drag to move the map without painting' },
];
let iconsPromise: Promise<Record<string, string>> | undefined;
function terrainIcons() {
  return (iconsPromise ??= atlas('/evolution/terrain.png', 4, 2).then((sprites) =>
    Object.fromEntries(
      [
        ['forest', 0, 0],
        ['mountain', 1, 0],
        ['shelter', 1, 1],
      ].map(([kind, row, col]) => {
        const s = sprites[Number(row)][Number(col)];
        const c = document.createElement('canvas');
        c.width = 36;
        c.height = 36;
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        const scale = Math.min(32 / s.width, 32 / s.height);
        const width = Math.round(s.width * scale),
          height = Math.round(s.height * scale);
        ctx.drawImage(
          s.image,
          s.x,
          s.y,
          s.width,
          s.height,
          Math.floor((36 - width) / 2),
          34 - height,
          width,
          height,
        );
        return [kind, c.toDataURL()];
      }),
    ),
  ));
}
export function MapEditor({ editor }: { editor: MapEditorState }) {
  const panel = useRef<HTMLElement>(null);
  const current = useRef(editor);
  current.current = editor;
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void terrainIcons()
      .then((value) => {
        if (alive) setIcons(value);
      })
      .catch(() => {});
    const previous = document.activeElement as HTMLElement | null;
    const scrollY = window.scrollY;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const dialog = panel.current?.closest('[role="dialog"]');
        const elements = [
          ...(dialog?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) || []),
        ].filter((el) => el.getClientRects().length);
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      const e = current.current;
      if (e.valid && !e.saving) {
        if (event.shiftKey) e.redo();
        else e.undo();
      }
    };
    document.addEventListener('keydown', keys);
    return () => {
      alive = false;
      document.removeEventListener('keydown', keys);
      document.body.style.overflow = overflow;
      window.scrollTo({ top: scrollY });
      previous?.focus({ preventScroll: true });
    };
  }, []);
  const disabled = editor.saving || !editor.valid;
  return (
    <section ref={panel} className="map-editor" aria-label="Map editor">
      <div className="editor-heading">Terrain</div>
      <div className="terrain-tools" role="group" aria-label="Terrain brushes">
        {tools.map((tool) => (
          <button
            key={tool.brush}
            type="button"
            className="terrain-tool"
            aria-pressed={editor.brush === tool.brush}
            disabled={disabled}
            title={tool.hint}
            onClick={() => editor.setBrush(tool.brush)}
          >
            {icons[tool.brush] ? (
              <img alt="" src={icons[tool.brush]} width="36" height="36" />
            ) : (
              <span aria-hidden="true" className={`terrain-icon terrain-${tool.brush}`} />
            )}
            <span>{tool.name}</span>
          </button>
        ))}
      </div>
      <div className="editor-options">
        <label>
          {editor.stamp ? 'Stamp' : 'Brush'}{' '}
          <select
            aria-label="Brush size"
            value={editor.size}
            disabled={disabled || editor.brush === 'pan' || editor.stamp}
            onChange={(e) => editor.setSize(Number(e.target.value))}
          >
            <option value={1}>1 × 1</option>
            <option value={3}>3 × 3</option>
            <option value={5}>5 × 5</option>
          </select>
        </label>
        <div className="editor-history">
          <button
            className="secondary-button"
            disabled={disabled || !editor.canUndo}
            title="Undo (⌘/Ctrl Z)"
            onClick={editor.undo}
          >
            Undo
          </button>
          <button
            className="secondary-button"
            disabled={disabled || !editor.canRedo}
            title="Redo (⌘/Ctrl Shift Z)"
            onClick={editor.redo}
          >
            Redo
          </button>
        </div>
      </div>
      {editor.stamp && (
        <p className="editor-stamp-hint">One object per 3 × 3. Drag to place more.</p>
      )}
      <div className="editor-finish">
        <span role="status">{editor.changed} tiles painted</span>
        {editor.error && (
          <p role="alert" className="editor-error">
            {editor.error}
          </p>
        )}
        <div className="editor-actions">
          <button className="secondary-button" disabled={editor.saving} onClick={editor.cancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={disabled || !editor.changed}
            onClick={() => void editor.apply()}
          >
            {editor.saving ? 'Saving…' : 'Apply map'}
          </button>
        </div>
      </div>
    </section>
  );
}
