import type { Snapshot } from '../../../core/src/evolution/types.js';

export function CoordinationPanel({
  snapshot,
  onSelect,
}: {
  snapshot: Snapshot | null;
  onSelect: (id: number) => void;
}) {
  const data = snapshot?.coordination;
  if (!data) return null;
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const escape = data.skill === 'escape';
  return (
    <section className="side-panel coordination-panel" aria-label="Agent cooperation">
      <div className="eyebrow">
        {data.mode === 'a2a' ? 'A2A · INDEPENDENT SERVICES' : 'LOCAL · SAME TASK RULES'}
      </div>
      <h2>{escape ? 'A warning. A decision. A move to cover.' : 'Requests become commitments.'}</h2>
      <p className="small-note">
        {escape
          ? 'A nearby rabbit reports a wolf sighting and suggests visible cover. The recipient chooses its response. Completion verifies arrival, not a survival advantage.'
          : 'Rabbits choose whether to help across model groups. A task succeeds only when food actually arrives.'}{' '}
        This history follows the replay time.
      </p>
      <div className="relief-totals">
        <div>
          <strong>{total}</strong>
          <span>{escape ? 'warnings' : 'requests'}</span>
        </div>
        <div>
          <strong>{data.counts.completed}</strong>
          <span>{escape ? 'verified cover arrivals' : 'verified deliveries'}</span>
        </div>
        <div>
          <strong>{escape ? data.counts.working : data.foodDelivered.toFixed(1)}</strong>
          <span>{escape ? 'moving toward cover' : 'food transferred'}</span>
        </div>
      </div>
      {data.error && <p role="alert">{data.error}</p>}
      {data.endpoints.length > 0 && (
        <details>
          <summary>Connected agent services</summary>
          {data.endpoints.map((endpoint) => (
            <p key={endpoint.url}>
              {endpoint.label} · <code>{endpoint.url}</code>
            </p>
          ))}
          <p className="small-note">
            Agent Cards and task endpoints use scoped local credentials. Model API keys stay on the
            server.
          </p>
        </details>
      )}
      <p className="small-note">
        Waiting {data.counts.sending + data.counts.submitted} · {escape ? 'Moving' : 'Delivering'}{' '}
        {data.counts.working} · Declined {data.counts.rejected} · Failed {data.counts.failed} ·
        Canceled {data.counts.canceled}
      </p>
      {!total && (
        <p className="small-note">
          {escape
            ? 'No warnings yet. A rabbit must see a wolf, a nearby recipient and suitable cover before its model can choose to warn.'
            : 'No requests yet. A hungry rabbit can ask a nearby food carrier; models can also forage or share without a task.'}
        </p>
      )}
      <div className="coordination-list">
        {[...data.tasks]
          .reverse()
          .slice(0, 30)
          .map((task) => (
            <details key={task.id} className={`coordination-task task-${task.state}`}>
              <summary>
                #{task.requester} → #{task.helper} <b>{task.state}</b>
                {task.receipt
                  ? task.kind === 'escape'
                    ? ` · reached ${task.receipt.terrain}`
                    : ` · ${task.receipt.amount.toFixed(1)} food`
                  : ''}
              </summary>
              <div className="coordination-actions">
                <button onClick={() => onSelect(task.requester)}>
                  {task.kind === 'escape' ? 'Inspect sender' : 'Inspect requester'}
                </button>
                <button onClick={() => onSelect(task.helper)}>
                  {task.kind === 'escape' ? 'Inspect recipient' : 'Inspect helper'}
                </button>
              </div>
              <p>{task.reason}</p>
              {task.requesterService !== undefined && (
                <p className="small-note">
                  Agent service {task.requesterService} → agent service {task.helperService}
                </p>
              )}
              <p className="small-note">
                {task.requesterGroup} → {task.helperGroup} · requested at{' '}
                {task.createdAt.toFixed(2)}s
                {task.transportMs === undefined
                  ? ''
                  : ` · A2A arrival ${task.transportMs.toFixed(1)} ms`}
              </p>
              {task.kind === 'escape' && (
                <p className="small-note">
                  Wolf last seen at ({task.escape.threat.x.toFixed(1)},{' '}
                  {task.escape.threat.y.toFixed(1)}) at {task.escape.observedAt.toFixed(2)}s.
                  Suggested cover: ({task.escape.refuge.x}, {task.escape.refuge.y}).
                </p>
              )}
              <ol>
                {task.history.map((event, index) => (
                  <li key={index}>
                    {event.time.toFixed(2)}s · {event.state}: {event.reason}
                  </li>
                ))}
              </ol>
              {task.receipt &&
                (task.kind === 'escape' ? (
                  <p>
                    Engine event #{task.receipt.eventId}: reached {task.receipt.terrain} at{' '}
                    {task.receipt.time.toFixed(2)}s, {task.receipt.displacement.toFixed(1)} tiles
                    from the acceptance position. Arrival does not guarantee safety.
                  </p>
                ) : (
                  <p>
                    Engine event #{task.receipt.eventId}: energy{' '}
                    {task.receipt.energyBefore.toFixed(1)} → {task.receipt.energyAfter.toFixed(1)}{' '}
                    at {task.receipt.time.toFixed(2)}s.
                  </p>
                ))}
              <dl>
                <dt>Request</dt>
                <dd>{task.id}</dd>
                <dt>A2A task</dt>
                <dd>{task.protocolTaskId || 'Local transport'}</dd>
                <dt>Request decision</dt>
                <dd>{task.decisionId}</dd>
                {task.acceptedDecisionId && (
                  <>
                    <dt>Acceptance decision</dt>
                    <dd>{task.acceptedDecisionId}</dd>
                  </>
                )}
              </dl>
            </details>
          ))}
      </div>
    </section>
  );
}
