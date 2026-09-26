import type { Snapshot } from '../../../core/src/evolution/types.js';
import { groupPopulation } from '../../../core/src/evolution/world.js';
import { ARENA_CONTROL_COLOR, ARENA_GROUP_COLORS } from '../constants.js';

export function PopulationChart({
  snapshot,
  reviewing,
}: {
  snapshot: Snapshot | null;
  reviewing: boolean;
}) {
  if (!snapshot) return null;
  const { world } = snapshot;
  const groups = world.groups;
  const maxTime = Math.max(60, world.time);
  const maxPop = Math.max(50, ...world.history.flatMap((p) => Object.values(p.populations)));
  return (
    <section className="side-panel population-panel" aria-label="Live population">
      <div className="eyebrow">
        {reviewing ? 'RECORDED FRAME' : snapshot.status.running ? 'LIVE POPULATION' : 'POPULATION'}
      </div>
      <h2>The survival curve</h2>
      <div className="chart">
        <svg viewBox="0 0 300 142" role="img" aria-label="Population chart">
          {[0, 0.5, 1].map((n) => (
            <g key={n}>
              <line className="chart-grid" x1={30} x2={290} y1={112 - n * 92} y2={112 - n * 92} />
              <text className="chart-label" x={1} y={116 - n * 92}>
                {Math.round(n * maxPop)}
              </text>
            </g>
          ))}
          {groups.map((g) => (
            <polyline
              key={g.id}
              className="chart-line"
              data-group={g.id}
              strokeDasharray={g.controller === 'deterministic' ? '4 3' : undefined}
              style={{
                stroke:
                  g.controller === 'deterministic'
                    ? ARENA_CONTROL_COLOR
                    : ARENA_GROUP_COLORS[g.color],
              }}
              points={world.history
                .map(
                  (p) =>
                    `${30 + (p.time / maxTime) * 258},${112 - ((p.populations[g.id] || 0) / maxPop) * 92}`,
                )
                .join(' ')}
            />
          ))}
          <text className="chart-label" x={30} y={138}>
            0s
          </text>
          <text className="chart-label" x={250} y={138}>
            {Math.floor(maxTime)}s
          </text>
        </svg>
      </div>

      <div className="chart-key">
        {groups.map((g) => (
          <div key={g.id}>
            <span>
              <i
                className="lineage-dot"
                style={{
                  background:
                    g.controller === 'deterministic'
                      ? ARENA_CONTROL_COLOR
                      : ARENA_GROUP_COLORS[g.color],
                }}
              />
              {g.label}
            </span>
            <b>{groupPopulation(world, g)}</b>
          </div>
        ))}
      </div>
      <p className="small-note">
        {reviewing
          ? 'Showing the selected moment in this run.'
          : 'Population over simulation time.'}
      </p>
    </section>
  );
}
