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
