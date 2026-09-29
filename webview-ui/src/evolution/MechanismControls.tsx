import { BASELINE_EXPERIMENTS, type Experiments } from '../../../core/src/evolution/experiments.js';
export function MechanismControls({
  value,
  onChange,
  disabled,
}: {
  value?: Experiments;
  onChange: (value: Experiments) => void;
  disabled: boolean;
}) {
  const settings = value ?? BASELINE_EXPERIMENTS;
  const active =
    (['researchClock', 'demographics', 'resources', 'decisions'] as const).filter(
      (key) => settings[key],
    ).length + (settings.communication ? 0 : 1);
  return (
    <details className="experiment-controls mechanism-controls">
      <summary>
        <span>Active mechanism experiments</span>
        {active > 0 && <span className="preview-badge">{active} on</span>}
      </summary>
      <fieldset className="experiment-body mechanism-fields" disabled={disabled}>
        <p className="experiment-notice">
          Applied when you reset the habitat. All off preserves the original mechanics. Simulation
          times are illustrative, not calibrated wildlife predictions.
        </p>
        <label>
          <input
            type="checkbox"
            checked={settings.demographics}
            onChange={(e) => onChange({ ...settings, demographics: e.target.checked })}
          />{' '}
          #2 Demographics: paired reproduction, gestation, juvenile care and finite lifespans
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.resources}
            onChange={(e) => onChange({ ...settings, resources: e.target.checked })}
          />{' '}
          #3 Hunting and habitat: finite carcasses, attack recovery, movement cost, limited shelter
          and water
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.decisions}
            onChange={(e) => onChange({ ...settings, decisions: e.target.checked })}
          />{' '}
          #4 Decisions: local perception, persistent actions and communication
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.communication}
            onChange={(e) => onChange({ ...settings, communication: e.target.checked })}
          />{' '}
          Allow local signals
        </label>
        <label>
          Objective with decision experiment{' '}
          <select
            value={settings.goal}
            onChange={(e) => onChange({ ...settings, goal: e.target.value as Experiments['goal'] })}
          >
            <option value="lineage">Sustain the local lineage</option>
            <option value="individual">Individual survival and descendants</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.researchClock}
            onChange={(e) => onChange({ ...settings, researchClock: e.target.checked })}
          />{' '}
          #1 Research clock: world pauses for decisions; fixed 50ms physics and 2s decision rounds
        </label>
        {settings.researchClock && (
          <p>
            Research mode uses one global concurrency limit, freezes observations for each round,
            and applies returned decisions in a stable order. Simulation speed and equalized
            response slots do not change biology in this mode. A provider failure pauses the whole
            experiment.
          </p>
        )}
        <label>
          Immigration with demographics enabled{' '}
          <select
            value={settings.immigration}
            onChange={(e) =>
              onChange({ ...settings, immigration: e.target.value as Experiments['immigration'] })
            }
          >
            <option value="closed">Closed population</option>
            <option value="boundary">
              Boundary arrivals, finite source (20 rabbits / 10 wolves)
            </option>
          </select>
        </label>
      </fieldset>
    </details>
  );
}
