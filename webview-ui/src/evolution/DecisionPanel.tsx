import { useEffect, useRef, useState } from 'react';

import type { DecisionTrace, Snapshot } from '../../../core/src/evolution/types.js';
import { OrganismInspector } from './OrganismInspector.js';
import { useDecisionFeed } from './useDecisionFeed.js';

const labels: Record<DecisionTrace['state'], string> = {
  requesting: 'Waiting for response',
  returned: 'Response received · timing hold',
  applied: 'Applied',
  late: 'Too late · not applied',
  invalid: 'Rejected · action no longer available',
  cancelled: 'Cancelled',
  error: 'Request failed',
};
const milliseconds = (n: number) => `${Math.round(n).toLocaleString()} ms`;
export function DecisionPanel({
  snapshot,
  selected,
  reviewing,
  following,
  onFollow,
  onClose,
}: {
  snapshot: Snapshot | null;
  selected: number;
  reviewing: boolean;
  following: boolean;
  onFollow: () => void;
  onClose: () => void;
}) {
  const [responseView, setResponseView] = useState<'native' | 'action'>('native');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = panel.current;
    const sidebar = element?.closest<HTMLElement>('.habitat-sidebar');
    const rail = element?.closest<HTMLElement>('.habitat-details');
    if (!element || !sidebar || !rail) return;
    if (getComputedStyle(sidebar).display !== 'contents') {
      const toolbarHeight =
        sidebar.querySelector('.panel-toolbar')?.getBoundingClientRect().height || 0;
      sidebar.scrollTop +=
        element.getBoundingClientRect().top -
        sidebar.getBoundingClientRect().top -
        toolbarHeight -
        12;
    } else if (getComputedStyle(rail).display !== 'contents') rail.scrollTop = 0;
    else element.scrollIntoView({ block: 'nearest' });
  }, []);
  const { traces, connected } = useDecisionFeed(snapshot, selected, reviewing);
  const latest = traces[0];
  const response = traces.find((trace) => trace.decision || trace.nativeResponse);
  const animal = [...(snapshot?.world.rabbits || []), ...(snapshot?.world.wolves || [])].find(
    (r) => r.id === selected,
  );
  const group = snapshot?.world.groups.find((g) => g.id === (animal?.lineage || latest?.lineage));
  const species = animal
    ? 'genes' in animal
      ? 'Rabbit'
      : 'Wolf'
    : latest?.species === 'wolf'
      ? 'Wolf'
      : 'Rabbit';
  const waiting = latest?.state === 'requesting' && !reviewing && !!snapshot?.status.running;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(timer);
  }, [waiting, latest?.id]);
  return (
    <section ref={panel} className="side-panel decision-panel" aria-label="Live decisions">
      <div className="decision-heading">
        <div>
          <div className="eyebrow">{reviewing ? 'RECORDED DECISION' : 'LIVE DECISIONS'}</div>
          <h2>
            {species} #{selected}
          </h2>
        </div>
        <button aria-label="Close decision panel" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="decision-identity">
        <p className="decision-model" title={latest?.model || group?.model}>
          {group?.label || latest?.label}
        </p>
        <button
          className="secondary-button follow-camera"
          aria-label={
            following && animal ? 'Following · stop camera' : `Follow ${species.toLowerCase()}`
          }
          disabled={!animal}
          aria-pressed={following && !!animal}
          onClick={onFollow}
        >
          {following && animal ? 'Following' : 'Follow'}
        </button>
      </div>
      {!animal && (
        <p className="small-note">
          This animal is no longer alive. Its last decisions remain below.
        </p>
      )}
      {group?.controller === 'deterministic' ? (
        <p className="small-note">Deterministic rules · no model call or JSON response.</p>
      ) : (
        <>
          <div className={`decision-state ${latest?.state || 'empty'}`} role="status">
            <span>
              {latest
                ? latest.state === 'error' && latest.nativeResponse
                  ? 'Rejected · invalid provider decision'
                  : labels[latest.state]
                : 'No recorded response yet'}
            </span>
            {!waiting && response && (
              <strong title="Measured API round trip">
                {response.latencyMs === undefined ? 'N/A' : milliseconds(response.latencyMs)}
              </strong>
            )}
            {waiting && (
              <strong aria-label="Request elapsed time">
                {milliseconds(Math.max(0, now - latest.startedAt))}
              </strong>
            )}
          </div>
          {latest?.message && <p className="decision-error">{latest.message}</p>}
          {response ? (
            <>
              <div className="response-tabs" role="group" aria-label="Response view">
                <button
                  disabled={!response.nativeResponse}
                  aria-pressed={responseView === 'native' && !!response.nativeResponse}
                  title={
                    response.nativeResponse?.format ||
                    'Native payload not recorded for this older decision'
                  }
                  onClick={() => setResponseView('native')}
                >
                  Native
                </button>
                <button
                  aria-pressed={responseView === 'action' || !response.nativeResponse}
                  title="Normalized game action"
                  onClick={() => setResponseView('action')}
                >
                  Game action
                </button>
                <span
                  title={
                    response !== latest
                      ? 'Previous response; status above is for the newest request'
                      : 'Response world time'
                  }
                >
                  {response !== latest ? 'Previous · ' : ''}
                  {response.simulationTime.toFixed(1)}s
                </span>
              </div>
              {responseView === 'native' && response.nativeResponse ? (
                <>
                  <pre className="decision-json" aria-label="Provider-native response">
                    <code>{response.nativeResponse.json}</code>
                  </pre>
                  {response.nativeResponse.truncated && (
                    <span className="small-note">Truncated at 12,000 characters</span>
                  )}
                </>
              ) : response.decision ? (
                <pre className="decision-json" aria-label="Decision JSON">
                  <code>{JSON.stringify(response.decision, null, 2)}</code>
                </pre>
              ) : (
                <p className="small-note">Rejected · no valid game action</p>
              )}
              {response.action && (
                <details className="decision-action-details">
                  <summary title="Written by the game, not generated by the model">
                    Engine description
                  </summary>
                  <p className="decision-action">{response.action}</p>
                </details>
              )}
              {(response.delayMs > 0 || response.timing === 'equalized') && (
                <p className="small-note">
                  {response.delayMs > 0 && `${response.delayMs} ms added delay. `}
                  {response.timing === 'equalized' &&
                    `${response.deadlineMs} ms equal timing window. `}
                  API round trip excludes these holds.
                </p>
              )}
            </>
          ) : (
            <p className="small-note">
              {reviewing
                ? 'No response JSON was recorded by this frame.'
                : 'The next returned decision will appear here.'}
            </p>
          )}
          {!reviewing && !connected && <p className="small-note">Connecting to live decisions…</p>}
          {traces.filter((trace) => (trace.decision || trace.nativeResponse) && trace !== response)
            .length > 0 && (
            <details className="decision-history">
              <summary>Recent decisions</summary>
              {traces
                .filter((trace) => (trace.decision || trace.nativeResponse) && trace !== response)
                .map((trace) => (
                  <div key={trace.id}>
                    <p>
                      {trace.simulationTime.toFixed(2)}s · {milliseconds(trace.latencyMs!)} ·{' '}
                      {labels[trace.state]}
                    </p>
                    <div className="decision-json-label">Provider-native response</div>
                    {trace.nativeResponse ? (
                      <pre className="decision-json">
                        <code>{trace.nativeResponse.json}</code>
                      </pre>
                    ) : (
                      <p className="small-note">Native payload not recorded.</p>
                    )}
                    <div className="decision-json-label">Normalized game action</div>
                    <pre className="decision-json">
                      <code>
                        {trace.decision
                          ? JSON.stringify(trace.decision, null, 2)
                          : 'Rejected · no valid action'}
                      </code>
                    </pre>
                    <p className="small-note">
                      Engine description · {trace.action || 'Unavailable'}
                    </p>
                  </div>
                ))}
            </details>
          )}
        </>
      )}
      {animal && (
        <section className="decision-vitals" aria-label="Traits and vitals">
          <h3>Traits & vitals</h3>
          <OrganismInspector snapshot={snapshot} selected={selected} onSelect={onClose} compact />
        </section>
      )}
    </section>
  );
}
