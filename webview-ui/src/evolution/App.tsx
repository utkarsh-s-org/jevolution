import { useEffect, useRef, useState } from 'react';

import {
  DEFAULT_CONFIG,
  DEFAULT_GROUPS,
  GRID,
  PREDATOR_PREY_GROUPS,
  PROVIDER_KEYS,
  SCENARIO_CONFIG,
} from '../../../core/src/evolution/constants.js';
import { defaultExperimentPreview } from '../../../core/src/evolution/experimentPreview.js';
import type {
  Lineage,
  ModelGroup,
  RunConfig,
  Scenario,
  Snapshot,
} from '../../../core/src/evolution/types.js';
import { groupPopulation } from '../../../core/src/evolution/world.js';
import { ARENA_CONTROL_COLOR, ARENA_GROUP_COLORS } from '../constants.js';
import { DecisionPanel } from './DecisionPanel.js';
import { ExperimentControls } from './ExperimentControls.js';
import { FieldGuide } from './FieldGuide.js';
import { InheritedTraits, LatencyPanel, PopulationOutcomes } from './GroupPanels.js';
import { arenaRequest, HOSTED, hostedClient } from './hostedClient.js';
import { MapEditor } from './MapEditor.js';
import { ModelSettings } from './ModelSettings.js';
import { OrganismInspector } from './OrganismInspector.js';
import { PopulationChart } from './PopulationChart.js';
import { RabbitDistributions } from './RabbitDistributions.js';
import { ReliefPanel } from './ReliefPanel.js';
import { attachRenderer } from './renderer.js';
import { useArenaFullscreen } from './useArenaFullscreen.js';
import { useMapEditor } from './useMapEditor.js';
import { useReplay } from './useReplay.js';

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const replay = useReplay(snapshot);
  const editor = useMapEditor(snapshot, replay.reviewing, setSnapshot);
  const editing = useRef(editor);
  editing.current = editor;
  const [groupsDraft, setGroupsDraft] = useState<ModelGroup[]>(DEFAULT_GROUPS);
  const [selected, setSelected] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  const tracking = useRef(false);
  tracking.current = following;
  const selectAnimal = (id: number | null) => {
    setSelected(id);
    setFollowing(id !== null);
  };
  const [showSettings, setShowSettings] = useState(false);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!showSettings) return;
    const dialog = settingsDialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [showSettings]);
  const [view, setView] = useState<'habitat' | 'analytics' | 'notes' | 'guide'>('habitat');
  const navigate = (next: typeof view) => {
    setView(next);
    window.scrollTo({ top: 0 });
  };
  const app = useRef<HTMLDivElement>(null);
  const fullscreen = useArenaFullscreen(app);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<RunConfig>({ ...DEFAULT_CONFIG });
  const [seed, setSeed] = useState(271828);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef<Snapshot | null>(null);
  latest.current = editor.preview || replay.shown;
  const selection = useRef<number | null>(null);
  selection.current = selected;
  const renderer = useRef<ReturnType<typeof attachRenderer> | null>(null);
  useEffect(() => {
    if (view !== 'habitat' || editor.open) return;
    const workspace = app.current?.querySelector<HTMLElement>('.workspace');
    const panel = workspace?.querySelector<HTMLElement>('.habitat-panel');
    if (!workspace || !panel) return;
    const update = () => {
      const footer = [...panel.children]
        .filter((el) => !el.classList.contains('canvas-wrap'))
        .reduce((height, el) => height + el.getBoundingClientRect().height, 0);
      workspace.style.setProperty('--map-width', `${Math.max(1, panel.clientHeight - footer)}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    for (const child of panel.children)
      if (!child.classList.contains('canvas-wrap')) observer.observe(child);
    update();
    return () => observer.disconnect();
  }, [view, editor.open]);
  useEffect(() => {
    if (HOSTED)
      return hostedClient().subscribe((next) => {
        setSnapshot(next);
        setConnected(true);
      });
    const events = new EventSource('/api/arena/events');
    events.onmessage = (event) => {
      const data = JSON.parse(event.data) as Snapshot;
      setSnapshot(data);
      setConnected(true);
    };
    events.onerror = () => setConnected(false);
    void fetch('/api/arena/state')
      .then((r) => r.json())
      .then((data: Snapshot) => {
        setSnapshot(data);
        setConfig(data.status.config);
        setGroupsDraft(data.world.groups);
        setSeed(data.world.seed);
      })
      .catch(() => setError('Cannot reach the ecosystem server. Start it with npm run arena.'));
    return () => events.close();
  }, []);
  useEffect(() => {
    if (!canvas.current) return;
    const instance = attachRenderer(
      canvas.current,
      () => latest.current,
      () => selection.current,
      (id) => {
        setSelected(id);
        setFollowing(id !== null);
      },
      setError,
      () => editing.current,
      () => tracking.current,
      () => setFollowing(false),
    );
    renderer.current = instance;
    return () => instance.dispose();
  }, []);
  async function control(action: string) {
    if (HOSTED && action === 'start' && !hostedClient().authenticated) {
      setShowAccess(true);
      return;
    }
    if (action === 'start' || action === 'reset') replay.goLive();
    setBusy(true);
    setError('');
    try {
      const data = await arenaRequest('control', {
        action,
        ...(action === 'reset' ? { seed, config, groups: groupsDraft } : {}),
      });
      setSnapshot(data as Snapshot);
      if (action === 'reset') {
        selectAnimal(null);
        setShowSettings(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Control failed');
    } finally {
      setBusy(false);
    }
  }
  const world = replay.shown?.world;
  const status = replay.shown?.status;
  const liveStatus = snapshot?.status;
  const groups = world?.groups || DEFAULT_GROUPS;
  const color = (id: string) => ARENA_GROUP_COLORS[groups.find((g) => g.id === id)?.color || 0];
  const count = (l: Lineage) => {
    const group = groups.find((g) => g.id === l);
    return world && group ? groupPopulation(world, group) : 0;
  };
  const total = world?.rabbits.length || 0;
  const missingKeys = liveStatus && Object.values(liveStatus.ready).some((ready) => !ready);
  const generation = Math.max(0, ...(world?.rabbits.map((r) => r.generation) || []));
  const droughtSeconds = world ? Math.max(0, Math.ceil(world.droughtUntil - world.time)) : 0;
  const populationSummary = (
    <section
      className="stats-strip"
      aria-label="Population summary"
      style={
        view === 'habitat'
          ? undefined
          : { gridTemplateColumns: `repeat(${groups.length + 2}, minmax(140px, 1fr))` }
      }
    >
      {groups.map((g) => (
        <div
          className={`stat lineage-stat ${g.controller === 'deterministic' ? 'deterministic-group' : ''}`}
          key={g.id}
        >
          <div
            className={`portrait ${g.species === 'wolf' ? 'wolf' : g.color === 1 ? 'claude' : 'jev'}-portrait`}
          />
          <div>
            <span>{g.label.toUpperCase()}</span>
            <strong>
              {count(g.id)}
              <small>
                {g.species === 'wolf'
                  ? g.controller === 'deterministic'
                    ? 'wolves · Deterministic'
                    : 'wolves · AI model'
                  : `${total ? Math.round((count(g.id) / total) * 100) : 0}% of rabbits`}
              </small>
            </strong>
          </div>
          <i
            className="lineage-dot"
            style={{
              background: g.controller === 'deterministic' ? ARENA_CONTROL_COLOR : color(g.id),
            }}
          />
        </div>
      ))}
      <div className="stat">
        <span>DEEPEST GENERATION</span>
        <strong>
          {generation.toString().padStart(2, '0')}
          <small>inherited + mutated</small>
        </strong>
      </div>
      <div className="stat">
        <span>WORLD TIME</span>
        <strong>
          {time(world?.time || 0)}
          <small>
            {replay.reviewing
              ? 'recorded frame'
              : liveStatus?.running
                ? 'world is moving'
                : 'ecosystem paused'}
          </small>
        </strong>
      </div>
    </section>
  );
  const toolbar = (
    <div className="panel-toolbar">
      <div>
        <span className="eyebrow">{editor.open ? 'EDIT HABITAT' : 'THE COMMONS'}</span>
        <span className="map-meta">
          {GRID} × {GRID} · SEED {world?.seed || seed}
          {(world?.mapRevision || 0) > 0 ? ' · CUSTOM MAP' : ''}
        </span>
      </div>
      <div className="habitat-tools">
        <div className="habitat-state">
          <span className={`connection-dot ${status?.running ? 'connected' : ''}`} />
          {replay.reviewing ? 'REPLAY' : liveStatus?.running ? 'LIVE' : 'PAUSED'}
        </div>
        <div className={`map-weather${droughtSeconds > 0 ? ' active' : ''}`}>
          <button
            className="drought-trigger"
            disabled={
              !liveStatus?.running || replay.reviewing || busy || !connected || droughtSeconds > 0
            }
            title={
              droughtSeconds > 0
                ? 'Drought: exposed grass withers; carried and cached food stays safe'
                : status?.running
                  ? 'Trigger 60 seconds of withering grass, slow regrowth, and faster thirst'
                  : 'Start ecosystem to trigger a drought'
            }
            onClick={() => void control('drought')}
          >
            <span className="drought-sun" aria-hidden="true">
              ☀
            </span>
            <span>{droughtSeconds > 0 ? 'Drought active' : 'Trigger drought'}</span>
            {droughtSeconds > 0 && <strong>{droughtSeconds}s</strong>}
          </button>
          {droughtSeconds > 0 && (
            <progress value={droughtSeconds} max={60} aria-label="Drought seconds remaining" />
          )}
        </div>
      </div>
      <div className="playback simulation-controls">
        <div className="playback-actions">
          <button
            className="primary-button"
            disabled={
              editor.open ||
              busy ||
              !connected ||
              (!HOSTED && !liveStatus?.running && !!missingKeys)
            }
            onClick={() => void control(liveStatus?.running ? 'pause' : 'start')}
          >
            {liveStatus?.running
              ? 'Ⅱ Pause ecosystem'
              : replay.reviewing
                ? '▶ Resume latest state'
                : '▶ Start ecosystem'}
          </button>
          <button
            className="icon-button"
            title="Run settings and reset"
            aria-label="Open run settings"
            disabled={editor.open}
            onClick={() => {
              setConfig({
                ...(liveStatus?.config || DEFAULT_CONFIG),
                experimentPreview:
                  liveStatus?.config.experimentPreview ?? defaultExperimentPreview(),
              });
              setSeed(snapshot?.world.seed || 271828);
              setGroupsDraft(snapshot?.world.groups || DEFAULT_GROUPS);
              setShowSettings(true);
            }}
          >
            ⚙
          </button>
          <button
            className={`icon-button${editor.open ? ' active' : ''}`}
            aria-label="Edit map"
            aria-pressed={editor.open}
            title={
              liveStatus?.running
                ? 'Pause the simulation to edit the map'
                : replay.reviewing
                  ? 'Return to latest to edit the map'
                  : 'Edit map'
            }
            disabled={
              busy || !connected || !!liveStatus?.running || replay.reviewing || editor.open
            }
            onClick={() => {
              selectAnimal(null);
              editor.begin();
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 16 16 4l4 4L8 20H4v-4Z M13 7l4 4" />
            </svg>
          </button>
        </div>
        {!HOSTED && (
          <a className="export-link" href="/api/arena/export" download>
            Export run ↓
          </a>
        )}
        {HOSTED && (
          <button
            className="export-link"
            onClick={() => {
              void arenaRequest('export')
                .then((data) => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data })], {
                      type: 'application/json',
                    }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `jevolution-${data.status.runId}.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
                .catch((error: Error) => setError(error.message));
            }}
          >
            Export run ↓
          </button>
        )}
      </div>
      {editor.open && (
        <div className="editor-top-hint">Paused · paint to preview · apply when ready</div>
      )}
    </div>
  );
  const timeline = (
    <div className="replay-controls" aria-label="Replay controls">
      <div className="replay-heading">
        <span>{replay.reviewing ? `REPLAY · ${world?.time.toFixed(2)}s` : 'RUN TIMELINE'}</span>
        <small>
          {liveStatus?.running
            ? 'Pause to rewind'
            : replay.loading
              ? 'Loading frame…'
              : `Frame ${replay.index} / ${Math.max(0, (liveStatus?.replay.frames || 1) - 1)}`}
        </small>
      </div>
      <input
        type="range"
        aria-label="Replay timeline"
        min={0}
        max={Math.max(0, (liveStatus?.replay.frames || 1) - 1)}
        step={1}
        value={replay.index}
        disabled={editor.open || !!liveStatus?.running || !liveStatus?.replay.frames}
        onChange={(e) => replay.seek(Number(e.target.value))}
      />
      <div className="replay-buttons">
        <button
          className="secondary-button"
          disabled={editor.open || !replay.reviewing}
          onClick={replay.goLive}
        >
          Return to latest
        </button>
      </div>
      {(replay.error || liveStatus?.replay.error) && (
        <p role="alert">{replay.error || liveStatus?.replay.error}</p>
      )}
    </div>
  );
  return (
    <div ref={app} className={`arena-app${fullscreen.active ? ' is-fullscreen' : ''}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="jevolution home">
          <span className="brand-mark">◈</span> jevolution
        </a>
        <nav className="top-links" aria-label="Arena views">
          {(['habitat', 'analytics', 'notes', 'guide'] as const).map((item) => (
            <button
              key={item}
              className={view === item ? 'nav-active' : ''}
              aria-current={view === item ? 'page' : undefined}
              disabled={editor.open}
              onClick={() => navigate(item)}
            >
              {
                {
                  habitat: 'Habitat',
                  analytics: 'Analytics',
                  notes: 'Field notes',
                  guide: 'Field guide',
                }[item]
              }
            </button>
          ))}
        </nav>
        <div className="top-meta">
          <span className={`connection-dot ${connected ? 'connected' : ''}`} />
          {connected ? (HOSTED ? 'LIVE ENGINE' : 'LOCAL SERVER') : 'CONNECTING'}
        </div>
      </header>
      <main className={view === 'habitat' ? 'habitat-main' : undefined}>
        {showAccess && (
          <form
            className="run-access"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              void fetch('/api/arena/session', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ code: accessCode }),
              })
                .then(async (response) => {
                  const data = await response.json();
                  if (!response.ok) throw new Error(data.error || 'Could not unlock simulation');
                  setAccessCode('');
                  setShowAccess(false);
                  await hostedClient().request('refresh');
                })
                .catch((error: Error) => setError(error.message))
                .finally(() => setBusy(false));
            }}
          >
            <label htmlFor="run-access-code">Run access code</label>
            <input
              id="run-access-code"
              type="password"
              autoComplete="current-password"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              required
            />
            <button className="primary-button" disabled={busy}>
              Unlock simulation
            </button>
            <button type="button" className="secondary-button" onClick={() => setShowAccess(false)}>
              Cancel
            </button>
            <small>
              Protects the configured model API credits. Each browser runs its own ecosystem.
            </small>
          </form>
        )}
        {view !== 'habitat' && populationSummary}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}

        <div className="habitat-view" hidden={view !== 'habitat'}>
          <div className={`workspace${editor.open ? ' map-edit-mode' : ''}`}>
            <section
              className="habitat-panel"
              role={editor.open ? 'dialog' : undefined}
              aria-modal={editor.open || undefined}
              aria-label={editor.open ? 'Edit habitat' : undefined}
            >
              {editor.open && toolbar}
              {editor.open && <MapEditor editor={editor} />}
              <div
                className={`canvas-wrap${editor.open ? ' map-editing' : ''}${droughtSeconds > 0 ? ' drought-active' : ''}`}
              >
                <canvas
                  ref={canvas}
                  tabIndex={0}
                  aria-label={
                    editor.open
                      ? 'Map editor canvas. Click or drag to paint. Use arrow keys to move the brush and Enter to paint.'
                      : 'Interactive pixel-art ecosystem. Click an animal to inspect it. Drag to pan and scroll to zoom.'
                  }
                />
                <div className="map-controls">
                  <button aria-label="Zoom in" onClick={() => renderer.current?.zoomIn()}>
                    +
                  </button>
                  <button aria-label="Zoom out" onClick={() => renderer.current?.zoomOut()}>
                    −
                  </button>
                  <button
                    aria-label="Fit habitat"
                    title="Fit the whole map · stop following"
                    onClick={() => {
                      setFollowing(false);
                      renderer.current?.fit();
                    }}
                  >
                    ⌖
                  </button>
                  <button
                    className="icon-button fullscreen-button"
                    aria-label={fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'}
                    title={fullscreen.active ? 'Exit fullscreen (Esc)' : 'Fullscreen habitat'}
                    disabled={editor.open}
                    onClick={() => void fullscreen.toggle()}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        d={
                          fullscreen.active
                            ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6'
                            : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'
                        }
                      />
                    </svg>
                  </button>
                </div>
                <div className="map-hint">
                  {editor.open
                    ? 'PAINT TO BUILD · PAN TOOL TO MOVE · SCROLL TO ZOOM'
                    : following
                      ? 'FOLLOWING ANIMAL · DRAG TO STOP · TARGET TO FIT MAP'
                      : 'CLICK AN ANIMAL TO FOLLOW · DRAG TO PAN · SCROLL TO ZOOM'}
                </div>
              </div>
              {view === 'habitat' && timeline}
              {!editor.open && (
                <div className="habitat-caption" aria-label="Map legend">
                  <div className="legend">
                    {groups.map((g) => (
                      <span key={g.id}>
                        <i className="lineage-dot" style={{ background: color(g.id) }} /> {g.label}{' '}
                        · {g.species === 'wolf' ? 'wolves' : 'rabbits'}
                      </span>
                    ))}
                    <span>
                      <i className="lineage-dot grass" /> Food patches
                    </span>
                    <span>
                      <i className="lineage-dot depleted" /> Depleted
                    </span>
                    {world?.scenario !== 'predatorPrey' && (
                      <span>
                        <i className="lineage-dot food-cargo" /> Carried food / caches
                      </span>
                    )}
                    <span className="legend-end">{total} living rabbits</span>
                  </div>
                  <div className="signal-legend" aria-label="Rabbit communication legend">
                    <span className="signal-legend-title">RABBIT SIGNALS</span>
                    <span>
                      <b className="signal-symbol danger" aria-hidden="true">
                        !
                      </b>{' '}
                      Danger
                    </span>
                    <span>
                      <b className="signal-symbol food" aria-hidden="true">
                        +
                      </b>{' '}
                      Food here
                    </span>
                    <span>
                      <b className="signal-symbol follow" aria-hidden="true">
                        &gt;
                      </b>{' '}
                      Follow me
                    </span>
                    {world?.scenario !== 'predatorPrey' && (
                      <span>
                        <b className="signal-symbol help" aria-hidden="true">
                          ?
                        </b>{' '}
                        Need food
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>
            <aside className="habitat-sidebar" aria-label="Habitat dashboard">
              <div className="habitat-command">
                {!editor.open && toolbar}
                {view === 'habitat' && populationSummary}
                <div className="habitat-chart">
                  <PopulationChart snapshot={replay.shown} reviewing={replay.reviewing} />
                </div>
                <div className="run-status" aria-live="polite">
                  {replay.reviewing
                    ? 'Reviewing recorded state. Resume continues from the latest state.'
                    : liveStatus?.reason || 'Connecting to the ecosystem…'}
                </div>
                <button className="analytics-link" onClick={() => navigate('analytics')}>
                  Explore analytics →
                </button>
              </div>
              <div className="habitat-details">
                {view === 'habitat' && !editor.open && selected !== null && (
                  <DecisionPanel
                    key={`${snapshot?.status.runId}:${selected}`}
                    snapshot={replay.shown}
                    selected={selected}
                    reviewing={replay.reviewing}
                    following={following}
                    onFollow={() => setFollowing(!following)}
                    onClose={() => selectAnimal(null)}
                  />
                )}
                {view === 'habitat' && selected === null && (
                  <section className="side-panel decision-empty">
                    <div className="eyebrow">ANIMAL DECISIONS</div>
                    <h2>Follow a rabbit’s next move.</h2>
                    <p className="small-note">
                      Click an animal on the map to see its provider response, game action and
                      measured latency here.
                    </p>
                  </section>
                )}
              </div>
            </aside>
          </div>
        </div>
        {view === 'analytics' && (
          <section className="analytics-view" aria-label="Analytics">
            <div className="view-heading">
              <div>
                <span className="eyebrow">BEHIND THE BEHAVIOR</span>
                <h1>Analytics</h1>
                <p>
                  {replay.reviewing
                    ? 'Statistics from the selected replay frame.'
                    : 'Live outcomes, inherited traits, and model decisions.'}
                </p>
              </div>
              <button className="secondary-button" onClick={() => navigate('habitat')}>
                Back to habitat →
              </button>
            </div>
            <div className="analytics-timeline">
              {liveStatus?.running && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void control('pause')}
                >
                  Pause to rewind
                </button>
              )}
              {timeline}
            </div>
            <RabbitDistributions
              snapshot={replay.shown}
              selected={selected}
              onSelect={selectAnimal}
            />
            <div className="analytics-grid">
              <div className="analytics-column">
                <PopulationOutcomes snapshot={replay.shown} />
                <LatencyPanel snapshot={replay.shown} />
              </div>
              <div className="analytics-column">
                <InheritedTraits snapshot={replay.shown} />
              </div>
              <div className="analytics-column">
                <OrganismInspector
                  snapshot={replay.shown}
                  selected={selected}
                  onSelect={selectAnimal}
                />
                {/* Predator–prey turns food sharing off, so its panel would stay empty. */}
                {world?.scenario !== 'predatorPrey' && (
                  <ReliefPanel
                    snapshot={replay.shown}
                    selected={world?.rabbits.some((r) => r.id === selected) ? selected : null}
                    onSelect={selectAnimal}
                  />
                )}
              </div>
            </div>
          </section>
        )}
        {view === 'notes' && (
          <section className="field-notes-view" aria-label="Field notes">
            <section className="event-log">
              <div className="event-heading">
                <h1>Field notes</h1>
                <span>BIRTHS, LOSSES & ENVIRONMENTAL CHANGE</span>
              </div>
              <div className="event-list">
                {world?.events.map((event) => (
                  <div className="event" key={event.id}>
                    <time>{time(event.time)}</time>
                    <i
                      className="event-square"
                      style={event.lineage ? { background: color(event.lineage) } : undefined}
                    />
                    <span>{event.text}</span>
                    <small>{event.kind.toUpperCase()}</small>
                  </div>
                ))}
              </div>
            </section>
          </section>
        )}
        {view === 'guide' && <FieldGuide onReturn={() => navigate('habitat')} />}
        {view === 'analytics' && missingKeys && !HOSTED && (
          <section className="setup-panel">
            <div>
              <span className="eyebrow">CONNECT YOUR MODELS</span>
              <h3>The habitat is ready. Bring the intelligence.</h3>
              <p>
                Add the missing provider keys listed below to <code>.env.arena</code> in your
                project folder. Keys stay on your server.
              </p>
            </div>
            <div className="key-status">
              {snapshot?.world.groups.map((g) => (
                <span key={g.id}>
                  <i className={`connection-dot ${liveStatus?.ready[g.id] ? 'connected' : ''}`} />
                  {g.label}:{' '}
                  {g.controller === 'deterministic'
                    ? 'no key needed'
                    : liveStatus?.ready[g.id]
                      ? 'configured'
                      : PROVIDER_KEYS[g.provider]}
                </span>
              ))}
              <button
                onClick={() => {
                  void fetch('/api/arena/state')
                    .then((r) => r.json())
                    .then(setSnapshot)
                    .catch(() => setError('Could not refresh credentials.'));
                }}
              >
                Check keys ↻
              </button>
            </div>
          </section>
        )}

        {view !== 'habitat' && (
          <footer>
            <span>
              Built on Pixel Agents{' '}
              <a
                href="https://github.com/pixel-agents-hq/pixel-agents"
                target="_blank"
                rel="noreferrer"
              >
                ↗
              </a>{' '}
              · An illustrative ecosystem, not a biological forecast.
            </span>
            <span>
              {status ? Object.values(status.models).join(' / ') : 'LIVE MODEL INTEGRATION'}
              <br />
              Recorded usage estimate:{' '}
              {status?.estimatedCost === null || !status
                ? 'N/A'
                : `$${status.estimatedCost.toFixed(4)}`}{' '}
              · excludes unreported interrupted calls
            </span>
          </footer>
        )}
      </main>
      {showSettings && (
        <dialog
          ref={settingsDialog}
          className="settings-modal"
          aria-label="Run settings"
          onCancel={() => setShowSettings(false)}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]',
              ),
            ).filter((element) => element.getClientRects().length > 0);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              ) {
                setShowSettings(false);
              }
            }
          }}
        >
          <header className="settings-header">
            <button
              className="close-modal"
              aria-label="Close settings"
              onClick={() => setShowSettings(false)}
            >
              ×
            </button>
            <div className="eyebrow">EXPERIMENT CONTROLS</div>
            <h2>A new world. A different pressure.</h2>
          </header>
          <div className="settings-body">
            <p>
              Settings apply to a new run. Export the current run before resetting. Pause the
              ecosystem to change them.
            </p>
            <label className="scenario-setting">
              Scenario
              <select
                value={config.scenario ?? 'arena'}
                onChange={(e) => {
                  const next = e.target.value as Scenario;
                  // Each scenario starts from its own defaults; the arena keeps its roster.
                  setConfig({
                    ...SCENARIO_CONFIG[next],
                    experimentPreview: config.experimentPreview,
                  });
                  setGroupsDraft(
                    next === 'predatorPrey'
                      ? PREDATOR_PREY_GROUPS
                      : snapshot?.world.scenario === 'predatorPrey'
                        ? DEFAULT_GROUPS
                        : groupsDraft,
                  );
                }}
              >
                <option value="arena">Model arena (configure groups)</option>
                <option value="predatorPrey">Predator–prey (Jev wolves + Jev rabbits)</option>
              </select>
            </label>
            {config.scenario === 'predatorPrey' ? (
              <p className="small-note">
                Preset: 70 Jev rabbits and 8 Jev wolves. Rabbits breed on their own; wolves have
                pups from kills and starve without them, so both populations rise and fall in
                cycles. Like a real open habitat, a wolf and two rabbits join every 20 seconds
                beside their own kind. Uses your TypeSafe key only.
              </p>
            ) : (
              <ModelSettings
                groups={groupsDraft}
                onChange={setGroupsDraft}
                ready={liveStatus?.providerReady}
              />
            )}
            <ExperimentControls
              value={config.experimentPreview}
              disabled={!!liveStatus?.running || busy}
              onChange={(experimentPreview) => setConfig({ ...config, experimentPreview })}
            />
            <div className="settings-grid">
              <div className="seed-setting">
                <label htmlFor="habitat-seed">Habitat seed</label>
                <div className="seed-controls">
                  <input
                    id="habitat-seed"
                    aria-describedby="seed-help"
                    type="number"
                    min="1"
                    max="2147483647"
                    step="1"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const value = crypto.getRandomValues(new Uint32Array(1))[0];
                      const next = (value % 2147483647) + 1;
                      setSeed(next === seed ? (next % 2147483647) + 1 : next);
                    }}
                  >
                    Randomize seed
                  </button>
                </div>
                <p id="seed-help" className="seed-help">
                  New seed, new terrain and animal positions. No mirroring. Reset below to apply;
                  reuse a seed to repeat its starting world.
                </p>
              </div>
              <label>
                Timing mode
                <select
                  value={config.timing}
                  onChange={(e) =>
                    setConfig({ ...config, timing: e.target.value as RunConfig['timing'] })
                  }
                >
                  <option value="realtime">Real API latency</option>
                  <option value="equalized">Equal timing control</option>
                </select>
              </label>
              {(
                [
                  { key: 'deadlineMs', label: 'Decision deadline (ms)', min: 250, max: 15000 },
                  {
                    key: 'decisionIntervalMs',
                    label: 'Rest between calls (ms)',
                    min: 100,
                    max: 15000,
                  },
                  { key: 'maxInFlight', label: 'Concurrent calls / lineage', min: 1, max: 8 },
                  {
                    key: 'equalizedMs',
                    label: 'Equalized response slot (ms)',
                    min: 500,
                    max: 15000,
                  },
                  { key: 'maxRequests', label: 'Maximum calls / run', min: 2, max: 20000 },
                  { key: 'maxSeconds', label: 'Maximum duration (seconds)', min: 10, max: 1200 },
                  { key: 'timeScale', label: 'Simulation speed (×)', min: 1, max: 4 },
                ] as const
              ).map((item) => (
                <label key={item.key}>
                  {item.label}
                  <input
                    type="number"
                    min={item.min}
                    max={item.max}
                    value={config[item.key] ?? 1}
                    onChange={(e) => setConfig({ ...config, [item.key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <p className="small-note">
              Same observation rules, physical speeds, request concurrency, and action schema.
              Rabbit colors are display labels only. No model outcome is predetermined.
            </p>
          </div>
          <footer className="settings-footer">
            <button className="secondary-button" onClick={() => setShowSettings(false)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={busy || !!liveStatus?.running}
              onClick={() => void control('reset')}
            >
              Reset habitat with these settings →
            </button>
          </footer>
        </dialog>
      )}
    </div>
  );
}
