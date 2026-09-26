import { useState } from 'react';

import {
  balancePopulations,
  MODEL_PRESETS,
  POPULATION_BUDGET,
  PROVIDER_KEYS,
} from '../../../core/src/evolution/constants.js';
import type { ModelGroup, Provider, Species } from '../../../core/src/evolution/types.js';
import { ARENA_GROUP_COLORS, ARENA_GROUP_NAMES } from '../constants.js';

const PROVIDER_NAMES: Record<Provider, string> = {
  typesafe: 'TypeSafe',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};
export function ModelSettings({
  groups,
  onChange,
  ready,
}: {
  groups: ModelGroup[];
  onChange: (groups: ModelGroup[]) => void;
  ready?: Record<Provider, boolean>;
}) {
  const [expanded, setExpanded] = useState<Record<Species, boolean>>({
    rabbit: false,
    wolf: false,
  });
  const update = (index: number, changes: Partial<ModelGroup>) =>
    onChange(groups.map((g, i) => (i === index ? { ...g, ...changes } : g)));
  const speciesCount = (species: Species) =>
    groups.filter((g) => (g.species || 'rabbit') === species).length;
  const add = (species: Species) => {
    const color = ARENA_GROUP_COLORS.findIndex((_, n) => !groups.some((g) => g.color === n));
    const id = `group-${crypto.randomUUID().slice(0, 8)}`;
    onChange(
      balancePopulations(
        [
          ...groups,
          {
            ...MODEL_PRESETS[species === 'rabbit' ? 2 : 0],
            id,
            species,
            controller: species === 'wolf' ? 'deterministic' : 'model',
            ...(species === 'wolf'
              ? { label: 'Deterministic wolves', wolfLifeCycle: 'dynamic' as const }
              : {}),
            color,
            delayMs: 0,
          },
        ],
        undefined,
        undefined,
        species,
      ),
    );
    setExpanded((current) => ({ ...current, [species]: true }));
  };
  return (
    <section className="model-settings" aria-label="Animal groups">
      <h3>Animal groups</h3>
      <p className="small-note">
        Up to 6 groups. Starting budgets: {POPULATION_BUDGET.rabbit} rabbits and{' '}
        {POPULATION_BUDGET.wolf} wolves. Adding a group splits its species budget. Changes apply on
        reset.
      </p>
      {(['rabbit', 'wolf'] as const).map((sectionSpecies) => (
        <details className="species-settings" key={sectionSpecies} open={expanded[sectionSpecies]}>
          <summary
            aria-label={sectionSpecies === 'rabbit' ? 'Rabbits settings' : 'Wolves settings'}
            onClick={(event) => {
              event.preventDefault();
              setExpanded((current) => ({
                ...current,
                [sectionSpecies]: !current[sectionSpecies],
              }));
            }}
          >
            <span className="group-summary-name">
              {sectionSpecies === 'rabbit' ? 'Rabbits' : 'Wolves'}
            </span>
            <span className="group-summary-count">
              {speciesCount(sectionSpecies)} groups ·{' '}
              {groups
                .filter((g) => (g.species || 'rabbit') === sectionSpecies)
                .reduce((sum, g) => sum + (g.population || 0), 0)}{' '}
              animals
            </span>
            <span className="group-toggle" aria-hidden="true">
              {expanded[sectionSpecies] ? '−' : '+'}
            </span>
          </summary>
          <div className="species-settings-body">
            {groups.map((g, i) => {
              if ((g.species || 'rabbit') !== sectionSpecies) return null;
              const species = g.species || 'rabbit';
              const deterministic = g.controller === 'deterministic';
              const name = deterministic ? 'Deterministic' : g.label;
              const models = MODEL_PRESETS.filter((p) => p.provider === g.provider);
              return (
                <div
                  className="model-group-settings"
                  key={g.id}
                  role="group"
                  aria-label={`Group ${i + 1}`}
                >
                  <div className="model-group-heading">
                    <i
                      className="lineage-dot"
                      style={{ background: ARENA_GROUP_COLORS[g.color] }}
                    />
                    <span className="group-summary-name">
                      {name}
                      <small>
                        {species === 'wolf' ? 'Wolves' : 'Rabbits'} · Group {i + 1}
                      </small>
                    </span>
                    <span className="group-summary-count">
                      {g.population ?? balancePopulations(groups)[i].population}{' '}
                      {species === 'wolf' ? 'wolves' : 'rabbits'}
                    </span>
                  </div>
                  <div className="group-settings-body">
                    <div className="model-fields">
                      <label>
                        Species
                        <select
                          aria-label={`Group ${i + 1} species`}
                          value={species}
                          onChange={(e) => {
                            const next = e.target.value as Species;
                            setExpanded((current) => ({ ...current, [next]: true }));
                            const model =
                              MODEL_PRESETS.find(
                                (p) => p.provider === g.provider && p.model === g.model,
                              ) || MODEL_PRESETS[0];
                            onChange(
                              balancePopulations(
                                groups.map((group, n) =>
                                  n === i
                                    ? {
                                        ...group,
                                        ...model,
                                        species: next,
                                        wolfLifeCycle: next === 'wolf' ? 'dynamic' : undefined,
                                        controller: next === 'wolf' ? 'deterministic' : 'model',
                                        ...(next === 'wolf'
                                          ? { label: 'Deterministic wolves', delayMs: 0 }
                                          : {}),
                                      }
                                    : group,
                                ),
                              ),
                            );
                          }}
                        >
                          <option value="rabbit">Rabbit</option>
                          <option
                            value="wolf"
                            disabled={
                              (species === 'rabbit' && speciesCount('rabbit') === 1) ||
                              (species !== 'wolf' && speciesCount('wolf') >= POPULATION_BUDGET.wolf)
                            }
                          >
                            Wolf
                          </option>
                        </select>
                      </label>
                      <label>
                        Starting population
                        <input
                          type="number"
                          aria-label={`Group ${i + 1} starting population`}
                          min={1}
                          max={POPULATION_BUDGET[species] - speciesCount(species) + 1}
                          disabled={speciesCount(species) === 1}
                          value={g.population ?? balancePopulations(groups)[i].population}
                          onChange={(e) =>
                            onChange(balancePopulations(groups, g.id, Number(e.target.value)))
                          }
                        />
                      </label>
                      {species === 'wolf' && (
                        <label>
                          Births and deaths
                          <select
                            aria-label={`Group ${i + 1} births and deaths`}
                            value={g.wolfLifeCycle ?? 'dynamic'}
                            onChange={(e) =>
                              update(i, { wolfLifeCycle: e.target.value as 'dynamic' | 'fixed' })
                            }
                          >
                            <option value="dynamic">Enabled: mating, hunger, aging</option>
                            <option value="fixed">Disabled: immortal, no offspring</option>
                          </select>
                        </label>
                      )}
                      {species === 'wolf' && (
                        <label>
                          Controller
                          <select
                            aria-label={`Group ${i + 1} controller`}
                            value={g.controller || 'model'}
                            onChange={(e) => {
                              const controller = e.target.value as 'model' | 'deterministic';
                              const model =
                                MODEL_PRESETS.find(
                                  (p) => p.provider === g.provider && p.model === g.model,
                                ) || MODEL_PRESETS[0];
                              update(i, {
                                ...model,
                                controller,
                                ...(controller === 'deterministic'
                                  ? { label: 'Deterministic wolves', delayMs: 0 }
                                  : {}),
                              });
                            }}
                          >
                            <option value="deterministic">Deterministic</option>
                            <option value="model">AI model</option>
                          </select>
                        </label>
                      )}
                      {!deterministic && (
                        <>
                          <label>
                            Provider
                            <select
                              aria-label={`Group ${i + 1} provider`}
                              value={g.provider}
                              onChange={(e) => {
                                const model = MODEL_PRESETS.find(
                                  (p) => p.provider === e.target.value,
                                );
                                if (model) update(i, model);
                              }}
                            >
                              {Object.keys(PROVIDER_KEYS).map((p) => (
                                <option key={p} value={p}>
                                  {PROVIDER_NAMES[p as Provider]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Model
                            <select
                              aria-label={`Group ${i + 1} model`}
                              value={g.model}
                              onChange={(e) => {
                                const model = models.find((p) => p.model === e.target.value);
                                if (model) update(i, model);
                              }}
                            >
                              {!models.some((p) => p.model === g.model) && (
                                <option value={g.model}>{g.label} (current model)</option>
                              )}
                              {models.map((p) => (
                                <option key={p.model} value={p.model}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      <label>
                        Group color
                        <select
                          aria-label={`Group ${i + 1} color`}
                          value={g.color}
                          onChange={(e) => update(i, { color: Number(e.target.value) })}
                        >
                          {ARENA_GROUP_NAMES.map((name, n) => (
                            <option
                              key={name}
                              value={n}
                              disabled={groups.some((other, j) => j !== i && other.color === n)}
                            >
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!deterministic && (
                        <label>
                          Added delay (ms)
                          <input
                            type="number"
                            aria-label={`Group ${i + 1} delay`}
                            min={0}
                            max={5000}
                            value={g.delayMs}
                            onChange={(e) => update(i, { delayMs: Number(e.target.value) })}
                          />
                        </label>
                      )}
                    </div>
                    {species === 'wolf' && (
                      <p className="small-note">
                        {deterministic
                          ? 'Coded hunting and mating rules. No API key or model calls.'
                          : 'Local sight only. Chooses when to hunt, mate, patrol, or rest.'}{' '}
                        All wolves share speed, sight, and an 18-second eating cooldown.{' '}
                        {g.wolfLifeCycle === 'dynamic'
                          ? 'Births and deaths enabled: two well-fed mature wolves must choose each other as mates. Hunger and old age cause death. Applies to AI and deterministic wolves.'
                          : 'Births and deaths disabled: wolves are immortal and cannot reproduce. This is separate from AI vs deterministic decisions.'}
                      </p>
                    )}
                    <div className="model-row-end">
                      <small>
                        {deterministic
                          ? 'No API key needed'
                          : ready?.[g.provider]
                            ? 'Key configured'
                            : `Needs ${PROVIDER_KEYS[g.provider]}`}
                      </small>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={species === 'rabbit' && speciesCount('rabbit') === 1}
                        onClick={() =>
                          onChange(
                            balancePopulations(
                              groups.filter((_, j) => i !== j),
                              undefined,
                              undefined,
                              species,
                            ),
                          )
                        }
                      >
                        Remove group {i + 1}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="group-add-buttons">
              <button
                type="button"
                className="secondary-button"
                disabled={
                  groups.length >= 6 ||
                  (sectionSpecies === 'wolf' && speciesCount('wolf') >= POPULATION_BUDGET.wolf)
                }
                onClick={() => add(sectionSpecies)}
              >
                + Add {sectionSpecies} group
              </button>
            </div>
          </div>
        </details>
      ))}
      <p className="small-note">
        Model names are filled automatically. Keys stay on the server. Starting counts can be
        redistributed within each species budget.
      </p>
    </section>
  );
}
