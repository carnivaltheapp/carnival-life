# Carnival Development Instructions

## Product Structure

Carnival Life is the overall product/platform. Major capabilities are separate Carnival applications/subprojects within one monorepo and one shared Carnival data platform.

Current applications:
- `apps/playhouse` — the user-facing PlayHouse application for managing Plays.
- `apps/roller` — the scheduling and planning engine that decides when Plays should happen.

Future Carnival applications may include Weekends, Tree of Life, Constellation Plays, and other modules. Shared infrastructure belongs in shared packages/services rather than being duplicated inside an app.

## Source of Truth

Read the documents in `/docs` before making architectural or product changes. In particular:
- `docs/ARCHITECTURE.md`
- `docs/PHASES.md`
- `docs/PLAYHOUSE.md`
- `docs/ROLLER.md`
- `docs/DATA-MODEL.md`
- `docs/GOOGLE-INTEGRATION.md`
- `docs/MIGRATION.md`

If implementation details conflict with these documents, raise the conflict rather than silently changing product behavior.

## Legacy AHK

The existing AutoHotkey v1 PlayHouse implementation is a behavioral reference only. Do not port its architecture or translate AHK functions one-for-one into TypeScript/JavaScript.

Use the legacy code only to answer questions about existing behavior, field semantics, Google integration details, or edge cases not covered by the current specification.

## Architecture Principles

- Carnival is a monorepo and modular platform.
- PlayHouse and Roller are separate Carnival applications with clear ownership boundaries.
- One shared Supabase/Postgres database serves Carnival.
- Google Calendar, Gmail, and Google Contacts remain external systems integrated through Carnival.
- Supabase becomes the authoritative store for Carnival Play state and history.
- Google Calendar remains the scheduling/execution backend and may later become headless behind a native Carnival calendar UX.
- V1 should be simple, testable, and deterministic. Future AI behavior must not be required to make V1 usable.
- Preserve rich event/history data for later AI learning and behavioral insights.
- Multi-user data isolation must be designed from day one.
- Do not expose legacy implementation fields in the user interface unless they are still meaningful product concepts.

## Security

- Never commit passwords, OAuth tokens, service-role keys, MongoDB connection strings, or other secrets.
- Use environment variables and platform secret stores.
- Google OAuth refresh tokens must be stored securely.
- Apply Supabase Row Level Security before production use.
- Legacy MongoDB data should be migrated from a private export rather than committed to GitHub.

## Delivery

Implement in the order defined in `docs/PHASES.md`. Each phase should have explicit acceptance tests and should be independently demonstrable before beginning the next phase.