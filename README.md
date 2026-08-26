# Carnival Life

Carnival Life is a suite of applications designed to help people manage what they have to do while protecting and creating more of what they want to do.

## Applications

- **PlayHouse** (`apps/playhouse`) — the user-facing application for managing Plays.
- **Roller** (`apps/roller`) — the separate scheduling and planning engine. Its implementation is deferred to a later phase.

Additional Carnival applications will be added to this monorepo over time.

## Prerequisites

- Node.js 20.9 or newer (the current Node.js LTS release is recommended)
- npm 10 or newer

No Supabase project or Google OAuth credentials are required for the Phase 0 application shell.

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

Then open [http://localhost:3000](http://localhost:3000).

The same application can be run from its Vercel root directory:

```bash
cd apps/playhouse
npm run dev
```

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

Run all three checks in sequence with:

```bash
npm run check
```

## Environment variables

[`apps/playhouse/.env.example`](apps/playhouse/.env.example) reserves the environment variable names expected by later authentication and data phases. Do not add real credentials to tracked files. The Phase 0 shell does not read these variables.

## Vercel deployment

Create or connect the `carnival-playhouse` Vercel project to `carnivaltheapp/carnival-life` and configure:

- **Framework Preset:** Next.js
- **Root Directory:** `apps/playhouse`
- **Install, Build, and Output settings:** use Vercel's detected defaults
- **Node.js:** a version satisfying `>=20.9.0`

Vercel detects the repository's npm workspace lockfile and runs the PlayHouse package's `build` script from the selected Root Directory. Environment variables are not needed for the Phase 0 shell. Configure them in Vercel only when the corresponding later phase is implemented.

## Project documentation

The architecture and product specifications in [`docs/`](docs/) are the source of truth. Development must follow the phase order in [`docs/PHASES.md`](docs/PHASES.md).
