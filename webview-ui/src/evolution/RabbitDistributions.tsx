import { useState } from 'react';

import type { Genes, Rabbit, Snapshot } from '../../../core/src/evolution/types.js';
import { ARENA_GROUP_COLORS } from '../constants.js';

type Metric = keyof Genes | 'followRate' | 'energy';
const metrics: { id: Metric; label: string; description: string }[] = [
  {
    id: 'sociability',
    label: 'Sociability',
    description:
      'Inherited signal range and energy cost. A higher value does not mean a rabbit cooperates more.',
  },
  {
    id: 'followRate',
    label: 'Follow choice rate',
    description:
      'Follow choices ÷ accepted decisions with a follow option, over each living rabbit’s lifetime so far. Other choices are not necessarily ignored signals.',
  },
  {
    id: 'vigilance',
    label: 'Vigilance',
    description:
      'Inherited vision range, with a metabolism cost. Compare awareness across surviving rabbits.',
  },
  {
    id: 'fertility',
    label: 'Fertility',
    description:
      'Inherited reproduction cooldown benefit, with an energy cost. This is a trait, not a birth count.',
  },
  { id: 'speed', label: 'Speed', description: 'Inherited movement speed, with higher energy use.' },
  {
    id: 'thrift',
    label: 'Thrift',
    description: 'Inherited metabolism savings, traded against movement and eating speed.',
  },
  {
    id: 'energy',
    label: 'Energy',
    description: 'Current energy reserves. This is a changing state, not an inherited trait.',
  },
];
function value(rabbit: Rabbit, metric: Metric): number | null {
  if (metric === 'followRate')
    return rabbit.behavior?.offered
      ? (100 * rabbit.behavior.followed) / rabbit.behavior.offered
      : null;
  return metric === 'energy' ? rabbit.energy : rabbit.genes[metric] * 100;
}
export function RabbitDistributions({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: Snapshot | null;
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [metric, setMetric] = useState<Metric>('sociability');
  if (!snapshot) return null;
  const { world } = snapshot;
  const info = metrics.find((item) => item.id === metric)!;
  const subject = world.rabbits.find((rabbit) => rabbit.id === selected);
  const groups = world.groups.filter((group) => group.species !== 'wolf');
  const cohorts = groups.map((group) => {
    const rabbits = world.rabbits.filter((rabbit) => rabbit.lineage === group.id);
    const bins: Rabbit[][] = Array.from({ length: 10 }, () => []);
    const missing: Rabbit[] = [];
    for (const rabbit of rabbits) {
      const score = value(rabbit, metric);
      if (score === null) missing.push(rabbit);
      else bins[Math.max(0, Math.min(9, Math.floor(score / 10)))].push(rabbit);
    }
    return { group, rabbits, bins, missing };
  });
  const maxCount = Math.max(1, ...cohorts.flatMap(({ bins }) => bins.map((bin) => bin.length)));
  const rows = Math.ceil(maxCount / 2);
  const dot = (rabbit: Rabbit, color: string) => {
    const score = value(rabbit, metric);
    const label = `Rabbit #${rabbit.id} · ${info.label}: ${score === null ? 'no observations' : `${score.toFixed(1)}${metric === 'followRate' ? '%' : ''}`} · generation ${rabbit.generation}`;
    return (
      <button
        key={rabbit.id}
        type="button"
        className="rabbit-dot"
        style={{ background: color }}
        data-rabbit-id={rabbit.id}
        data-value={score ?? 'missing'}
        aria-label={label}
        title={label}
        aria-pressed={selected === rabbit.id}
        onClick={() => onSelect(rabbit.id)}
      />
    );
  };
  return (
    <section
      className="side-panel rabbit-distributions"
      aria-label="Individual rabbit distributions"
      data-time={world.time}
    >
      <div className="distribution-heading">
        <div>
          <div className="eyebrow">BEYOND THE AVERAGE · {world.time.toFixed(2)}s</div>
          <h2>Every rabbit tells a different story.</h2>
        </div>
        <label>
          Compare a metric
          <select
            aria-label="Rabbit distribution metric"
            value={metric}
            onChange={(event) => setMetric(event.target.value as Metric)}
          >
            {metrics.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="small-note">{info.description}</p>
      <p className="small-note">
        Each dot is one living rabbit in this frame. Click or focus a dot to inspect it. Columns
        group values into 10-point intervals; taller stacks mean more rabbits. All groups use the
        same scale.
      </p>
      <div className="distribution-groups">
        {cohorts.map(({ group, rabbits, bins, missing }) => (
          <article
            key={group.id}
            className="distribution-group"
            aria-label={`${group.label} distribution`}
          >
            <h3>
              <i className="lineage-dot" style={{ background: ARENA_GROUP_COLORS[group.color] }} />
              {group.label}
              <small>
                {rabbits.length} living · {rabbits.length - missing.length} plotted
              </small>
            </h3>
            <div className="dot-histogram" style={{ minHeight: Math.max(100, rows * 16 + 28) }}>
              {bins.map((bin, index) => (
                <div
                  className="dot-bin"
                  key={index}
                  title={`${index * 10}–${(index + 1) * 10}${index < 9 ? ' (upper bound excluded)' : ''}: ${bin.length} rabbits`}
                >
                  <span className="bin-count">{bin.length || ''}</span>
                  <div className="bin-dots">
                    {bin.map((rabbit) => dot(rabbit, ARENA_GROUP_COLORS[group.color]))}
                  </div>
                </div>
              ))}
            </div>
            <div className="distribution-axis">
              <span>0</span>
              <span>50</span>
              <span>100{metric === 'followRate' ? '%' : ''}</span>
            </div>
            {!rabbits.length && (
              <p className="small-note">No living rabbits in this group at this frame.</p>
            )}
            {missing.length > 0 && (
              <div className="distribution-missing">
                <span>No follow observations ({missing.length})</span>
                <div>{missing.map((rabbit) => dot(rabbit, ARENA_GROUP_COLORS[group.color]))}</div>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="distribution-inspect" aria-live="polite">
        {subject ? (
          <>
            <strong>
              Rabbit #{subject.id} · {groups.find((g) => g.id === subject.lineage)?.label} ·
              generation {subject.generation}
            </strong>
            <span>
              {info.label}: {value(subject, metric)?.toFixed(1) ?? 'No observations'}
              {metric === 'followRate' && value(subject, metric) !== null ? '%' : ''}
            </span>
            <span>
              Followed {subject.behavior?.followed ?? 0} / {subject.behavior?.offered ?? 0}{' '}
              opportunities · chose other {subject.behavior?.other ?? 0}
            </span>
            <span>
              Age {subject.age.toFixed(1)}s · energy {subject.energy.toFixed(1)} · current action:{' '}
              {subject.action}
            </span>
          </>
        ) : (
          <span>
            {selected !== null
              ? 'Selected animal is not a living rabbit in this frame. Select a dot to inspect another.'
              : 'Select a rabbit to see its exact value and follow opportunities.'}
          </span>
        )}
      </div>
      <p className="small-note">
        These distributions describe survivors at this time, not every rabbit ever born. Traits
        inherit and mutate; model weights are not trained here.
      </p>
    </section>
  );
}
