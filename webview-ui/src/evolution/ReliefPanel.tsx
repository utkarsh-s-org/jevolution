import { RULES } from '../../../core/src/evolution/constants.js';
import type { ReliefEvent, Snapshot } from '../../../core/src/evolution/types.js';
import { ARENA_GROUP_COLORS } from '../constants.js';

function describe(event: ReliefEvent) {
  const amount = event.amount.toFixed(1);
  switch (event.kind) {
    case 'help':
      return `#${event.actor} requested food`;
    case 'collect':
      return `#${event.actor} gathered ${amount} food`;
    case 'share':
      return `#${event.actor} → #${event.recipient} · ${amount} food delivered`;
    case 'deposit':
      return `#${event.actor} stored ${amount} in cache ${event.cacheId! + 1}`;
    case 'withdraw':
      return `#${event.actor} took ${amount} from cache ${event.cacheId! + 1}`;
    case 'eatCargo':
      return `#${event.actor} ate ${amount} carried food`;
  }
}
export function ReliefPanel({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: Snapshot | null;
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  if (!snapshot) return null;
  const { world } = snapshot;
  if (!world.caches) return null; // Older recorded runs predate the relief system.
  const report = world.droughtReport;
  const alive = new Set(world.rabbits.map((r) => r.id));
  const events = [...world.reliefEvents]
    .filter((e) => selected === null || e.actor === selected || e.recipient === selected)
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);
  const totalStored = world.caches.reduce((sum, cache) => sum + cache.food, 0);
  return (
    <section className="side-panel relief-panel" aria-label="Drought rescue network">
      <div className="eyebrow">THE RESCUE NETWORK</div>
      <h2>Food can travel. So can help.</h2>
      <p className="small-note">
        Gather → carry → share. Gold packs mark carriers; pink rings mark food requests. All rabbit
        groups can use every cache.
      </p>
      <div className="relief-totals">
        <div>
          <strong>{world.rabbits.filter((r) => r.cargo > 0.1).length}</strong>
          <span>carrying food</span>
        </div>
        <div>
          <strong>{totalStored.toFixed(1)}</strong>
          <span>food in caches</span>
        </div>
      </div>
      <div className="cache-list" aria-label="Communal food caches">
        {world.caches.map((cache) => (
          <div
            key={cache.id}
            title={`Cache ${cache.id + 1} at (${Math.floor(cache.x)}, ${Math.floor(cache.y)})`}
          >
            <span>C{cache.id + 1}</span>
            <meter
              min={0}
              max={RULES.cacheCapacity}
              value={cache.food}
              aria-label={`Cache ${cache.id + 1} food`}
            />
            <b>{cache.food.toFixed(1)}</b>
          </div>
        ))}
      </div>
      <div className="group-results">
        {world.groups
          .filter((group) => group.species !== 'wolf')
          .map((group) => {
            const stats = world.stats[group.id].relief;
            const cohort = report?.cohort[group.id] || [];
            const survivors =
              report?.survivors?.[group.id] ?? cohort.filter((id) => alive.has(id)).length;
            const responses = [...stats.responses].sort((a, b) => a - b);
            return (
              <article key={group.id}>
                <h3>
                  <i
                    className="lineage-dot"
                    style={{ background: ARENA_GROUP_COLORS[group.color] }}
                  />
                  {group.label}
                </h3>
                <div className="compact-row">
                  <span>Deliveries / food shared</span>
                  <b>
                    {stats.deliveries} / {stats.foodShared.toFixed(1)}
                  </b>
                </div>
                <div
                  className="compact-row"
                  title={`Deliveries that raised a recipient from below ${RULES.urgentEnergy} energy to at least ${RULES.urgentEnergy}; not proof a death was prevented.`}
                >
                  <span>Urgent hunger relieved</span>
                  <b>{stats.urgentFed}</b>
                </div>
                <div
                  className="compact-row"
                  title="Time from the recipient's first unresolved help request to food delivery, including travel. Not API latency."
                >
                  <span>Median request → meal</span>
                  <b>
                    {responses.length
                      ? `${responses[Math.floor(responses.length / 2)].toFixed(1)}s`
                      : '—'}
                  </b>
                </div>
                {report && (
                  <div className="drought-cohort">
                    <span>{report.survivors ? 'Survived drought' : 'Drought cohort alive'}</span>
                    <strong>
                      {survivors} / {cohort.length}
                    </strong>
                    <small>Original rabbits only · births excluded</small>
                    <small>
                      {report.deliveries?.[group.id] ??
                        stats.deliveries - report.baseline[group.id].deliveries}{' '}
                      deliveries during this drought
                    </small>
                  </div>
                )}
              </article>
            );
          })}
      </div>
      <div className="relief-feed-title">
        <h3>{selected === null ? 'Live food trail' : `Food trail · rabbit #${selected}`}</h3>
        {selected !== null && <button onClick={() => onSelect(null)}>Show all</button>}
      </div>
      <p className="small-note">
        Run totals above. Select a food event to follow that rabbit; rewind to inspect earlier
        events.
      </p>
      <ol className="relief-feed">
        {events.map((event) => (
          <li key={event.id} className={event.kind === 'share' ? 'delivery' : ''}>
            <button onClick={() => onSelect(event.recipient ?? event.actor)}>
              <time>{event.time.toFixed(1)}s</time>
              <span>
                {describe(event)}
                {event.kind === 'share' && (
                  <small>
                    Energy {event.energyBefore?.toFixed(0)} → {event.energyAfter?.toFixed(0)}
                    {event.responseSeconds !== undefined
                      ? ` · ${event.responseSeconds.toFixed(1)}s after request`
                      : ' · no prior help request'}
                  </small>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {!events.length && (
        <p className="relief-empty">
          {selected === null
            ? 'No food activity yet. Start the ecosystem and watch the models choose whether to gather, share, or store.'
            : 'No recent food events for this rabbit.'}
        </p>
      )}
    </section>
  );
}
