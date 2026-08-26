# Carnival Supabase foundation

This directory contains version-controlled database configuration and migrations for the one shared Carnival Supabase/Postgres project.

The first Phase 1 migration establishes:

- Carnival profiles linked to Supabase Auth users;
- explicit per-user Baskets;
- Google account/contact reference metadata without OAuth tokens;
- materialized Play state with real date-or-Basket placement;
- next-Play relationships;
- append-only Play event history;
- the initial workday/settings model;
- indexed ownership columns and Row Level Security on every exposed table.

The next narrow Phase 1 migration adds database-controlled lifecycle normalization and
transactional Play history. Create, edit, move, type change, done, trash, and any later
reopen transition append before/after context to `play_events` in the same transaction as
the current-state write.

## Local validation

Local Supabase requires a Docker-compatible container runtime. From the repository root:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:test
```

Stop the local stack with:

```bash
npm run db:stop
```

## Applying to a hosted development project

Authenticate and link the Supabase CLI using your local/platform credential store, then preview and apply migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Never commit the project access token, database password, generated local environment files, or service-role credentials. Apply this migration to development first and verify RLS before any production promotion.

## First-slice acceptance

- A new Auth user receives one Carnival profile, all seven default Baskets, and default Roller settings.
- A Play must have exactly one placement: a real calendar date or an explicit Basket.
- Composite foreign keys prevent cross-user Basket, Player, relationship, and event references.
- Authenticated clients can access only their own rows.
- System Baskets cannot be mutated through the client role.
- Plays use `done` or `trash` lifecycle state instead of client-side physical deletion.
- Play events can be selected and appended, but not updated or deleted by clients.
