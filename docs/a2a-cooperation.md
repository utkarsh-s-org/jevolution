# A2A food cooperation

This optional model-arena mode implements one application skill, `jevolution.food-delivery.v1`, over A2A 1.0 JSON-RPC and SSE with the pinned official `@a2a-js/sdk@1.2.1`.

## Try it

1. Configure the existing provider keys in `.env.arena`. No additional Google key is required.
2. Run `npm run arena:build`, then `npm run arena`.
3. Pause, open settings, select **Model arena**, and choose a cooperation mode. Set request, duration and optional API spending limits. Reset to apply settings.
4. Start the ecosystem. The **Cooperation** tab shows model-selected tasks, service identities, lifecycle history, decision IDs, and food-transfer receipts. Inspect an actor to see its real decisions in Habitat. Pause and scrub the timeline to see historical task states.

The three modes have different purposes:

| Mode                         | Behavior                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Original signals             | Existing prompt, ordinary signals and voluntary food sharing; default behavior.                                                           |
| Food tasks · local transport | Community-survival goal, bounded request inboxes and delivery commitments inside the arena process.                                       |
| Food tasks · A2A services    | Same task goal and legal choices, with model calls in two child processes and cooperation transported through authenticated A2A services. |

The task modes also clarify existing foraging and resting mechanics in the prompt. Comparing them with Original signals tests this whole behavior change. Comparing local with A2A isolates the transport architecture more closely, but live model outputs and scheduling still vary.

Food sharing is disabled in the predator–prey preset, so this first skill is intentionally available only in Model arena. The preset remains available with its existing behavior.

## What actually happens

A hungry rabbit can choose to request food from up to two eligible visible carriers offered in its legal choices. Each request addresses one carrier. Both animals must be within sight and the sociability-dependent communication range. Requesting costs existing signal energy. There is one active request per requester and one task per helper, a six-second request cooldown, a 0.2-second simulation delivery delay, and a twenty-second simulation deadline.

The request travels from the requester's assigned service to the helper's service using Agent Card discovery and `SendMessage` streaming. An incoming task is not acceptance. At the helper's ordinary scheduled decision, the model can choose a task-linked share action, decline, or do something else. The runtime does not create a second inference loop or force cooperation.

Movement and food transfer use the existing engine. Completion requires an actual share event after acceptance, with matching donor and recipient and positive transferred food. The service publishes that receipt as an A2A artifact, and the task is available through `GetTask`. Failure, expiration and cancellation remain distinct outcomes. Pause cancels active tasks; failed or canceled deliveries stop their task-linked share movement. Reset disposes the services.

## Architecture and limits

The hosted browser and local server continue to use the shared `SimulationRuntime`. Optional coordination and budget ports attach the Node adapters only in `ArenaRuntime`. The hosted UI hides these local-only controls, and the shared runtime rejects unsupported task/budget configurations instead of silently ignoring them. Hosted A2A requires a separately deployed service and is not part of this local integration.

- The arena is authoritative for biology, visibility, local observations, legal actions and physical receipts. Workers receive local observations, not an omniscient world snapshot.
- Two separate processes host logical animals. A stable ID hash spreads each model group over both processes; service identity is independent of provider identity. Some requests cross processes and some target another actor on the same process. The UI records which occurred.
- Runtime-to-worker decisions use private IPC. Inter-agent tasks use real HTTP/SSE through the official SDK. Endpoint authentication uses an ephemeral server-side bearer token; both listeners bind to loopback. Keys and service tokens are never sent to the browser.
- Only the configured local peers are permitted. This is not yet a remote-agent marketplace: no arbitrary endpoint entry, external framework adapter, HTTPS deployment, hot joining, or cross-language compatibility claim.
- Requests and stored task histories are bounded to 2,000 per run; snapshots expose the latest 100, and the UI lists the latest 30. Task stores are in memory. The run log and replay retain observer evidence, not a durable recovery queue.
- Duplicate application request IDs are rejected without creating another model-visible request. There is no automatic network retry or exactly-once delivery guarantee.
- Provider failures retain existing handling. Peer transport failure pauses the run; it does not silently switch to local transport. The underlying action may still be refused as stale if circumstances change before the API response arrives.
- Cancellation prevents future task execution; it cannot undo food already physically delivered.

The optional spending limit uses the repository's known prices for the exact default Jev and Claude models. It reserves a conservative amount before dispatch, retains reservations for interrupted calls, and pauses before a further reservation would exceed the limit. Unsupported model prices are rejected when a dollar limit is set. This remains an estimate, not provider billing reconciliation.

## Verification

```bash
npm run arena:build
npm run arena:check
npm run arena:a2a:check
```

The A2A check starts two actual local SDK servers and replays two recorded application requests from run `e8712d68-fa1a-467f-b5bf-782d3bddf933`. The checked-in fixture includes source provenance, an artifact hash, actual decision IDs and an actual engine receipt. It verifies discovery authentication, cross-process transport, submitted/working/completed states, receipt artifacts, `GetTask`, duplicate suppression, `CancelTask`, and terminal-state preservation. It makes **no model calls** and is a protocol regression check, not a new model-quality result.

The implementation was also exercised with live Jev and Claude decisions from a previously recorded drought state. Two requests completed in the final twenty-second continuation, including one across processes. That is evidence that the path works; it is not evidence of improved ecological accuracy, reliable population growth, large-scale throughput, or guaranteed cooperation.

Official references: [A2A specification](https://a2a-protocol.org/latest/specification/), [JavaScript SDK](https://github.com/a2aproject/a2a-js).
