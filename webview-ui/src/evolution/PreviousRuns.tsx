import { useEffect, useState } from 'react';

import type { SavedRun } from './cloudRuns.js';
export function PreviousRuns({ onOpen }: { onOpen: (run: SavedRun) => Promise<void> }) {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [opening, setOpening] = useState('');
  const [more, setMore] = useState(false);
  async function load(offset = 0) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/arena/runs?offset=${offset}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load your runs.');
      setRuns((previous) => (offset ? [...previous, ...data.runs] : data.runs));
      setMore(data.runs.length === 25);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load your runs.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="previous-runs" aria-label="Previous runs">
      <div className="runs-heading">
        <div>
          <p className="eyebrow">YOUR EXPERIMENTS</p>
          <h1>Previous runs</h1>
          <p>
            Reopen a recorded habitat, rewind decisions, and explore its analytics. Replay uses no
            model credits.
          </p>
        </div>
        <button className="secondary-button" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Loading saved runs…</p>}
      {!busy && !error && !runs.length && (
        <div className="runs-empty">
          <h2>Your first experiment starts in Habitat.</h2>
          <p>
            Started runs save automatically to this account. Pause before leaving and check for
            “Saved to your account”.
          </p>
        </div>
      )}
      <div className="runs-grid">
        {runs.map((run) => (
          <article className="saved-run" key={run.id}>
            <p className="eyebrow">
              {run.config.scenario === 'predatorPrey' ? 'PREDATOR–PREY' : 'HABITAT'}
            </p>
            <h2>
              <time dateTime={run.created_at}>
                {new Date(run.created_at).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
            </h2>
            <p>
              {Math.floor(run.duration_seconds / 60)}m {Math.floor(run.duration_seconds % 60)}s ·{' '}
              {run.frames.toLocaleString()} frames · Seed {run.seed}
            </p>
            <p>
              {run.groups
                .map(
                  (group) =>
                    `${group.label} (${group.controller === 'deterministic' ? 'deterministic' : group.model})`,
                )
                .join(' · ')}
            </p>
            <dl>
              {Object.entries(run.populations).map(([name, count]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{count} alive</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>Run settings</summary>
              <pre>{JSON.stringify(run.config, null, 2)}</pre>
            </details>
            <button
              className="primary-button"
              disabled={!!opening}
              onClick={async () => {
                setOpening(run.id);
                setError('');
                try {
                  await onOpen(run);
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Could not open replay.');
                } finally {
                  setOpening('');
                }
              }}
            >
              {opening === run.id ? 'Opening…' : 'Open replay'}
            </button>
          </article>
        ))}
      </div>
      {more && (
        <button className="secondary-button" disabled={busy} onClick={() => void load(runs.length)}>
          Load more
        </button>
      )}
    </section>
  );
}
