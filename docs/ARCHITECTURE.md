# Carnival Life Architecture

## 1. Vision

Carnival Life is a modular suite of applications centered on Plays: things a person wants or needs to do, experience, remember, delegate or coordinate.

The first migration replaces the existing AutoHotkey v1 PlayHouse prototype with a web-based Carnival platform deployed through Vercel. The design must solve today's PlayHouse workflow without constraining the longer-term Carnival vision: intelligent Roller scheduling, a native combined PlayHouse/Calendar UX, Tree of Life, Weekends, Constellation Plays, households/sharing, and AI that learns from actual behavior.

Carnival's long-term scheduling objective is not productivity maximization alone. Roller should protect Want Tos from being overwhelmed by Have Tos, seek sustainable velocity, and optimize for human togetherness whenever possible.

## 2. Product/Application Boundaries

Carnival is the product/platform. Major capabilities are separate Carnival applications/subprojects in one monorepo.

Initial applications:
- **PlayHouse** — user-facing management of Plays.
- **Roller** — scheduling/planning engine.

Future applications may include Weekends, Tree of Life and other Carnival experiences.

Shared capabilities (database access, Google integration, authentication, common UI/types) should live in shared packages/services and not be duplicated per application.

Recommended repository shape:

```text
carnival-life/
├── AGENTS.md
├── apps/
│   ├── playhouse/
│   └── roller/
├── shared/                 # exact package structure finalized during scaffolding
├── extensions/
│   └── chrome/             # later desktop window orchestration
└── docs/
    ├── ARCHITECTURE.md
    ├── PHASES.md
    ├── PLAYHOUSE.md
    ├── ROLLER.md
    ├── DATA-MODEL.md
    ├── GOOGLE-INTEGRATION.md
    └── MIGRATION.md
```

A monorepo does not mean all components must remain one deployment forever. Application boundaries should allow Roller or other services to deploy independently later if compute/runtime requirements diverge.

## 3. Recommended Technology Stack

### Frontend
- Next.js + TypeScript.
- React-based PlayHouse UI.
- PWA from V1.
- Responsive desktop/tablet/mobile design.
- Modern accessible drag/drop library chosen during implementation.

### Hosting / Runtime
- Vercel for PlayHouse web deployment and suitable server/API functions.
- Vercel cron or an equivalent reliable scheduled mechanism for deterministic Roller midnight runs, subject to runtime/timezone constraints validated during implementation.
- If Roller later exceeds serverless execution limits, preserve the app boundary and move execution without rewriting PlayHouse.

### Database
- One shared Carnival Supabase project using Postgres.
- Supabase is the authoritative store for Carnival-owned Play state, relationships, settings and behavioral history.
- Row Level Security for multi-user isolation.
- Version-controlled SQL/database migrations; avoid hand-built production-only schema.

### Authentication
- Google OAuth.
- A Carnival user may connect multiple Google accounts.
- Separate Carnival identity/profile from connected Google account records.

### External Google Systems
- Gmail API.
- Google Calendar API.
- Google People API.

Google remains authoritative for Gmail messages/threads, Google Contacts, and external Calendar events. Carnival remains authoritative for Carnival Play semantics/state/history.

## 4. Deployment Topology

### Vercel
The existing Carnival Vercel team hosts deployable Carnival applications.

PlayHouse Vercel project:
- project name: `carnival-playhouse`
- Git repository: `carnivaltheapp/carnival-life`
- root directory: `apps/playhouse`

Do not deploy the monorepo root as if Carnival were one UI application.

Roller may initially execute using server routes/functions/jobs associated with the Carnival codebase, but remains a separate application/domain. Create a separate Vercel project only when deployment/runtime needs justify it; do not create infrastructure merely to mirror folder names.

### Supabase
One Carnival Supabase/Postgres database serves Carnival applications. The project is currently established in West US / Northern California.

### Environments
Target a clear local -> preview/staging -> production flow. Vercel Preview deployments should be the normal acceptance surface before production promotion.

Secrets must be environment-specific and stored in Vercel/Supabase/platform secret stores, never Git.

## 5. PlayHouse Architecture

PlayHouse is a dedicated application surface for Play management. It owns:
- Play CRUD;
- list/date/Basket presentation;
- modern selection and drag/drop;
- Player/contact interaction;
- Branch/category interaction;
- search;
- Done/Trash;
- Done/Create and Play relationships;
- delegated/waiting workflow;
- editing Play attributes;
- user-triggered Run Roller action;
- display of relevant scheduling state.

PlayHouse does not own the scheduling algorithm. It invokes Roller and displays Roller output.

See `PLAYHOUSE.md` for detailed behavior.

## 6. Roller Architecture

Roller owns scheduling and push-forward decisions.

Deterministic V1 inputs include:
- open Plays and ordering;
- Normal vs Reminder;
- scheduled dates/Baskets;
- Duration;
- Push rules;
- workday settings;
- current time for manual runs;
- fixed appointments;
- configured blocking calendars;
- holidays;
- Personal Time;
- Places/travel;
- seven-day planning horizon.

Roller produces:
- scheduled Normal Play slots;
- pushed dates;
- Reminder->Normal transitions when due;
- appropriate Google Calendar output/synchronization instructions;
- structured decision/explanation records.

The algorithm should be implemented as domain logic that can be unit-tested without a browser or direct Google API calls. Google adapters perform external reads/writes around the scheduling core.

See `ROLLER.md`.

## 7. Google Integration Architecture

Use an adapter/service boundary around Google APIs. PlayHouse components and Roller scheduling logic should not directly embed Google SDK calls throughout UI/domain code.

### Multiple accounts
One Carnival user may connect multiple Google accounts. Store provider connections separately from the Carnival user.

### Calendar
Build a unified availability representation from configured participating calendars. Individual calendars can be ignored for Roller blocking.

Semantic Carnival calendars currently include `AT_Appointments`, `AT_plays`, `AT_Reminders`, `AT_done`, `AT_Places`, `AT_Events`.

Roller decides semantic calendar placement. Long term, Carnival's native calendar UI superimposes these concepts while Google Calendar operates headlessly.

### Gmail
Starred threads synchronize with Email Plays. Completion/star synchronization is bidirectional and must be idempotent.

### Contacts
Player references Google People/Contacts identity. Carnival Contact Topics are separate Carnival metadata.

See `GOOGLE-INTEGRATION.md`.

## 8. Desktop Workspace Architecture

Desktop V1 supports Chrome and conceptually has two always-visible surfaces:

- **Window A:** PlayHouse PWA, dedicated to Carnival.
- **Window B:** normal Chrome context browser.

Window B defaults to Calendar when no Play is selected. PlayHouse may direct it to Gmail, a Play URL, Google Contact, Topic URL or other context. Window B remains independently navigable with normal browser controls.

A pure PWA cannot reliably control and restore arbitrary Chrome windows because of browser security restrictions. Therefore a minimal Chrome extension/desktop adapter is acceptable for:
- opening/restoring Window B;
- positioning/resizing workspace windows;
- remembering layout;
- receiving authenticated PlayHouse navigation commands and directing Window B.

The extension must not contain PlayHouse/Roller business logic or become required on mobile.

## 9. Mobile Architecture

Mobile/tablet is a core requirement.

The conceptual workspace becomes two swipeable surfaces inside the mobile experience:
- PlayHouse;
- Calendar/context.

The mobile implementation does not depend on the Chrome extension. Content that cannot legally/technically be embedded (notably some Google pages) may open in an external browser/app while preserving a straightforward return to PlayHouse.

The long-term native Carnival Calendar solves much of this by rendering Calendar itself inside Carnival while Google Calendar remains backend infrastructure.

## 10. Data and Event Architecture

Use a materialized current-state model (`plays`) plus append-oriented behavioral/event records (`play_events`) and Roller decision/run records.

This is intentional: future AI should learn from what was scheduled, what actually happened, what the user moved, what Roller pushed, how long things took, what was overridden and why.

Do not sacrifice product query simplicity by making the event log the only representation of current state. Current state and history serve different purposes.

See `DATA-MODEL.md`.

## 11. Multi-user, Household and Sharing Architecture

Multi-user is required from day one. Every user-owned record must be isolated through database ownership/RLS.

The model should be household/sharing-ready, but actual Play-sharing UI/workflows are later. Do not make all household data implicitly shared; sharing must eventually be explicit and permissioned.

Realtime multi-device updates are later than Phase 1. When introduced, last-change-wins is acceptable initially, backed by timestamps and event history.

## 12. Search Architecture

Phase 1 search is Play-centric. Plain terms search across searchable Play fields and dates. Gmail-like operators narrow by field, status, date range, type, Player, Branch, Basket, etc.

Default scope is Plays. `in:anywhere` is the explicit expansion point for future Carnival-wide search including Contact Topics and other applications.

Start with Postgres-backed search/querying appropriate to the data volume. Do not introduce a separate search service until scale/quality requirements justify it.

## 13. Notification Architecture

Email and SMS are desired later, not V1 delivery requirements.

Model domain events/preferences so notification delivery can subscribe later. Do not couple PlayHouse or Roller core logic directly to a specific email/SMS vendor.

## 14. Offline Architecture

Offline operation is later. V1 requires network connectivity. PWA structure and stable IDs/event history should avoid unnecessarily blocking future offline sync, but do not add CRDT/local-first complexity to V1.

## 15. Legacy Migration

The old AHK/Mongo system is not the target architecture.

Approved migration uses a private export of selected `restlandmark.tasks_task` records. The source filter, 782-record discovery control total, legacy Basket sentinel mapping and field interpretations are defined in `MIGRATION.md`.

Preserve legacy Google/Gmail identifiers so existing integrations continue rather than being recreated blindly.

## 16. Observability and Explainability

From V1:
- structured application errors/logging;
- migration validation report;
- Roller run records;
- Roller decision reasons;
- Play behavioral events;
- integration sync state/errors.

This supports debugging now and AI/behavioral insight later.

## 17. Security

Minimum requirements:
- no secrets in Git;
- server-only service-role keys;
- secure OAuth token storage;
- least-privilege Google scopes where practical;
- RLS before production;
- user ownership checks on server mutations;
- idempotent webhook/sync handlers;
- migration source kept private;
- production and development credentials separated where appropriate.

## 18. Testing Strategy

Each phase must be independently demonstrable.

Testing layers:
- unit tests for Play and Roller domain rules;
- database tests/migration validation;
- integration tests around Google adapters with controlled/test accounts where feasible;
- PlayHouse component/e2e tests for core flows;
- explicit acceptance checklist per phase;
- Vercel Preview deployment used for owner acceptance before production.

Critical deterministic Roller rules should have table-driven tests for workday boundaries, increments, appointments, Push, weekends/weekdays, holidays, Personal Time, travel and Reminder conversion.

## 19. Immediate Build Sequence

After Phase 0 documentation/setup:
1. Scaffold the Carnival monorepo tooling and `apps/playhouse` Next.js PWA without destroying existing docs.
2. Deploy the first PlayHouse skeleton to the configured Vercel project.
3. Add version-controlled Supabase schema/migrations and RLS foundation.
4. Configure real OAuth origins/callbacks for local and Vercel environments.
5. Establish Google sign-in/test account.
6. Create private legacy snapshot and implement repeatable migration.
7. Validate imported active Plays against the migration control report.
8. Implement/test Phase 1 capabilities in small vertical slices.

## 20. Future-state Guardrail

Do not prematurely implement AI Roller, native Carnival Calendar, realtime sync, offline, notifications or sharing merely because the architecture anticipates them. V1 must establish clean boundaries and collect the right data so those capabilities can be added without rewriting the core.