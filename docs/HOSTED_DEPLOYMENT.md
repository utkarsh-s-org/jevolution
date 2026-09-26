# Hosted Jevolution

`node scripts/build-arena-public.mjs` builds the working website for Vercel.
It uses the same `SimulationRuntime`, ecology rules, observations, provider adapters,
decision deadlines, and replay codec as the local `npm run arena` server.

The hosted simulation runs in a browser worker. `/api/arena/decision` performs each
real provider request in a Vercel Function. Model API keys stay in server-side
environment variables; they are never included in the client bundle. Provider
round-trip latency is measured on the server. The decision deadline also includes
the browser-to-server trip, so local and hosted latency results are not directly
interchangeable.

## Configure and deploy

- Link the checkout to the existing personal Vercel project.
- Set `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` (or other configured provider keys),
  and `ARENA_ACCESS_CODE` as encrypted Vercel environment variables.
- Use a randomly generated access code of at least 24 characters. Share it only
  with people authorized to spend the configured model API credits.
- Optional `JEV_MODEL` and `CLAUDE_MODEL` values select the initial models.
- Run `vercel deploy` to verify a preview, then `vercel deploy --prod`.
- Open the website, press Start, and unlock it with the run access code.
  The access cookie is signed, HTTP-only, Secure, SameSite=Strict, and expires
  after 12 hours. Rotating the code invalidates old cookies.

An unauthenticated visitor can inspect and edit their local habitat, but cannot
make paid model requests. There is no anonymous model proxy. No provider key is
returned by the session/status endpoint.

## Run behavior and storage

Each browser tab has its own ecosystem. Hiding the tab pauses the simulation and
cancels pending calls. Closing or reloading the tab ends that live session; it is
not a shared, permanently running server world. Export before leaving the page.
Replay chunks and full decision events are recorded in that browser's IndexedDB;
the timeline reads exact recorded states, not rerun model responses. Reloaded runs
do not currently have a recovery UI. Storage failure stops the run.

The controls still enforce per-run request and duration limits. Already dispatched
provider requests may incur usage even if cancelled. Hosting on Vercel Hobby does
not make the model providers free.

## Verification

`npm run arena:check` covers the shared simulation and provider adapters.
`node --import tsx --test server/src/evolution/hosted.test.ts` verifies the hosted
authentication boundary and adapter response transport using labeled fixtures.
Browser verification must also cover a bounded real-provider run, pause/rewind,
map editing, and export before considering a deployment working.
