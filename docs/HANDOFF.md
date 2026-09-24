# Carnival Life — Architecture & Current State Handoff

Architecture-only exploration handoff • September 2026

## September 24, 2026 — Human Feature References + Read-only Roadmap API

- Marker `P3-ROADMAP-AI-138` gives every Development Console feature a permanent,
  concurrency-safe `CF-###` reference, searchable/copyable in the Console and preserved
  across edits, moves, reorders, and deletion gaps.
- Existing features are transactionally backfilled by creation order without changing
  roadmap sequence; an atomic Mongo counter and unique index protect new allocations.
- Token-protected GET-only roadmap, direct-reference, and schema endpoints expose clean
  Mongo-backed JSON for future ChatGPT tooling without granting mutation access.
- ChatGPT still requires a separately configured and tested connector/tool; the endpoint
  itself does not make roadmap data visible to external conversations.

## September 24, 2026 — Development Component Drag Ordering

- Marker `P3-DEVELOPMENT-COMPONENT-DRAG-137` adds drag handles and clear insertion markers
  to every persisted row in Edit Components, including hidden components.
- Drops optimistically update the left navigation and immediately reuse the existing
  owner-scoped exact-set MongoDB reorder endpoint; failures restore the prior order.
- `All Features` remains a fixed, non-draggable system view and feature sequence data is
  not modified by component ordering.

## September 24, 2026 — Development Roadmap Drag Organization

- Marker `P3-DEVELOPMENT-DRAG-136` adds feature-row drag handles to `/development`.
- Vertical drops persist one canonical owner-wide development sequence; component-filtered
  reorders preserve unrelated global slots, while ambiguous search/status/priority-filtered
  reorder is disabled with a visible explanation.
- Sidebar component drops perform a targeted stable-ID reassignment and retain priority and
  all unrelated feature fields.
- Both paths are optimistic with rollback, and global reorder uses an exact-set MongoDB
  transaction plus ordered bulk writes.

## September 24, 2026 — Editable Development Components

- Marker `P3-DEVELOPMENT-COMPONENTS-135` makes `/development` component navigation
  owner-editable without redesigning the approved console.
- Components now live in `carnival_development_components` with stable UUIDs, icon IDs,
  explicit order, visibility, and timestamps. `All Features` remains a fixed system view.
- The marker-134 names and order are seeded idempotently, and legacy name-only feature
  records are backfilled to stable component IDs while retaining their compatibility name.
- Owner-scoped component CRUD/reorder endpoints support add, rename, icon changes,
  hide/unhide, and safe move-before-delete behavior.
- See `docs/DEVELOPMENT-CONSOLE.md` for the full data, migration, and API contract.

## September 24, 2026 — Development Console V1

- Marker `P3-DEVELOPMENT-CONSOLE-134` adds the Carnival Development Console at the stable
  in-app route `/development` in the existing PlayHouse Vercel deployment.
- The console is an authenticated, owner-scoped Mongo roadmap with table/search/filter
  UI, create/edit/confirmed-delete, manual sequence, notes, and simple dependencies.
- Machine-readable CRUD is exposed under `/api/development/features`; ownership always
  comes from the authenticated session.
- One-time, clearly labeled demo features are tracked independently from approved product
  requirements and can be removed without reseeding.
- See `docs/DEVELOPMENT-CONSOLE.md` for the reconstructable UI, data, and API contract.

Purpose: Consolidate the authoritative GitHub specifications, the two long PlayHouse development conversations, and the latest product decisions so a new conversation can explore major architectural improvements without implementing them.

NEW-CONVERSATION RULE: ARCHITECTURE EXPLORATION ONLY. Do not modify GitHub, databases, Vercel, Google Cloud, Chrome extension, production data, or generate Codex implementation prompts unless the user explicitly asks to move from exploration to implementation.

## 1. Executive Snapshot
- Carnival Life is a suite centered on Plays: things a person wants or needs to do, experience, remember, delegate, coordinate, or schedule.
- PlayHouse is the user-facing Play management application.
- Roller is a separate scheduling/planning engine: deterministic first, AI later.
- MongoDB is the current authoritative operational Play database.
- Supabase is present for auth/profile/connected-account infrastructure and is the planned eventual database target. Do NOT migrate current Play functionality merely for realtime. Operational migration is deferred until the end of the development phases.
- Frontend/runtime: Next.js + TypeScript PWA on Vercel.
- Desktop: two ordinary Chrome windows, PlayHouse + Aux/context browser, coordinated by Chrome extension + native companion.
- Known-working Gmail live-refresh baseline: P3-GMAIL-LIVE-REFRESH-110.
- Current PlayHouse lifecycle implementation: commit f5028f1e2a9325d97ab7a5c45c1fbffefeeafe14 / P3-GMAIL-LIFECYCLE-119. Legacy CodeBase Gmail importer guard: f052987ac9e4c357557c3b1eab6d25da242fbaf9.

## 2. Vision and Core Vocabulary
- A Play is Carnival's core unit: action, waiting, experience, context, delegation, relationship, or future planning.
- PlayHouse owns creating, organizing, editing, searching, moving, completing and trashing Plays and presenting scheduling state.
- Roller owns decisions about when Plays occur, how unfinished Plays move, and scheduling output.
- Headline is the current actionable rank (legacy task_type H). Reminder is waiting/delegated follow-up (legacy task_type S).
- Incoming actionable communication matched to an existing Play should surface it as Today + Headline + first/top Headline, not merely promote it within Reminders.
- Baskets: Backlog, Soon, Later, In Touch, To Watch, To Go, On The Way. Cal means real date/calendar placement.
- Player points to Google People/Contacts identity. Branch is a current category evolving toward Tree of Life.
- Constellation Plays are AI-generated linked Plays that make a primary Play easier, richer, more social, motivating, or delightful.
- Long-term Roller protects Want Tos from Have Tos, seeks sustainable velocity, and optimizes for human togetherness whenever possible.

## 3. Current Architecture
### Repository and deployment
- GitHub: carnivaltheapp/carnival-life monorepo.
- apps/playhouse = Next.js PlayHouse; apps/roller = separate Roller boundary.
- extensions/chrome = Gmail/context/browser integration.
- desktop/workspace = native window + filesystem companion.
- docs/ contains architecture/product specs intended as source of truth, but some older database assumptions now conflict with current decisions.
- Vercel project: carnival-playhouse, root apps/playhouse.

### Data authority
- MongoDB is authoritative for operational Play state throughout the current development phases.
- Mongo collections added for current integration include carnival_incoming_events, carnival_gmail_watch_states and carnival_gmail_diagnostics.
- Supabase currently supports authentication/profile/connected-account/credential infrastructure. Repository SQL reflects an earlier/planned Postgres model but is not permission to cut Play state over now.
- Google is authoritative for Gmail messages/threads, Contacts/People and external Calendar events.
- Carnival is authoritative for Play semantics, lifecycle and scheduling meaning.

### Desktop workspace
- Window A = PlayHouse.
- Window B/Aux = ordinary Chrome context browser.
- Aux defaults to Calendar and can route to Gmail, Play URL, Contact, Topic URL or other context while retaining normal browser controls/history.
- Chrome extension owns browser/window identity and validated navigation; business logic belongs in Carnival services/apps.
- Native companion owns global hot-corner/window positioning and local Drive-folder mirroring; it should not become a business-logic layer.

## 4. Current Implementation Phases
- Phase 0 — Development & Access Setup: monorepo, Vercel, Google Cloud, database/dev setup, legacy source.
- Phase 1 — PlayHouse Core: PWA, Plays, Normal/Reminder, baskets, selection/drag, Done/Trash, Done/Create, delegated/waiting, search, settings, history.
- Phase 2 — Google Integration: accounts, Calendar, appointments, Gmail starred-thread integration, contacts, completion sync, loop safeguards.
- Phase 3 — Deterministic Roller: midnight/manual 7-day scheduling, duration, appointments, Push rules, Reminder conversion, holidays, Personal Time, Places, explainability.
- Phase 4 — Desktop Workspace: two-window Chrome context model, remembered geometry, lightweight extension/desktop adapter.
- Phase 5 — Mobile & Tablet UX: responsive PlayHouse, swipe PlayHouse/context, mobile interactions.
- Phase 6 — Native Carnival Calendar: combined native PlayHouse/Calendar UX; Google Calendar headless.
- Phase 7 — AI Roller & Intelligent PlayHouse: learned scheduling/context, Constellations, Want To/Have To balance, togetherness.
- Phase 8 — Platform Expansion: Tree of Life, Weekends, household/sharing, Carnival-to-Carnival, notifications, offline, broader intelligence.

**Superseding database decision:** Older GitHub architecture/phase documents describe Supabase/Postgres becoming authoritative earlier. Current user direction supersedes that: keep MongoDB operational through the development phases; migrate to Supabase at the end. Reconcile GitHub docs before implementation decisions rely on older wording.

## 5. Gmail / Google Architecture
### Incoming Gmail
- Pipeline: Gmail watch → authenticated Google Cloud Pub/Sub push → /api/incoming/gmail/pubsub → Gmail history → Carnival Incoming Event.
- Watch state lives in Mongo carnival_gmail_watch_states; incoming events in carnival_incoming_events.
- Message bodies are not stored by this pipeline.
- Production Gmail sent historyId as a JSON number despite docs describing a string; Carnival preserves the original numeric token exactly as a string to avoid JS precision loss.
- Matched actionable mail mutates the existing Play to owner's local Today, Headline H, first Headline after any Appointments.
- Incoming Gmail indicator opens Aux Gmail; successful routing marks current Gmail events handled.

### Gmail identity
- Gmail WEB thread reference and Gmail API thread ID are different identities and must not be conflated.
- Web reference is for browser/Aux/exact-tab DOM operations.
- API thread ID is for stable server/incoming matching.
- Opened-message drag captures API thread ID from Gmail conversation header h2[data-legacy-thread-id].
- Direct drag from Gmail list rows was explored, diagnosed to native dragstart not firing, then deliberately abandoned and rolled back. Supported workflow: open the Gmail conversation, then drag into PlayHouse.

### Live refresh
- P3-GMAIL-LIVE-REFRESH-110 is the known-working interim behavior.
- While PlayHouse is visible it polls every 5 seconds for a changed successful PLAY_INCOMING_MUTATION token and calls router.refresh(); it does not reload the whole browser page every five seconds.
- Do not introduce Supabase merely to replace this polling during Mongo phases.
- At final Mongo→Supabase migration, replace polling with a general PlayHouse-data-changed realtime/push mechanism shared by Gmail, Calendar, Slack and other server-side mutations. Remove polling only after realtime is verified.

### Permanent diagnostics
- carnival_gmail_diagnostics is a privacy-safe chronological operational trail.
- It uses booleans/enums, Play IDs where appropriate, and SHA-256 fingerprints instead of raw Gmail IDs.
- It excludes bodies, subjects, addresses, credentials, raw provider payloads and tokens.
- Authenticated GET /api/diagnostics/gmail retrieves trails and also supports interim live refresh.

## 6. Done / Trash Lifecycle — Implemented Correction and Verification Status
- Done persistence is authoritative in Mongo: is_active=false, is_deleted=false.
- Trash persistence is authoritative in Mongo: is_active=false, is_deleted=true.
- P3-GMAIL-LIFECYCLE-119 moved lifecycle Gmail cleanup server-side using the stable Gmail API thread ID; it no longer requires an open Gmail tab or web thread reference.
- Done persists first, then server-side Gmail API removes STARRED. Done never moves Gmail to Trash.
- Trash persists first, then independently removes STARRED and calls Gmail's thread Trash API.
- Gmail cleanup failures never reverse Mongo lifecycle state.
- Current Gmail-derived creation checks owner + stable Gmail API thread ID across active, Done and Trashed Plays before creating. Existing inactive linkage suppresses recreation.
- Privacy-safe lifecycle and creation-decision diagnostics were added.
- A reported "trashed Play came back" was proven to be a NEW duplicate, not reactivation of the original trashed Mongo record.
- The external resurrection source was located in the separate legacy CodeBase repository: Code/Roller/Roller.ahk invokes MongoUpdate_fromGmail(), whose prior active-only comparison could recreate inactive Gmail Plays.
- Legacy CodeBase commit f052987ac9e4c357557c3b1eab6d25da242fbaf9 adds an owner-scoped all-lifecycle lookup by stable Gmail API thread_id immediately before insertion. Active, Done and Trashed matches are suppressed without reactivation/restoration; lookup failure safely suppresses.
- This closes the identified daily Roller.ahk → MongoUpdate_fromGmail() resurrection path in code. Real-world verification across the next importer cycle is still prudent before treating the lifecycle as operationally proven.
- Carnival currently has two repositories participating in production behavior: carnival-life and the legacy CodeBase. Eliminating or absorbing this split is an architectural topic for the new discussion.

## 7. Roller Architecture
- Roller remains a separate application/domain boundary.
- Deterministic V1 runs at midnight per-user timezone and manually; rebuilds a rolling seven-day schedule.
- Inputs: open Plays/order, Normal/Reminder, dates/Baskets, Duration, Push, workday settings, appointments, blocking calendars, holidays, Personal Time, Places/travel.
- Appointments are fixed. Normal Plays are duration-scheduled around them.
- Push rules: Everyday default, Weekdays, Weekends, respecting blocked dates.
- Due Reminder becomes actionable/top-of-day when Roller runs.
- Every deterministic decision should be structurally explainable/logged for later AI learning.
- Future AI considers mood/environment, personality, learned behavior, actual durations, time-of-day, location, Want To/Have To balance, social opportunities, Constellations and experience feedback.

## 8. Tree of Life / Drive
- During current Mongo phase, local Google Drive for Desktop hierarchy is authoritative for folder existence/path structure.
- Native companion mirrors folder create/rename/move/delete into owner-scoped Mongo tree_of_life and reconciles.
- Drive API resolves durable folder identity/web URL; it should not replace local filesystem hierarchy.
- Branch state is explicit metadata and should survive scans/renames/moves.

## 9. UI / Interaction Decisions to Preserve
- Two Chrome windows remain part of desktop workflow.
- Single-click Description routes context links; double-click Description opens Details.
- Detail view must not be overlaid by sticky/frozen PlayHouse layers.
- Top app header, crown/date, column headers, bullseye and items beneath it are intended to stay fixed while Play rows scroll; normal scrollbar and mouse wheel remain.
- Show Branch filters displayed Plays using first branch path component; All Branches is default.
- Description hover shows full description bubble.
- Opened-message Gmail drag supported; Gmail list-row drag intentionally unsupported for current phases.

## 10. Architectural Debt / Interim Solutions
- 5-second polling: intentional Mongo-era bridge; replace with general realtime/push only during final Supabase migration.
- Mongo + Supabase split: current reality. Avoid dual authority for Play state; Mongo remains operational Play authority.
- Older GitHub docs: some still encode earlier Supabase-first assumptions and need reconciliation.
- Legacy/daily writer: located in the separate CodeBase repository (Roller.ahk → MongoUpdate_fromGmail) and guarded in commit f052987ac9e4c357557c3b1eab6d25da242fbaf9. Two repositories participating in production behavior remains architectural debt.
- Chrome DOM integration: necessary for some browser behaviors and inherently brittle; keep business logic server-side and diagnostics strong.
- Gmail list-row drag: abandoned for current phases after native dragstart did not fire under Gmail's internal drag behavior.

## 11. Known Baselines / Important Markers
- P3-GMAIL-LIVE-REFRESH-110 — known-working Gmail incoming mutation + automatic 5-second visible-window refresh baseline.
- P3-FROZEN-PLAYHOUSE-111 — frozen header/crown/column/bullseye work.
- P3-DETAIL-STICKY-SCOPE-113 — Detail view sticky/frozen scoping correction.
- P3-GMAIL-STAR-TOOLTIP-114 — Gmail current tooltip="Starred"/"Not starred" DOM support.
- P3-GMAIL-LIST-ROLLBACK-118 — list-row drag experiment removed; opened-message drag remains supported.
- P3-GMAIL-LIFECYCLE-119 — server-side Gmail Done/Trash lifecycle cleanup plus current-repository Gmail duplicate suppression.

Markers are behavioral baselines, not substitutes for checking the actual current Git commit and retained code.

## 12. Major Architectural Questions for the New Conversation
- Should Carnival converge on a source-neutral event-driven architecture, and where should current-state mutation vs event-history boundaries sit?
- How should the final Mongo→Supabase migration avoid a big-bang cutover while preserving known-working behavior?
- What should replace 5-second polling at Supabase migration: database change feed, explicit domain-event broadcast, or hybrid?
- Should Gmail, Calendar and Slack share one external-event ingestion and identity-resolution framework?
- How should lifecycle identity/tombstones prevent resurrection/duplicate creation across all external importers, and how should the legacy CodeBase importer be retired or absorbed?
- How should Roller consume current state, external constraints and event history without coupling to PlayHouse persistence details?
- Should materialized Play state + append history evolve toward event sourcing, or remain intentionally hybrid?
- Where should background jobs/cron/queues live as Carnival grows beyond Vercel request lifetimes?
- How should extension/native-companion boundaries evolve as native Carnival Calendar and mobile mature?
- How should Tree of Life, Branches, contacts, household/sharing and Constellations fit a stable domain model before final DB migration?
- What observability standard should generalize the successful Gmail diagnostic trail across Calendar, Slack, Roller and lifecycle processing?

## 13. Non-Negotiable Architecture Constraints
- Do not introduce Supabase into current-phase Play functionality merely for realtime.
- Do not discard known-working Gmail behavior while exploring cleaner architecture.
- Do not make the Chrome extension a business-logic layer.
- Do not make Google systems authoritative for Carnival Play semantics.
- Do not encode Baskets as fake future dates in the target architecture, even though legacy Mongo uses sentinel dates.
- Preserve rich behavioral/event history for future AI.
- Keep mobile/tablet as a core architecture requirement.
- Keep multi-user/household readiness without implicitly sharing all data.
- Prefer source-neutral mechanisms where Gmail/Calendar/Slack will eventually need the same capability.
- Architecture exploration in the new conversation is non-implementing until explicitly authorized.

## 14. GitHub Sources Consulted
- README.md
- docs/ARCHITECTURE.md
- docs/PHASES.md
- docs/PLAYHOUSE.md
- docs/ROLLER.md
- docs/DATA-MODEL.md
- docs/GOOGLE-INTEGRATION.md
- docs/MIGRATION.md
- PHASE-1-START-HANDOFF.txt
- desktop/workspace/README.md
- apps/roller/README.md
- Recent carnival-life Git history through P3-GMAIL-LIFECYCLE-119.
- Legacy CodeBase lifecycle guard commit f052987ac9e4c357557c3b1eab6d25da242fbaf9.

## 15. Suggested Opening Message for the New Conversation

“We are starting an architecture-only discussion for Carnival Life. Read the Project Instructions and the document ‘Carnival Life — Architecture & Current State Handoff — September 2026.’ Use the current GitHub docs as supporting source material, but where older GitHub database assumptions conflict with the handoff/Project Instructions, the current Mongo-through-phases decision controls. We are exploring major architectural improvements only. Do not implement anything, change code, modify databases/infrastructure, or send work to Codex unless I explicitly ask to move from architecture exploration to implementation. Start by identifying the highest-leverage architectural improvements and the tradeoffs of each.”
