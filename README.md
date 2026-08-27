# Carnival Life

Carnival Life is a suite of applications designed to help people manage what they have to do while protecting and creating more of what they want to do.

## Applications

- **PlayHouse** (`apps/playhouse`) — the user-facing application for managing Plays.
- **Roller** (`apps/roller`) — the separate scheduling and planning engine. Its implementation is deferred to a later phase.

Additional Carnival applications will be added to this monorepo over time.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer

Phase 1 database work is now version-controlled under [`supabase/`](supabase/). A local database requires a Docker-compatible container runtime; see [`supabase/README.md`](supabase/README.md).

## Installation

From the repository root:

```bash
npm install
```

## Local development

Start PlayHouse from the repository root:

```bash
npm run dev
```

Then open [http://localhost:3002](http://localhost:3002). Port 3002 is the required local PlayHouse origin and is configured by the app's `dev` script.

The same application can be run from its Vercel root directory:

```bash
cd apps/playhouse
npm run dev
```

## Quality checks

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Run all four checks in sequence with:

```bash
npm run check
```

## PlayHouse browser regression tests

The Playwright suite runs the real PlayHouse app at
[http://localhost:3002](http://localhost:3002) against the repository's local
Supabase stack. It refuses non-local Supabase URLs, so the suite cannot mutate
the hosted production project.

One-time setup:

1. Install a Docker-compatible container runtime and start it.
2. Install repository dependencies with `npm install`.
3. Install Playwright's Chromium browser:

   ```bash
   npx playwright install chromium
   ```

Start the isolated local database and run the full suite from the repository root:

```bash
npm run db:start
npm run test:e2e
```

Run `npm run db:reset` after migration changes when a clean local schema is
needed. CI always performs this reset against its disposable local stack.

Stop any separately running PlayHouse development server first. Playwright
always starts its own port-3002 process with the guarded local Supabase
environment and will not reuse an existing server that might point elsewhere.

The Playwright configuration reads the local URL and keys from
`supabase status -o env`, starts PlayHouse on port 3002, creates a unique
confirmed email/password Auth user for each authenticated test, obtains a normal
Supabase session, seeds an owned Google-account metadata row through RLS, and
uses a server-only deterministic People-search adapter instead of real Google
OAuth. The selected deterministic contact is cached through the same product
boundary as production, and the disposable user is deleted after the test.
Product mutations still
run through the browser, authenticated Server Actions, and RLS. The local
service-role key is confined to the Playwright process for disposable-user
provisioning, cleanup, and non-destructive persistence assertions; it is never
provided to the PlayHouse app.

No E2E environment variables are normally required when `npm run db:start` is
used. A custom local Supabase instance can be selected explicitly with all three
of these test-process variables:

```dotenv
PLAYHOUSE_E2E_SUPABASE_URL=http://127.0.0.1:54321
PLAYHOUSE_E2E_SUPABASE_ANON_KEY=local-anon-key
PLAYHOUSE_E2E_SUPABASE_SERVICE_ROLE_KEY=local-service-role-key
```

Non-local URLs are rejected even when supplied explicitly. Never place these
test values in `apps/playhouse/.env.local` or Vercel.

Run one test by title:

```bash
npm run test:e2e --workspace=@carnival/playhouse -- --grep "new Play defaults"
```

Open Playwright's interactive runner:

```bash
npm run test:e2e:ui
```

Failure traces, screenshots, and videos are written under ignored
`test-results/` and `playwright-report/` folders. GitHub Actions installs
Chromium, starts a fresh local Supabase stack, then runs lint, type checking,
unit tests, the complete browser suite, and the production build without using
repository secrets or a personal Google account.

Database commands are available from the repository root after installing dependencies:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:stop
```

## Environment variables

Copy the placeholder file for local hosted-Supabase development:

```bash
cd apps/playhouse
cp .env.example .env.local
```

On PowerShell, use `Copy-Item .env.example .env.local`. Populate the public browser-safe values from the Supabase project Connect dialog:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
```

The Google connected-account credential broker also requires these server-only
values in `.env.local` and in Vercel. Never prefix them with `NEXT_PUBLIC_`, put
them in browser code, or commit their real values:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

PlayHouse temporarily uses the legacy Mongo database as its authoritative Play
store while Supabase continues to provide authentication, profiles, Google
accounts, credentials, and contact references. Configure the server-only Mongo
connection locally and in Vercel:

```dotenv
PLAYHOUSE_DATA_SOURCE=mongo
LEGACY_MONGO_URI=mongodb+srv://server-only-placeholder
```

`PLAYHOUSE_DATA_SOURCE` accepts only `mongo` or `supabase` and defaults to
`mongo` when omitted. Set it to `supabase` only for the final cutover or an
isolated Supabase-backed test environment. Never prefix `LEGACY_MONGO_URI` with
`NEXT_PUBLIC_` or expose it to browser code.

`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` must identify the same
Google web OAuth client configured in Supabase Auth. Generate the encryption key
once per environment with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
and retain it in the environment's secret store; changing it makes existing
stored refresh tokens unreadable and requires users to reconnect.

For Google sign-in, Supabase Auth URL Configuration must allow both application callback origins:

- `https://carnival-playhouse.vercel.app/**`
- `http://localhost:3002/**`

The application callback routes are `https://carnival-playhouse.vercel.app/auth/callback` and `http://localhost:3002/auth/callback`. Google Cloud's authorized redirect URI remains the hosted Supabase Auth callback shown on the Supabase Google provider page—not the PlayHouse callback route.

Player uses a live, debounced Google People search; signing in does not import
the user's address book. Enable the Google People API and add the non-sensitive
`https://www.googleapis.com/auth/contacts.readonly` scope to the Google Auth
Platform consent configuration. Existing users must sign out and sign in once
to grant the scope and establish an offline credential. Player lookup calls
Google People `people.searchContacts` from server code after two typed
characters. Selecting a result verifies that resource through Google and caches
only its stable resource name, display name, and available email. Google sign-in
requests offline consent. The returned refresh token is AES-256-GCM encrypted by
server-only code and stored in the non-API-exposed `private` schema; only
service-role RPCs can read or update the ciphertext. If Google does not return a
new refresh token, the existing encrypted credential is left intact.

## Vercel deployment

Create or connect the `carnival-playhouse` Vercel project to `carnivaltheapp/carnival-life` and configure:

- **Framework Preset:** Next.js
- **Root Directory:** `apps/playhouse`
- **Install, Build, and Output settings:** use Vercel's detected defaults
- **Node.js:** a version satisfying `>=22.0.0`

Vercel detects the repository's npm workspace lockfile and runs the PlayHouse package's `build` script from the selected Root Directory. Configure the two public Supabase values, `LEGACY_MONGO_URI`, and all four server-only credential-broker values listed above for Production and any Preview environment whose URL is included in the Supabase redirect allow list. Mongo is the default Play store; `PLAYHOUSE_DATA_SOURCE=mongo` may be set explicitly.

## Project documentation

The architecture and product specifications in [`docs/`](docs/) are the source of truth. Development must follow the phase order in [`docs/PHASES.md`](docs/PHASES.md).
