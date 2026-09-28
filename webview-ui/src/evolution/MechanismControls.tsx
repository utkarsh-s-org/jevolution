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
  return (
    <fieldset className="experiment-controls" disabled={disabled}>
      <legend>Active mechanism experiments</legend>
      <p>
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
  );
}
