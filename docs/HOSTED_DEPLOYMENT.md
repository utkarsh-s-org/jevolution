# Hosted Jevolution

`npm run arena:deploy:build` validates and builds the working website for Vercel.
It uses the same `SimulationRuntime`, ecology rules, observations, provider adapters,
decision deadlines, and replay codec as the local `npm run arena` server.

The hosted simulation runs in a browser worker. `/api/arena/decision` performs each
real provider request in a Vercel Function. Model API keys stay in server-side
environment variables; they are never included in the client bundle. Provider
round-trip latency is measured on the server. The decision deadline also includes
the browser-to-server trip, so local and hosted latency results are not directly
interchangeable.

## Automatic production deployment

The `jevolution` project in `xrhuang10s-projects` is connected to
`utkarsh-s-org/jevolution`, with `main` as its production branch and
`jevolution.world` as its production domain. Merging a PR into `main` triggers
Vercel's native Git pipeline. Direct pushes to `main` also trigger it.

1. Install the locked dependencies with `npm ci`.
2. Run the simulation, replay, provider-adapter, and hosted API authentication tests.
   Provider transport tests use fixtures and incur no model API charges.
3. Type-check the API, server, shared engine, and UI; build the hosted UI and worker.
4. Reject missing server credentials, a missing hosted worker, or credentials in
   public assets. Vercel then compiles `api/arena/session.ts` and
   `api/arena/decision.ts` into server Functions.
5. Publish the complete deployment and move `jevolution.world` to it only after
   the build succeeds. A failed build leaves the previous deployment serving.

This deploys the browser simulation AND the server-side model gateway together;
`dist/arena` is only the static part of the deployment. Do not upload that folder
alone or change the Vercel root directory to `webview-ui`.

Automatic builds are limited to `main` by `git.deploymentEnabled` in `vercel.json`.
Feature branches can be tested with a manual `vercel deploy` preview. There is no
GitHub Actions workflow, GitHub deployment token, or second CI bill. Vercel Hobby
limits and model-provider usage still apply. API keys remain in Vercel.

The Git connection and production branch are project settings, not secrets in the
repository. When recreating this project, run `vercel link`, then
`vercel git connect https://github.com/utkarsh-s-org/jevolution.git`, and verify that
Production → Branch Tracking is `main` before enabling automatic deployments.

## Configure and deploy manually

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
