import { useMemo } from 'react';

import { GENE_NAMES, TRAIT_INFO } from '../../../core/src/evolution/constants.js';
import { costBreakdown, populationAccounting } from '../../../core/src/evolution/reporting.js';
import { meanGenes } from '../../../core/src/evolution/simulation.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';
import { createWorld, groupPopulation } from '../../../core/src/evolution/world.js';
import { ARENA_CONTROL_COLOR, ARENA_GROUP_COLORS } from '../constants.js';

function percentile(values: number[], p: number) {
  if (!values.length) return '—';
  const sorted = [...values].sort((a, b) => a - b);
  return `${Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))])} ms`;
}
export function PopulationOutcomes({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return null;
  const { world } = snapshot;
  const groups = world.groups;
  const accounts = populationAccounting(world);
  return (
    <section className="side-panel">
      <h2>Population outcomes</h2>
      <div className="group-results">
        {groups.map((g) => {
          const s = world.stats[g.id];
          const b = s.behavior;
          const account = accounts.find((row) => row.id === g.id)!;
          return (
            <article
              key={g.id}
              data-group={g.id}
              className={g.controller === 'deterministic' ? 'deterministic-group' : undefined}
            >
              <h3>
                <i
                  className="lineage-dot"
                  style={{
                    background:
                      g.controller === 'deterministic'
                        ? ARENA_CONTROL_COLOR
                        : ARENA_GROUP_COLORS[g.color],
                  }}
                />
                {g.label} · {g.species === 'wolf' ? 'wolves' : 'rabbits'}
              </h3>
              {g.controller === 'deterministic' && (
                <p className="small-note">Deterministic · no API calls</p>
              )}
              <div className="compact-row">
                <span>
                  {g.species === 'wolf' && g.wolfLifeCycle !== 'dynamic'
                    ? 'Population (fixed)'
                    : 'Living / births / deaths'}
                </span>
                <b>
                  {groupPopulation(world, g)}
                  {g.species !== 'wolf' || g.wolfLifeCycle === 'dynamic'
                    ? ` / ${s.births} / ${s.deaths}`
                    : ''}
                </b>
              </div>
              <div className="compact-row">
                <span>Initial + births + arrivals − deaths</span>
                <b>
                  {account.initial ?? '?'} + {account.births} + {account.immigrants} −{' '}
                  {account.deaths} = {account.expected ?? '?'}
                </b>
              </div>
              <p className="small-note">
                {account.residual === 0
                  ? 'Population balances.'
                  : `Unexplained difference: ${account.residual ?? 'unknown'}`}
              </p>
              {g.species === 'wolf' && g.wolfLifeCycle === 'dynamic' && (
                <div className="compact-row">
                  <span>Starvation / old age</span>
                  <b>
                    {s.starvation} / {s.oldAge}
                  </b>
                </div>
              )}
              {g.species === 'wolf' ? (
                <div className="compact-row">
                  <span>Rabbits caught</span>
                  <b>{s.kills || 0}</b>
                </div>
              ) : (
                <>
                  <div className="compact-row">
                    <span>Lost to wolves</span>
                    <b>{s.predation}</b>
                  </div>
                  <div
                    className="compact-row"
                    title="Accepted decisions where following was available."
                  >
                    <span>Follow / chose other</span>
                    <b>
                      {b.followed} / {b.other}
                    </b>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function InheritedTraits({ snapshot }: { snapshot: Snapshot | null }) {
  const rosterKey = JSON.stringify(snapshot?.world.groups);
  const seed = snapshot?.world.seed;
  const scenario = snapshot?.world.scenario;
  const founders = useMemo(
    () => (seed === undefined ? null : createWorld(seed, JSON.parse(rosterKey), scenario)),
    [seed, rosterKey, scenario],
  );
  if (!snapshot) return null;
  const { world } = snapshot;
  const rabbitGroups = world.groups.filter((g) => g.species !== 'wolf');
  return (
    <section className="side-panel traits-panel">
      <h2>Inherited traits</h2>

      <p className="small-note">
        Rabbit genes · 0–100. Vertical marks show founders. Wolves have fixed traits.
      </p>
      {GENE_NAMES.map((gene) => (
        <div className="trait-row" key={gene}>
          <span>{TRAIT_INFO[gene].label}</span>
          {rabbitGroups.map((g) => {
            const v = meanGenes(world, g.id)?.[gene];
            const initial = founders && meanGenes(founders, g.id)?.[gene];
            return (
              <div key={g.id}>
                <div className="compact-row">
                  <span>{g.label}</span>
                  <span>{v === undefined ? '—' : Math.round(v * 100)}</span>
                </div>
                <div className="trait-track">
                  <i
                    style={{
                      background:
                        g.controller === 'deterministic'
                          ? ARENA_CONTROL_COLOR
                          : ARENA_GROUP_COLORS[g.color],
                      width: `${(v || 0) * 100}%`,
                      height: '100%',
                    }}
                  />
                  {initial !== undefined && initial !== null && (
                    <i className="founder-tick" style={{ left: `${initial * 100}%` }} />
                  )}
                </div>
              </div>
            );
          })}
          <p>{TRAIT_INFO[gene].cost}</p>
        </div>
      ))}
      <p className="small-note">
        Sociability affects signal range and cost. Follow counts measure behavior, not an inherited
        cooperation gene.
      </p>
    </section>
  );
}

export function LatencyPanel({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return null;
  const { world, status } = snapshot;
  const groups = world.groups;
  return (
    <section className="side-panel latency-panel">
      <h2>Every millisecond counts.</h2>
      <p className="small-note">
        {status.config.timing === 'equalized' ? 'Equal timing control' : 'Actual API round trips'}
      </p>
      <div className="group-results">
        {groups.map((g) => {
          const s = world.stats[g.id];
          return (
            <article
              key={g.id}
              data-group={g.id}
              className={g.controller === 'deterministic' ? 'deterministic-group' : undefined}
            >
              <h3>
                <i
                  className="lineage-dot"
                  style={{
                    background:
                      g.controller === 'deterministic'
                        ? ARENA_CONTROL_COLOR
                        : ARENA_GROUP_COLORS[g.color],
                  }}
                />
                {g.label} · {g.species === 'wolf' ? 'wolves' : 'rabbits'}
              </h3>
              {g.controller === 'deterministic' ? (
                <p className="small-note">Deterministic · no API calls</p>
              ) : (
                <>
                  <div className="compact-row">
                    <span>Median / p95</span>
                    <b>
                      {percentile(s.latencies, 0.5)} / {percentile(s.latencies, 0.95)}
                    </b>
                  </div>
                  <div className="compact-row">
                    <span>Queue median / p95 (world ms)</span>
                    <b>
                      {percentile(s.queueMs, 0.5)} / {percentile(s.queueMs, 0.95)}
                    </b>
                  </div>
                  <div className="compact-row">
                    <span>Invalid / cancelled</span>
                    <b>
                      {s.invalid} / {s.cancelled}
                    </b>
                  </div>
                  <div className="compact-row">
                    <span>Applied / returned</span>
                    <b>
                      {s.applied} / {s.latencies.length}
                    </b>
                  </div>
                  <div className="compact-row">
                    <span>Late / errors / queued</span>
                    <b>
                      {s.late} / {s.errors} / {status.backlog[g.id] || 0}
                    </b>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
      <div className="deadline-note">
        Decision window{' '}
        <strong>
          {status.config.timing === 'equalized'
            ? status.config.equalizedMs
            : status.config.deadlineMs}{' '}
          ms
        </strong>
      </div>
    </section>
  );
}

export function ExperimentPanel({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return null;
  const { world, status } = snapshot;
  const requests = Object.values(world.stats).reduce((sum, s) => sum + s.requested, 0);
  const capped = requests >= status.config.maxRequests && world.time < status.config.maxSeconds;
  const cost = costBreakdown(world);
  return (
    <section className="side-panel">
      <h2>Experiment accounting</h2>
      <p className="small-note">
        {capped
          ? 'Request cap reached before the target horizon. Compare at a matched world time.'
          : status.reason}
      </p>
      <div className="compact-row">
        <span>World time / target</span>
        <b>
          {world.time.toFixed(1)} / {status.config.maxSeconds} s
        </b>
      </div>
      <div className="compact-row">
        <span>Requests / limit</span>
        <b>
          {requests} / {status.config.maxRequests}
        </b>
      </div>
      {cost.groups.map((g) => (
        <div className="compact-row" key={g.id}>
          <span>{g.id} · reported usage</span>
          <b>{g.usd === null ? 'Unknown price' : `$${g.usd.toFixed(4)}`}</b>
        </div>
      ))}
      <p className="small-note">{cost.caveat}</p>
      <p className="small-note">
        {cost.groups.reduce((n, g) => n + g.potentiallyUnreportedCalls, 0)} error/cancelled calls
        may have unreported usage. API latency uses real time; queue delay uses world time.
      </p>
    </section>
  );
}
