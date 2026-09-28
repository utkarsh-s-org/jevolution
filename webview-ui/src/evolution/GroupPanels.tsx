import { useMemo } from 'react';

import { GENE_NAMES, TRAIT_INFO } from '../../../core/src/evolution/constants.js';
import {
  costBreakdown,
  distribution,
  mechanismSummary,
  populationAccounting,
} from '../../../core/src/evolution/reporting.js';
import { meanGenes } from '../../../core/src/evolution/simulation.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';
import { createWorld, groupPopulation } from '../../../core/src/evolution/world.js';
import { ARENA_CONTROL_COLOR, ARENA_GROUP_COLORS } from '../constants.js';

function percentile(values: number[], p: number) {
  const stats = distribution(values);
  const value = p === 0.5 ? stats.median : stats.p95;
  return value === null ? 'N/A' : `${Math.round(value)} ms`;
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
                  <span>{v === undefined ? 'N/A' : Math.round(v * 100)}</span>
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
  const research = !!status.config.experiments?.researchClock;
  return (
    <section className="side-panel latency-panel">
      <h2>Every millisecond counts.</h2>
      <p className="small-note">
        {research
          ? 'Research clock · biology waits for the complete round'
          : status.config.timing === 'equalized'
            ? 'Equal timing control'
            : 'Actual API round trips'}
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
                    <span>Queue median / p95 ({research ? 'wall' : 'world'} ms)</span>
                    <b>
                      {percentile(research ? (s.queueWallMs ?? []) : s.queueMs, 0.5)} /{' '}
                      {percentile(research ? (s.queueWallMs ?? []) : s.queueMs, 0.95)}
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
                    <span>Late / errors / {research ? 'queued' : 'request-ready'}</span>
                    <b>
                      {s.late} / {s.errors} /{' '}
                      {research && !status.running ? 0 : status.backlog[g.id] || 0}
                    </b>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
      <div className="deadline-note">
        {research ? 'Provider timeout' : 'Decision window'}{' '}
        <strong>
          {research
            ? 15000
            : status.config.timing === 'equalized'
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
  const mechanism = mechanismSummary(world);
  return (
    <section className="side-panel">
      <h2>Experiment accounting</h2>
      <div className="compact-row">
        <span>Clock</span>
        <b>{mechanism.settings.researchClock ? 'Fixed 50ms steps · 2s rounds' : 'Real time'}</b>
      </div>
      {status.clock?.mode === 'research' && (
        <p className="small-note">
          Round {status.clock.round} · {status.running ? status.clock.phase : 'paused'} ·{' '}
          {status.clock.queued} waiting to send
        </p>
      )}
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
        may have unreported usage. API latency uses real time; queue delay uses{' '}
        {mechanism.settings.researchClock ? 'real time while biology waits' : 'world time'}.
      </p>
    </section>
  );
}

export function MechanismPanel({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return null;
  const m = mechanismSummary(snapshot.world);
  return (
    <section className="side-panel">
      <h2>Active mechanisms</h2>
      <p className="small-note">
        These settings affected this recorded frame. Preview-only sliders do not affect the engine.
      </p>
      {(
        [
          ['Paired reproduction and development', m.settings.demographics],
          ['Finite resources and hunting costs', m.settings.resources],
          ['Local sensing and persistent decisions', m.settings.decisions],
          ['Local signals', m.settings.communication],
        ] as const
      ).map(([label, active]) => (
        <div className="compact-row" key={label}>
          <span>{label}</span>
          <b>{active ? 'On' : 'Off'}</b>
        </div>
      ))}
      <div className="compact-row">
        <span>Arrivals</span>
        <b>{m.immigration}</b>
      </div>
      <div className="compact-row">
        <span>Agent objective</span>
        <b>{m.objective}</b>
      </div>
      {m.demographics?.map((group) => (
        <article key={group.id}>
          <h3>{group.label}</h3>
          <div className="compact-row">
            <span>Adults / juveniles</span>
            <b>
              {group.adults} / {group.juveniles}
            </b>
          </div>
          <div className="compact-row">
            <span>Dependent young / pregnant</span>
            <b>
              {group.dependent} / {group.pregnant}
            </b>
          </div>
        </article>
      ))}
      {m.settings.demographics && (
        <p className="small-note">
          {m.counters.conceptions ?? 0} conceptions · {(m.counters.careEnergy ?? 0).toFixed(1)}{' '}
          energy transferred from parents. Dependent young are included in juveniles.
        </p>
      )}
      {m.resources && (
        <>
          <h3>Resource accounting</h3>
          <div className="compact-row">
            <span>Attack attempts / carcasses remaining</span>
            <b>
              {m.counters.attackAttempts ?? 0} / {m.resources.carcasses}
            </b>
          </div>
          <div className="compact-row">
            <span>Carcass energy created</span>
            <b>{m.resources.created.toFixed(1)}</b>
          </div>
          <div className="compact-row">
            <span>Eaten + decayed + remaining</span>
            <b>
              {m.resources.eaten.toFixed(1)} + {m.resources.decayed.toFixed(1)} +{' '}
              {m.resources.remaining.toFixed(1)}
            </b>
          </div>
          <p className="small-note">
            Carcass balance residual: {m.resources.residual.toExponential(2)} energy units. This is
            not a whole-ecosystem energy budget.
          </p>
          <div className="compact-row">
            <span>Water remaining / capacity</span>
            <b>
              {m.resources.waterRemaining.toFixed(0)} / {m.resources.waterCapacity}
            </b>
          </div>
          <div className="compact-row">
            <span>Depleted water tiles</span>
            <b>{m.resources.depletedWaterTiles}</b>
          </div>
        </>
      )}
      <p className="small-note">
        Illustrative simulation units; these mechanisms are not field-calibrated wildlife
        predictions. One run cannot establish a survival benefit.
      </p>
    </section>
  );
}
