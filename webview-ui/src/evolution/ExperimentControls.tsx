import {
  defaultExperimentPreview,
  EXPERIMENT_GROUPS,
  type ExperimentPreview,
} from '../../../core/src/evolution/experimentPreview.js';

export function ExperimentControls({
  value,
  onChange,
  disabled,
}: {
  value?: ExperimentPreview;
  onChange: (value: ExperimentPreview) => void;
  disabled: boolean;
}) {
  const draft = value ?? defaultExperimentPreview();
  function group(index: number) {
    const section = EXPERIMENT_GROUPS[index];
    return (
      <section className="experiment-group" key={section.name} aria-label={section.name}>
        <h4>
          {section.name}
          <span className="preview-badge">Applies on reset</span>
        </h4>
        <div className="experiment-sliders">
          {section.controls.map((c) => (
            <div className="experiment-slider" key={c.key}>
              <div className="experiment-slider-label">
                <label htmlFor={`experiment-${c.key}`}>{c.label}</label>
                <output htmlFor={`experiment-${c.key}`}>
                  {draft.values[c.key]} {c.unit}
                </output>
              </div>
              <input
                id={`experiment-${c.key}`}
                type="range"
                min={c.min}
                max={c.max}
                step={c.step}
                value={draft.values[c.key]}
                disabled={disabled}
                aria-valuetext={`${draft.values[c.key]} ${c.unit}. Applies on reset.`}
                aria-describedby={`experiment-help-${c.key}`}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    mode: 'active',
                    appliedToSimulation: true,
                    values: { ...draft.values, [c.key]: Number(e.target.value) },
                  })
                }
              />
              <p id={`experiment-help-${c.key}`}>{c.help}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <details className="experiment-controls">
      <summary>
        <span>Experiment controls</span>
        <span className="preview-badge">Applies on reset</span>
      </summary>
      <div className="experiment-body">
        <p className="experiment-notice">
          Settings take effect when you reset the habitat. Effective values are included in exported
          runs. Temperature uses illustrative rules, not a calibrated biological model.
        </p>
        {group(0)}
        {group(1)}
        {group(2)}
        <details className="experiment-advanced">
          <summary>
            Advanced <span>Predators & inheritance</span>
          </summary>
          {group(3)}
          {group(4)}
        </details>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => onChange(defaultExperimentPreview())}
        >
          Reset experiment values
        </button>
      </div>
    </details>
  );
}
