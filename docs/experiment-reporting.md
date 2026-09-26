# Local experiment reporting

This branch changes reporting and evidence handling, not ecological rules, prompts, decision cadence, or provider requests. The original real-time scheduler remains nondeterministic: even small instrumentation overhead can affect a fresh run's timing. Exact equality is a replay property, not a promise for new live executions.

Reporting uses the shared simulation runtime used by both the local server and hosted browser. Filesystem evidence, build/prompt provenance, process memory and full experiment bundles remain local-server features. The hosted UI keeps its browser snapshot export and does not offer the local bundle endpoint.

## UI and exports

Analytics includes population accounting (initial + births + arrivals − deaths), budget/horizon status, per-model reported-usage cost, invalid/cancelled counts, and queue delay explicitly labelled in world milliseconds. The live /api/arena/report endpoint adds non-overlapping log-write and replay-capture timing plus total tick timing (which includes both), peak tick time and process memory. Counters describe the current process/run, not historical recordings.

Export snapshot retains the existing lightweight JSON format. Full experiment bundle requires a paused run with drained requests and packages recorded initial state, current final snapshot, complete JSONL, every replay chunk, report, provenance when recorded, and SHA-256 checksums. Files are explicitly allowlisted; API keys and .env files are not included. Source observations and model responses remain in the bundle. Recorded data can be large. Export does not regenerate the simulation.

Builds write dist/arena-provenance.json with commit, dirty flag and source hashes. New live runs store that build fingerprint, actual prompts, rules, configuration hash and initial-state hash. Older runs are labelled as lacking recorded fingerprints; export never attributes the current code to an old recording. A code hash identifies a checkout but does not embed a complete source archive.

Price lookup is by explicit provider/model, independent of group name. Jev 1.13.0 and the existing Haiku 4.5 model ID have dated list-price sources. Unknown/custom/alias models display unknown instead of silently using another model's price. Interrupted calls can have unreported usage. Estimates are not invoices.

Rejection reason codes attach to the existing validation branches without changing accept/reject conditions. Historical reasons cannot be reconstructed from aggregate counts and remain unknown.

## Existing real recordings: offline batch reporting

```
npm run arena:report -- LOG_DIRECTORY OUTPUT_DIRECTORY RUN_ID... [--report-only]
```

The default creates a report and complete bundle per input run. --report-only omits archives. A failed item is retained in batch.json, subsequent items are still processed, and the command exits unsuccessfully if any item failed. This utility never calls a model.

## Read-only replay viewer

```
ARENA_LOG_DIRECTORY=/absolute/log/directory ARENA_REVIEW_RUN=RUN_ID ARENA_PORT=4322 npm run arena:review
```

Optionally set ARENA_REVIEW_BUNDLE to a previously generated archive. This server does not instantiate the live runtime, load API keys, or call providers. Every write endpoint is rejected. Replay uses recorded snapshots. Animal inspector history is limited to the trace window retained in the final snapshot; the full journal remains in the bundle.

## Headless batch runner

```
npm run arena:batch -- --manifest /absolute/jobs.json
```

Dry-run is the default. The JSON manifest contains initialFiles (1–20 paths to genuine recorded initial JSON files), output (a new directory), maxRequests (total cap, 1–20000), and maxWallSeconds (total execution guard, 1–7200). It reuses the recorded worlds/configurations. It accepts only unstarted initial worlds; this is not checkpoint resume. Validation enforces the existing configuration ranges.

Adding --execute starts real paid provider calls using .env.arena or existing process credentials. Obtain the applicable evaluation authorization before execution. No paid batch was run for this change. Explicit request/wall-clock caps, exclusive output-directory creation, provider failure stops, cancellation draining, per-run artifacts and batch results prevent accidental unbounded/repeated execution. Request caps are not dollar caps. Archive finalization/cancellation can finish after the wall-clock execution deadline. A crash can leave raw logs without a completed archive; partial evidence must not be treated as a completed run.

## Scope and interpretation

- No biological improvement is claimed. A report that distinguishes immigration from births changes interpretation, not animals.
- Repeat flushes of an unchanged replay chunk now avoid redundant compression and disk writes. Ordinary capture still uses the original exact delta format.
- Spatial indexing, routing replacement and asynchronous live log writing are deferred. They can affect ordering/timing and need a dedicated recorded-workload profile before implementation. This branch adds profiling rather than claiming unmeasured thousand-agent scalability.
- Fixed-step time, species biology, A2A and prompt changes are separate buckets.
