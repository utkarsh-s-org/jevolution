# Account access and saved runs

Supabase project: `azcbckmnanyksnapzwzc` (Jevolution, personal xrhuang10 account).

## Architecture

Supabase Auth owns users, email confirmation, password hashes and session revocation. The web API exchanges credentials with Supabase and stores the access/refresh session in an HttpOnly, SameSite cookie (Secure in production). Every key, model, and saved-run endpoint validates the user with Supabase. A five-minute account check refreshes expired sessions; provider requests never receive the refresh token. Browser session state is not authorization.

API keys are encrypted with AES-256-GCM. The account ID and provider are authenticated as associated data. `ACCOUNT_KEY_ENCRYPTION_SECRET` lives in Vercel, separately from the database. The browser receives only the provider and last-updated time, never saved key values. The earlier plaintext device-key entry is removed rather than automatically uploaded to an account.

Run metadata is stored in `public.jevolution_runs`. Replay chunks are compressed and stored in the private `jevolution-replays` bucket under `user_id/run_id/start.json.gz`. All access uses the caller's Supabase token, including server requests, so row-level security applies. No service-role key is needed by the app. The migration is in `supabase/migrations/202609280001_accounts_runs.sql`.

Started runs upload incrementally and on pause. IndexedDB retains owner-scoped pending uploads across refreshes; failures pause the simulation and show Retry save. A run should show “Saved to your account” before the page is closed. Frames after the most recent durable local/cloud write may be lost if the browser crashes. Local unsynced data can only be retried on the original device. Do not clear browser storage before retrying.

Previous runs shows date/time in the viewer's local timezone, duration, frame count, seed, configuration, model groups, populations and replay. Opening a run pauses the current habitat. Saved runs are read-only; the existing map, decision inspector, analytics and rewind controls display recorded states without model calls.

## Environment

Server-only variables (also `.env.accounts.local` for local development):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (accepts the publishable key despite the historical name)
- `ACCOUNT_KEY_ENCRYPTION_SECRET` (32 random bytes, base64 encoded)

Keep the encryption secret backed up securely. Rotating it without re-encrypting existing rows makes saved provider keys unreadable. Never commit it or place it in a VITE-prefixed variable.

Supabase Auth Site URL is `https://jevolution.world/`, email confirmation remains enabled, and custom Resend SMTP is configured for public sign-ups. Account creation is not complete until the user confirms their email. Site URL redirects are not required for password login once confirmed.

Sign-up and resend requests explicitly return to the originating app: `/arena.html` on localhost, `/` on deployments. Supabase's redirect allowlist must include the exact local URL (`http://127.0.0.1:5174/arena.html`) and any preview URL used to test sign-up. The server never accepts a redirect URL from the request body. Expired confirmation links open the login screen with a resend option. This fixes the initial setup's default `localhost:3000` redirect.

The branded confirmation template is `supabase/templates/confirm-signup.html`, subject “Confirm your Jevolution account”. Keep the `ConfirmationURL` variable so Supabase verifies the email before redirecting. The template is saved in Supabase, and sending from `Jevolution <no-reply@jevolution.world>` is active through Resend's free plan in the personal xrhuang10 Vercel account. The domain is verified. Supabase uses `smtp.resend.com:465`, username `resend`, and an encrypted SMTP credential; never commit that credential. The sender address is for outbound mail, not a provisioned mailbox.

On 2026-09-28, an end-to-end signup using Resend's official labeled delivery-test address verified: login rejected before confirmation, the real confirmation email marked Delivered with the correct sender/subject/template, and its link confirmed the account and opened the local simulation at `http://127.0.0.1:5174/arena.html`. The test account was signed out without running a simulation. This verifies the local account flow and the live email service, not deployment of the account branch to production. The Resend plan currently includes 3,000 emails/month with a 100/day limit; Supabase custom SMTP is capped at 30/hour with 60 seconds between emails to the same user.

## Sponsored access still pending funding configuration

The agreed policy is one shared sponsored budget and 120 cumulative seconds per account, with no sponsored time cap when explicitly using personal provider keys. Sponsored execution is not enabled in this branch. It still needs the total budget, funded provider credentials, transactional spend reservations and server-issued run leases. The public endpoint never falls back to project API keys. Adding those environment variables alone does not enable sponsored access.

Personal-key billing failures are distinguished from bare rate-limit errors. A provider-reported insufficient-credit/spend-limit error pauses the run and directs the user to their provider's billing page. The app does not claim to know the provider's live balance.

## Public sample replay

Guests can choose **Explore a sample** on the landing page without creating an account. Signed-in accounts without any saved provider keys enter sample mode automatically. A live run that receives a provider authentication or insufficient-credit error pauses, retains its own recording, and switches to the sample. Rate limits alone do not trigger the credit fallback. Saving an account key returns the user to their own paused habitat; it never resumes the sample as a real simulation. Provider balance cannot be checked generically in advance: exhausted keys are detected when a provider rejects a request.

The public **Sample simulation** banner stays visible across Habitat, Analytics, Field notes and Field guide. Play, pause, restart, rewind, zoom, follow, animal inspection and analytics operate on recorded snapshots. Start, reset, drought and map edits are rejected in the worker as well as disabled in the UI. Playback has no model adapter or live engine and creates no user-history records. Private saved runs remain accessible to their owner and separate from the sample. Hiding the tab pauses playback.

`GET /api/arena/sample` reads the active row from `public.jevolution_samples`. Chunk requests accept only that sample ID and valid frame boundaries. All write methods return 405. `202609280002_sample_runs.sql` enables read-only RLS on the catalog and creates a separate public `jevolution-samples` bucket with no visitor write policies. The private `jevolution-replays` bucket and its owner policies are unchanged. No service-role credential is deployed.

The initial published sample is recording `ed3cd918-a9e5-452b-bd28-856edf794bf6`, saved on September 25, 2026 (Pacific time): Jev and Claude rabbits, deterministic wolves, seed 271828, 164.7 seconds. It includes population history, animal traits, drought/food events and recorded game decisions. Earlier frames predate decision recording; native provider responses were not retained. The UI does not invent missing payloads. This historical recording does not represent a new experiment with the current code.

`node --import tsx scripts/prepare-sample.ts SOURCE_REPLAY_DIRECTORY OUTPUT_DIRECTORY` prepares a recording offline, checks it for common credential fields, retains every tenth frame plus the final frame, and validates each compressed chunk. The first sample contains 324 frames in 17 chunks (~23 MB total, fetched on demand, three chunks cached). Only playback sampling changes; retained world values and decision traces remain unchanged. Upload the reviewed `.json.gz` files under the recording UUID in the sample bucket, then register metadata from the generated manifest. Publish a different recording under a new UUID. Do not overwrite published chunks because browsers cache them. Run catalog changes in a transaction when switching the single active recording.

The sample is also the free fallback while sponsored execution remains unimplemented. It does not implement or claim a shared funded allowance or the proposed two-minute account cap.
