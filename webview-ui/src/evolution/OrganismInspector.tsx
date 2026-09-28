import { GENE_NAMES, RULES, TRAIT_INFO } from '../../../core/src/evolution/constants.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';

export function OrganismInspector({
  snapshot,
  selected,
  onSelect,
  compact = false,
}: {
  compact?: boolean;
  snapshot: Snapshot | null;
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const world = snapshot?.world;
  const groups = world?.groups || [];
  const groupName = (id: string) => groups.find((g) => g.id === id)?.label || id;
  const rabbit = world?.rabbits.find((r) => r.id === selected);
  const wolf = world?.wolves.find((w) => w.id === selected);
  const wolfGroup = groups.find((g) => g.id === wolf?.lineage);
  if (compact && rabbit)
    return (
      <div className="compact-animal">
        <div className="vital">
          <span>Energy</span>
          <div>
            <i style={{ width: `${rabbit.energy}%` }} />
          </div>
          <b>{Math.round(rabbit.energy)}</b>
        </div>
        <div className="vital">
          <span>Water</span>
          <div>
            <i style={{ width: `${rabbit.water}%` }} />
          </div>
          <b>{Math.round(rabbit.water)}</b>
        </div>
        <div className="animal-facts">
          <span title="Carried food">
            Food <b>{(rabbit.cargo ?? 0).toFixed(1)}/4</b>
          </span>
          <span
            title={rabbit.parents.length ? `Parents #${rabbit.parents.join(' + #')}` : 'Founder'}
          >
            Gen <b>{rabbit.generation}</b> · {Math.floor(rabbit.age)}s
          </span>
          <span title="Current engine action">{rabbit.action}</span>
          <span title="Follow decisions / other decisions when following was available">
            Follow{' '}
            <b>
              {rabbit.behavior.followed}/{rabbit.behavior.followed + rabbit.behavior.other}
            </b>
          </span>
        </div>
        <div className="compact-genes">
          {GENE_NAMES.map((k) => (
            <div className="organism-gene" key={k}>
              <span>{TRAIT_INFO[k].label}</span>
              <b>{Math.round(rabbit.genes[k] * 100)}</b>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <section className={`side-panel inspect-panel${compact ? ' compact-inspector' : ''}`}>
      {rabbit ? (
        <>
          <div className="eyebrow">ORGANISM INSPECTOR</div>
          <div className="organism-title">
            <div
              className={`portrait ${groups.find((g) => g.id === rabbit.lineage)?.color === 1 ? 'claude' : 'jev'}-portrait`}
            />
            <div>
              <h2>Rabbit #{rabbit.id}</h2>
              <span>
                {groupName(rabbit.lineage).toUpperCase()} · GENERATION {rabbit.generation}
              </span>
            </div>
            <button aria-label="Close inspector" onClick={() => onSelect(null)}>
              ×
            </button>
          </div>
          <div className="vital">
            <span>Energy</span>
            <div>
              <i style={{ width: `${rabbit.energy}%` }} />
            </div>
            <b>{Math.round(rabbit.energy)}</b>
          </div>
          <div className="vital">
            <span>Water</span>
            <div>
              <i style={{ width: `${rabbit.water}%` }} />
            </div>
            <b>{Math.round(rabbit.water)}</b>
          </div>
          <div className="compact-row">
            <span>Carried food</span>
            <b>{(rabbit.cargo ?? 0).toFixed(1)} / 4</b>
          </div>
          {rabbit.recipientId !== undefined && (
            <p className="small-note">Delivering to rabbit #{rabbit.recipientId}</p>
          )}
          <div className="compact-row">
            <span>{rabbit.action.toUpperCase()}</span>
            <span>{rabbit.pending ? 'DECIDING…' : 'ACTING'}</span>
          </div>
          <p className="small-note">
            Age {Math.floor(rabbit.age)}s ·{' '}
            {rabbit.parents.length ? `Parents #${rabbit.parents.join(' + #')}` : 'Founder'} · Last
            call {rabbit.lastLatency === null ? 'N/A' : `${Math.round(rabbit.lastLatency)} ms`}
          </p>
          <p
            className="small-note"
            title="Accepted decisions with an available follow action; choosing another action is not necessarily uncooperative."
          >
            Follow / chose other: {rabbit.behavior.followed} / {rabbit.behavior.other}
          </p>
          {GENE_NAMES.map((k) => (
            <div className="organism-gene" key={k}>
              <span>{TRAIT_INFO[k].label}</span>
              <b>{Math.round(rabbit.genes[k] * 100)}</b>
            </div>
          ))}
        </>
      ) : wolf ? (
        <>
          <div className="organism-header">
            <div className="portrait wolf-portrait" />
            <div>
              <h2>Wolf #{wolf.id}</h2>
              <span>{wolfGroup?.label}</span>
            </div>
            <button aria-label="Close inspector" onClick={() => onSelect(null)}>
              ×
            </button>
          </div>
          <div className="compact-row">
            <span>Controller</span>
            <b>{wolfGroup?.controller === 'deterministic' ? 'Deterministic' : wolfGroup?.label}</b>
          </div>
          <div className="compact-row">
            <span>{wolf.action?.toUpperCase() || 'REST'}</span>
            <span>{wolf.pending ? 'DECIDING…' : 'ACTING'}</span>
          </div>
          <div className="compact-row">
            <span>Hunting</span>
            <b>{wolf.cooldown > 0 ? `Eating · ${Math.ceil(wolf.cooldown)}s` : 'Ready to hunt'}</b>
          </div>
          {wolfGroup?.wolfLifeCycle === 'dynamic' ? (
            <>
              <div className="compact-row">
                <span>Energy</span>
                <b>{Math.max(0, wolf.energy ?? 0).toFixed(1)} / 100</b>
              </div>
              <div className="compact-row">
                <span>Age / generation</span>
                <b>
                  {Math.floor(wolf.age ?? 0)}s / {wolf.generation ?? 0}
                </b>
              </div>
              <div className="compact-row">
                <span>Next birth cooldown</span>
                <b>{Math.ceil(wolf.reproductionCooldown ?? 0)}s</b>
              </div>
              <div className="compact-row">
                <span>Mate / parents</span>
                <b>
                  {wolf.mateId ? `#${wolf.mateId}` : 'N/A'} /{' '}
                  {(wolf.parents ?? (wolf.parentId ? [wolf.parentId] : []))
                    .map((id) => `#${id}`)
                    .join(' + ') || 'Founder'}
                </b>
              </div>
              {!compact && (
                <p className="small-note">
                  Births need two same-group wolves to choose each other and meet nearby. Both need{' '}
                  {RULES.wolfBreedEnergy} energy and age {RULES.wolfMaturity}s; each pays{' '}
                  {RULES.wolfBreedCost} energy. Hunger and old age cause death.
                </p>
              )}
            </>
          ) : (
            <p className="small-note">Births and deaths disabled · wolves are immortal.</p>
          )}
          <p className="small-note">
            Last call:{' '}
            {wolfGroup?.controller === 'deterministic'
              ? 'Not applicable · deterministic'
              : wolf.lastLatency == null
                ? 'N/A'
                : `${Math.round(wolf.lastLatency)} ms`}
          </p>
        </>
      ) : (
        <>
          <div className="eyebrow">LOOK A LITTLE CLOSER</div>
          <h2>Meet the inhabitants.</h2>
          <p className="small-note">
            Select a rabbit to inspect its traits, or a wolf to inspect its controller and hunger.
          </p>
          <select
            aria-label="Inspect an animal"
            value=""
            onChange={(event) => onSelect(Number(event.target.value))}
          >
            <option value="">Choose an organism…</option>
            {world?.rabbits.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} · {groupName(r.lineage)} · generation {r.generation}
              </option>
            ))}
            {world?.wolves.map((w) => (
              <option key={w.id} value={w.id}>
                #{w.id} · Wolf · {groupName(w.lineage || '')}
              </option>
            ))}
          </select>
        </>
      )}
    </section>
  );
}
