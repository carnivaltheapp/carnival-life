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

On PowerShell, use `Copy-Item .env.example .env.local`. Populate only these public browser-safe values from the Supabase project Connect dialog:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
```

Do not add a service-role key or Google client secret to the PlayHouse environment. Google provider credentials remain in Supabase's hosted Auth configuration.

For Google sign-in, Supabase Auth URL Configuration must allow both application callback origins:

- `https://carnival-playhouse.vercel.app/**`
- `http://localhost:3002/**`

The application callback routes are `https://carnival-playhouse.vercel.app/auth/callback` and `http://localhost:3002/auth/callback`. Google Cloud's authorized redirect URI remains the hosted Supabase Auth callback shown on the Supabase Google provider page—not the PlayHouse callback route.

## Vercel deployment

Create or connect the `carnival-playhouse` Vercel project to `carnivaltheapp/carnival-life` and configure:

- **Framework Preset:** Next.js
- **Root Directory:** `apps/playhouse`
- **Install, Build, and Output settings:** use Vercel's detected defaults
- **Node.js:** a version satisfying `>=22.0.0`

Vercel detects the repository's npm workspace lockfile and runs the PlayHouse package's `build` script from the selected Root Directory. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Production and any Preview environment whose URL is included in the Supabase redirect allow list.

## Project documentation

The architecture and product specifications in [`docs/`](docs/) are the source of truth. Development must follow the phase order in [`docs/PHASES.md`](docs/PHASES.md).
