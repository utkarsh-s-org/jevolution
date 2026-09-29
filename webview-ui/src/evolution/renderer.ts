import { GRID, RULES } from '../../../core/src/evolution/constants.js';
import { brushBounds, paintMapBrush, paintTile } from '../../../core/src/evolution/mapEditor.js';
import type { Rabbit, Snapshot, Tile, World } from '../../../core/src/evolution/types.js';
import { tileAt } from '../../../core/src/evolution/world.js';
import { ARENA_GROUP_COLORS } from '../constants.js';
import { startGameLoop } from '../office/engine/gameLoop.js';
import { atlas, type Sprite } from './atlas.js';
import { CANVAS_MAX_DPR, PALETTE as C, SPRITE_FRAME_SECONDS, TILE_PX as T } from './constants.js';
import { type TerrainDecoration, terrainDecorations } from './terrainDecoration.js';
import type { MapEditorState } from './useMapEditor.js';

interface Assets {
  animals: Sprite[][];
  terrain: Sprite[][];
}
interface View {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
function tinted(s: Sprite, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = s.width;
  canvas.height = s.height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.image, s.x, s.y, s.width, s.height, 0, 0, s.width, s.height);
  const image = ctx.getImageData(0, 0, s.width, s.height);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < image.data.length; i += 4) {
    const [r, g, b] = image.data.slice(i, i + 3);
    if (image.data[i + 3] && Math.min(r, g, b) > 90 && Math.max(r, g, b) - Math.min(r, g, b) < 75) {
      const shade = Math.max(r, g, b) / 255;
      for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(rgb[c] * shade);
    }
  }
  ctx.putImageData(image, 0, 0);
  return { image: canvas, x: 0, y: 0, width: s.width, height: s.height };
}
function sprite(
  ctx: CanvasRenderingContext2D,
  s: Sprite,
  x: number,
  y: number,
  width: number,
  height: number,
  face = 1,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(face, 1);
  ctx.drawImage(
    s.image,
    s.x,
    s.y,
    s.width,
    s.height,
    Math.round(-width / 2),
    -height,
    width,
    height,
  );
  ctx.restore();
}
function rect(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}
function ground(world: World) {
  const canvas = document.createElement('canvas');
  canvas.width = GRID * T;
  canvas.height = GRID * T;
  const ctx = canvas.getContext('2d')!;
  for (const tile of world.tiles) {
    const { x, y, kind, decor } = tile;
    const px = x * T;
    const py = y * T;
    rect(
      ctx,
      kind === 'water'
        ? C.water
        : kind === 'mountain'
          ? C.rockDark
          : kind === 'forest'
            ? C.forest
            : C.grass[decor % C.grass.length],
      px,
      py,
      T,
      T,
    );
    if (kind === 'water') {
      if (decor % 3 === 0) rect(ctx, C.waterDeep, px, py, T, T);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const neighbor = tileAt(world, { x: x + dx, y: y + dy });
        if (neighbor && neighbor.kind !== 'water')
          rect(
            ctx,
            C.shoreline,
            px + (dx === 1 ? T - 3 : 0),
            py + (dy === 1 ? T - 3 : 0),
            dx ? 3 : T,
            dy ? 3 : T,
          );
      }
    } else if (kind === 'mountain') {
      rect(ctx, C.rock, px, py, T - 1, T - 4);
      rect(ctx, C.rockLight, px + 1, py, T - 3, 2);
      if (decor % 2 === 0) rect(ctx, C.rockDark, px + 5, py + 5, 5, 2);
    } else {
      rect(
        ctx,
        kind === 'forest' ? C.forestLight : C.ground,
        px + (decor % 11),
        py + (decor % 7),
        2,
        3,
      );
      if (decor % 4 === 0) rect(ctx, C.forestLight, px + 9, py + 12, 3, 1);
    }
  }
  return canvas;
}
function signalBubble(signal: Exclude<Rabbit['lastSignal'], 'none'>) {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 27;
  const ctx = canvas.getContext('2d')!;
  // Native pixel art: integer rectangles only, including the symbol and tail.
  ctx.fillStyle = C.bubbleInk;
  ctx.fillRect(3, 0, 18, 22);
  ctx.fillRect(1, 1, 22, 20);
  ctx.fillRect(0, 3, 24, 16);
  ctx.fillRect(10, 21, 6, 3);
  ctx.fillRect(11, 24, 4, 2);
  ctx.fillRect(12, 26, 2, 1);
  ctx.fillStyle =
    signal === 'help'
      ? C.bubbleHelp
      : signal === 'danger'
        ? C.bubbleDanger
        : signal === 'food'
          ? C.bubbleFood
          : C.bubbleFollow;
  ctx.fillRect(3, 2, 18, 18);
  ctx.fillRect(2, 3, 20, 16);
  ctx.fillRect(11, 20, 4, 3);
  ctx.fillRect(12, 23, 2, 2);
  const glyphs = {
    help: ['01110', '10001', '00010', '00100', '00100', '00000', '00100'],
    danger: ['00100', '00100', '00100', '00100', '00000', '00000', '00100'],
    food: ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
    follow: ['10000', '01000', '00100', '00010', '00100', '01000', '10000'],
  };
  ctx.fillStyle = C.bubbleInk;
  glyphs[signal].forEach((row, y) =>
    [...row].forEach((pixel, x) => {
      if (pixel === '1') ctx.fillRect(7 + x * 2, 4 + y * 2, 2, 2);
    }),
  );
  return canvas;
}

export function attachRenderer(
  canvas: HTMLCanvasElement,
  getSnapshot: () => Snapshot | null,
  getSelected: () => number | null,
  onSelect: (id: number | null) => void,
  onError: (message: string) => void,
  getEditor: () => MapEditorState,
  getFollowing: () => boolean,
  stopFollowing: () => void,
) {
  const bubbles = {
    help: signalBubble('help'),
    danger: signalBubble('danger'),
    food: signalBubble('food'),
    follow: signalBubble('follow'),
  };
  let assets: Assets | null = null;
  let base: HTMLCanvasElement | null = null;
  let mapKey = '';
  let decorations = new Map<number, TerrainDecoration>();
  let ghostKey = '';
  let ghostTiles: Tile[] = [];
  let ghostDecorations = new Map<number, TerrainDecoration>();
  let hover: { x: number; y: number } | null = null;
  let painting = false;
  let strokeStarted = false;
  let zoom = 1;
  let followed: number | null = null;
  let pan = { x: 0, y: 0 };

  let pointer: { x: number; y: number; moved: boolean } | null = null;
  let view: View = { scale: 1, x: 0, y: 0, width: 1, height: 1 };
  let disposed = false;
  void Promise.all([atlas('/evolution/animals.png', 4, 3), atlas('/evolution/terrain.png', 4, 2)])
    .then(([animals, terrain]) => {
      if (!disposed)
        assets = {
          animals: [
            ...animals,
            ...ARENA_GROUP_COLORS.slice(2).map((color) => animals[0].map((s) => tinted(s, color))),
          ],
          terrain,
        };
    })
    .catch((error) => onError(error instanceof Error ? error.message : 'Asset load failed'));
  const resize = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(CANVAS_MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  });
  resize.observe(canvas);
  const stop = startGameLoop(canvas, {
    update() {},
    render(ctx) {
      if (!canvas.width || !canvas.height) return;
      const snapshot = getSnapshot();
      rect(ctx, C.background, 0, 0, canvas.width, canvas.height);
      if (!snapshot || !assets) return;
      const { world } = snapshot;
      const elapsed = world.time;
      const selected = getSelected();
      const editor = getEditor();
      const nextKey = `${snapshot.status.runId}:${world.seed}:${world.mapRevision || 0}:${editor.open && editor.valid ? editor.version : 'live'}`;
      if (mapKey !== nextKey || !base) {
        base = ground(world);
        decorations = terrainDecorations(world.tiles);
        mapKey = nextKey;
      }
      canvas.style.cursor =
        editor.open && editor.brush !== 'pan' ? 'crosshair' : pointer ? 'grabbing' : 'grab';
      const dpr = Math.min(CANVAS_MAX_DPR, window.devicePixelRatio || 1);
      const animal =
        getFollowing() && !editor.open
          ? [...world.rabbits, ...world.wolves].find((item) => item.id === selected)
          : undefined;
      if (animal && followed !== animal.id) zoom = Math.max(zoom, 2);
      followed = animal?.id ?? null;
      const gutter = 0;
      const scale =
        (Math.max(1, Math.min(canvas.width, canvas.height) - gutter * 2) / (GRID * T)) * zoom;
      if (animal) {
        const mapSize = GRID * T * scale;
        const origin = (wanted: number, size: number) =>
          mapSize + gutter * 2 <= size
            ? (size - mapSize) / 2
            : Math.max(size - mapSize - gutter, Math.min(gutter, wanted));
        // Follow near an edge without panning past the world into empty space.
        pan = {
          x:
            (origin(canvas.width / 2 - animal.x * T * scale, canvas.width) -
              (canvas.width - mapSize) / 2) /
            dpr,
          y:
            (origin(canvas.height / 2 - (animal.y - 0.5) * T * scale, canvas.height) -
              (canvas.height - mapSize) / 2) /
            dpr,
        };
      }
      const x = (canvas.width - GRID * T * scale) / 2 + pan.x * dpr;
      const y = (canvas.height - GRID * T * scale) / 2 + pan.y * dpr;
      view = { scale, x, y, width: canvas.width, height: canvas.height };
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.scale(scale, scale);
      rect(ctx, C.ink, 0, GRID * T, GRID * T, 10);
      ctx.drawImage(base, 0, 0);
      for (const tile of world.tiles) {
        if (tile.kind === 'water' && tile.decor % 5 === 0) {
          const phase = Math.floor(elapsed * 1.5 + tile.x * 0.2) % 4;
          rect(ctx, C.waterLight, tile.x * T + phase, tile.y * T + 5 + (tile.decor % 6), 5, 1);
        }
        if (tile.kind === 'grass' || tile.kind === 'forest') {
          const px = tile.x * T;
          const py = tile.y * T;
          if (tile.kind === 'grass' && tile.food > 0.5) {
            const colors = tile.food >= 3 ? C.foodRich : C.foodSparse;
            rect(ctx, colors[tile.decor % colors.length], px, py, T, T);
          }
          // Density reflects food actually available, not just fertile ground.
          const tufts = Math.min(4, Math.floor(tile.food / 1.2));
          for (let i = 0; i < tufts; i++) {
            const tx = px + 2 + ((tile.decor + i * 7) % 11);
            const ty = py + 4 + ((tile.decor + i * 5) % 9);
            rect(ctx, C.forest, tx, ty, 1, 3);
            rect(ctx, C.foodTips, tx - 1, ty - 1, 1, 2);
            rect(ctx, C.foodTips, tx + 1, ty, 1, 2);
          }
          if (tile.foodCapacity > 0.5 && tile.food <= 0.5) {
            rect(ctx, C.dirt, px + 2 + (tile.decor % 3), py + 3, 10, 8);
            rect(ctx, C.ground, px + 7, py + 6, 2, 2);
          }
        }
      }
      for (const signal of world.signals) {
        if (signal.kind !== 'help' || signal.delivered > world.time) continue;
        ctx.save();
        ctx.strokeStyle = C.bubbleHelp;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(
          signal.x * T,
          signal.y * T,
          Math.min(signal.range * T, 8 + (world.time - signal.delivered) * T),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      }
      for (const event of world.reliefEvents || []) {
        if (event.kind !== 'share' || world.time - event.time > 3 || event.time > world.time)
          continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - (world.time - event.time) / 3);
        ctx.strokeStyle = C.cargo;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(event.from.x * T, event.from.y * T);
        ctx.lineTo(event.to.x * T, event.to.y * T);
        ctx.stroke();
        ctx.font = 'bold 9px monospace';
        ctx.fillStyle = C.cargo;
        ctx.fillText(
          `+${event.amount.toFixed(1)} food`,
          event.to.x * T + 4,
          event.to.y * T - 25 - (world.time - event.time) * 4,
        );
        ctx.restore();
      }
      const draws: { y: number; draw: () => void }[] = [];
      for (const tile of world.tiles) {
        const d = decorations.get(tile.y * GRID + tile.x);
        if (d)
          draws.push({
            y: (tile.y + 1) * T,
            draw: () =>
              sprite(
                ctx,
                assets!.terrain[d.row][d.column],
                (tile.x + 0.5) * T,
                (tile.y + 1) * T,
                d.width,
                d.height,
                1,
                tile.kind === 'forest' &&
                  world.rabbits.some(
                    (r) => Math.abs(r.x - tile.x) < 2 && Math.abs(r.y - tile.y) < 2,
                  )
                  ? 0.65
                  : 1,
              ),
          });
      }
      for (const carcass of world.carcasses || [])
        draws.push({
          y: carcass.y * T,
          draw: () => {
            rect(ctx, C.cacheWood, carcass.x * T - 6, carcass.y * T - 3, 12, 6);
            rect(ctx, C.ink, carcass.x * T - 4, carcass.y * T - 1, 8, 2);
            rect(
              ctx,
              C.cargo,
              carcass.x * T - 6,
              carcass.y * T + 5,
              12 * Math.min(1, carcass.energy / 65),
              2,
            );
          },
        });
      for (const cache of world.caches || [])
        draws.push({
          y: cache.y * T + 6,
          draw: () => {
            const x = cache.x * T + 12,
              y = cache.y * T;
            rect(ctx, C.ink, x - 7, y - 8, 15, 11);
            rect(ctx, C.cacheWood, x - 6, y - 7, 13, 9);
            rect(ctx, C.cargo, x - 5, y - 6, 11 * Math.min(1, cache.food / RULES.cacheCapacity), 7);
            ctx.font = 'bold 8px monospace';
            ctx.fillStyle = C.cargo;
            ctx.fillText(`C${cache.id + 1}`, x - 6, y + 11);
          },
        });
      const drawRabbit = (r: Rabbit) => {
        const groupColor = world.groups.find((g) => g.id === r.lineage)?.color || 0;
        const atlasRow = groupColor < 2 ? groupColor : groupColor + 1;
        const px = r.x * T;
        const py = r.y * T;

        if (selected === r.id) {
          ctx.strokeStyle = C.selection;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px - 12, py - 22, 24, 25);
          ctx.strokeStyle = C.trail;
          ctx.beginPath();
          ctx.moveTo(px, py);
          for (const p of r.path) ctx.lineTo(p.x * T, p.y * T);
          ctx.stroke();
        }
        rect(ctx, C.shadow, px - 8, py - 2, 16, 4);
        const frame = r.path.length
          ? 1 + (Math.floor(elapsed / SPRITE_FRAME_SECONDS + r.id) % 2)
          : r.action === 'forage'
            ? 3
            : 0;
        sprite(ctx, assets!.animals[atlasRow][frame], px, py + 1, 20, 23, r.face);
        if (selected === r.id || r.energy < 25) {
          rect(ctx, C.ink, px - 9, py + 4, 18, 3);
          rect(
            ctx,
            r.energy < 25 ? C.claude : C.selection,
            px - 9,
            py + 4,
            (18 * r.energy) / 100,
            2,
          );
        }
        if (r.cargo > 0.1) {
          rect(ctx, C.ink, px - 13, py - 12, 8, 9);
          rect(ctx, C.cargo, px - 12, py - 11, 6, 7);
          rect(ctx, C.cacheWood, px - 11, py - 10, 4, 2);
        }
        if (r.pending) {
          rect(ctx, C.ink, px + 8, py - 24, 8, 6);
          rect(ctx, C.signal, px + 10, py - 22, 2, 2);
        }
        if (r.signalUntil > world.time && r.lastSignal !== 'none') {
          // Part of the same pixel scene as the rabbit: no shadow or screen-space scaling.
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(bubbles[r.lastSignal], Math.round(px - 12), Math.round(py - 48));
          ctx.restore();
        }
      };
      for (const r of world.rabbits) draws.push({ y: r.y * T + 1, draw: () => drawRabbit(r) });
      for (const w of world.wolves)
        draws.push({
          y: w.y * T + 1,
          draw: () => {
            if (selected === w.id) {
              ctx.strokeStyle = C.selection;
              ctx.lineWidth = 1;
              ctx.strokeRect(w.x * T - 17, w.y * T - 28, 34, 31);
            }
            rect(ctx, C.shadow, w.x * T - 12, w.y * T - 2, 24, 5);
            const frame = w.path.length ? 1 + (Math.floor(elapsed / SPRITE_FRAME_SECONDS) % 2) : 0;
            sprite(ctx, assets!.animals[2][frame], w.x * T, w.y * T + 2, 33, 27, w.face);
            const group = world.groups.find((g) => g.id === w.lineage);
            if (group) {
              rect(ctx, C.ink, w.x * T - 4, w.y * T - 29, 8, 5);
              rect(ctx, ARENA_GROUP_COLORS[group.color], w.x * T - 3, w.y * T - 28, 6, 3);
            }
            if (
              group?.wolfLifeCycle === 'dynamic' &&
              (selected === w.id || (w.energy ?? 100) < 20)
            ) {
              rect(ctx, C.ink, w.x * T - 9, w.y * T + 4, 18, 3);
              rect(
                ctx,
                (w.energy ?? 100) < 20 ? C.claude : C.selection,
                w.x * T - 9,
                w.y * T + 4,
                (18 * Math.max(0, w.energy ?? 0)) / 100,
                2,
              );
            }
            if (w.pending) rect(ctx, C.signal, w.x * T + 7, w.y * T - 27, 2, 2);
          },
        });
      draws.sort((a, b) => a.y - b.y).forEach((item) => item.draw());
      if (editor.open && editor.valid) {
        ctx.strokeStyle = C.editorGrid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let i = 0; i <= GRID; i++) {
          ctx.moveTo(i * T, 0);
          ctx.lineTo(i * T, GRID * T);
          ctx.moveTo(0, i * T);
          ctx.lineTo(GRID * T, i * T);
        }
        ctx.stroke();
        if (hover && editor.brush !== 'pan') {
          const { left, top, right, bottom } = brushBounds(hover, editor.brush, editor.size);
          ctx.fillStyle = C.editorBrush;
          ctx.fillRect(left * T, top * T, (right - left) * T, (bottom - top) * T);
          ctx.strokeStyle = C.selection;
          ctx.lineWidth = 1;
          ctx.strokeRect(left * T, top * T, (right - left) * T, (bottom - top) * T);
          const nextGhostKey = `${mapKey}:${editor.brush}:${left}:${top}:${right}:${bottom}`;
          if (nextGhostKey !== ghostKey) {
            ghostKey = nextGhostKey;
            const preview = world.tiles.slice();
            ghostTiles = [];
            for (const edit of paintMapBrush(world.tiles, [hover], editor.brush, editor.size)) {
              const index = edit.y * GRID + edit.x;
              preview[index] = paintTile(preview[index], edit.brush);
              ghostTiles.push(preview[index]);
            }
            ghostDecorations = terrainDecorations(preview);
          }
          for (const tile of ghostTiles) {
            const d = ghostDecorations.get(tile.y * GRID + tile.x);
            if (d)
              sprite(
                ctx,
                assets.terrain[d.row][d.column],
                (tile.x + 0.5) * T,
                (tile.y + 1) * T,
                d.width,
                d.height,
                1,
                0.6,
              );
            else if (tile.kind === 'water' || tile.kind === 'grass') {
              ctx.save();
              ctx.globalAlpha = 0.55;
              rect(
                ctx,
                tile.kind === 'water' ? C.water : tile.food ? C.foodRich[0] : C.grass[0],
                tile.x * T,
                tile.y * T,
                T,
                T,
              );
              ctx.restore();
            }
          }
        }
      }
      ctx.restore();
    },
  });
  const point = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (((event.clientX - bounds.left) / bounds.width) * view.width - view.x) / view.scale / T,
      y: (((event.clientY - bounds.top) / bounds.height) * view.height - view.y) / view.scale / T,
    };
  };
  const updateHover = (event: PointerEvent) => {
    const p = point(event);
    hover =
      p.x >= 0 && p.y >= 0 && p.x < GRID && p.y < GRID
        ? { x: Math.floor(p.x), y: Math.floor(p.y) }
        : null;
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    updateHover(event);
    const editor = getEditor();
    painting = editor.open && editor.brush !== 'pan';
    pointer = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
    strokeStarted = false;
    if (painting && hover) {
      editor.paint(hover, true);
      strokeStarted = true;
    }
  };
  const move = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    const previous = hover;
    updateHover(event);
    if (painting) {
      if (hover && (hover.x !== previous?.x || hover.y !== previous?.y)) {
        getEditor().paint(hover, !strokeStarted);
        strokeStarted = true;
      }
      return;
    }
    if (!pointer) return;
    const dx = event.clientX - pointer.x,
      dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
    if (pointer.moved) {
      stopFollowing();
      pan.x += dx;
      pan.y += dy;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }
  };
  const up = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    if (pointer && !pointer.moved && !getEditor().open && !painting) {
      const p = point(event);
      if (!canvas.width || !canvas.height) return;
      const snapshot = getSnapshot();
      const nearest = [...(snapshot?.world.rabbits || []), ...(snapshot?.world.wolves || [])]
        .map((r) => ({ id: r.id, d: Math.hypot(r.x - p.x, r.y - 0.5 - p.y) }))
        .sort((a, b) => a.d - b.d)[0];
      onSelect(nearest && nearest.d < 1.4 ? nearest.id : null);
    }
    pointer = null;
    painting = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const cancel = () => {
    pointer = null;
    painting = false;
  };
  const leave = () => {
    if (!pointer) hover = null;
  };
  const key = (event: KeyboardEvent) => {
    const editor = getEditor();
    if (!editor.open || !editor.valid || editor.saving || editor.brush === 'pan') return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!moves[event.key] && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    hover ||= { x: Math.floor(GRID / 2), y: Math.floor(GRID / 2) };
    if (moves[event.key])
      hover = {
        x: Math.max(0, Math.min(GRID - 1, hover.x + moves[event.key][0])),
        y: Math.max(0, Math.min(GRID - 1, hover.y + moves[event.key][1])),
      };
    else editor.paint(hover, true);
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    zoom = Math.max(1, Math.min(3, zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
    if (zoom === 1) pan = { x: 0, y: 0 };
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', cancel);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('keydown', key);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return {
    zoomIn: () => {
      zoom = Math.min(3, zoom + 0.4);
    },
    zoomOut: () => {
      zoom = Math.max(1, zoom - 0.4);
    },
    fit: () => {
      zoom = 1;
      pan = { x: 0, y: 0 };
    },
    dispose: () => {
      disposed = true;
      stop();
      resize.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', cancel);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('keydown', key);
      canvas.removeEventListener('wheel', wheel);
    },
  };
}
