# Carnival Implementation Phases

The migration is deliberately divided into independently testable phases. Do not bundle later capabilities into an earlier phase unless the specification explicitly requires them.

## Phase 0 — Development and Access Setup

Goal: establish a reproducible development environment and source of truth before application development begins.

Capabilities/setup:
- Carnival GitHub monorepo at `carnivaltheapp/carnival-life`.
- `apps/playhouse` and `apps/roller` established as Carnival applications.
- Carnival Vercel team/project setup. PlayHouse Vercel project is `carnival-playhouse` with root directory `apps/playhouse`.
- One shared Carnival Supabase/Postgres project in West US / Northern California.
- Google Cloud project `Carnival Life` under the available organization.
- Enable Google Calendar API, Gmail API, and Google People API.
- Configure Google Auth Platform; create final OAuth web client only after real local/Vercel callback URLs are known.
- Legacy MongoDB source identified as `restlandmark.tasks_task`.
- Create a private legacy migration snapshot; never commit it to GitHub.
- Migration control set: active, non-deleted Plays with `task_date >= 2026-08-25`, including legacy Basket dates. At discovery time this produced 782 records.
- Architecture/specification documents committed to `/docs`.
- Codex/developers can read this repository and the legacy AHK repository as reference.

Phase 0 exit condition: a developer can clone Carnival, run the PlayHouse skeleton locally, deploy a Vercel preview, connect to the development Carnival database, and authenticate a test Google account once OAuth callbacks are configured.

## Phase 1 — PlayHouse Core

Goal: replace the core AHK PlayHouse experience with a usable web/PWA application.

Capabilities:
- Next.js-based PlayHouse PWA deployed through Vercel.
- Multi-user model and Google OAuth login.
- Google Contacts/People integration sufficient for Player selection and contact actions.
- Import the approved active legacy Plays.
- Play create/read/update operations.
- Normal and Reminder Play behavior.
- Fields including title, date/basket, Branch, Player, note, URL, duration, Push, Place and relevant external identifiers.
- Calendar-date and Basket placement.
- Baskets: Cal, Backlog, Soon, Later, In Touch, To Watch, To Go, On The Way. Other legacy baskets can be ignored initially.
- Modern selection: click, Shift range selection, Ctrl/Cmd toggle.
- Drag-and-drop reorder and moving to dates/Baskets.
- Done and Trash.
- Done/Create and next-Play relationships.
- Delegated/waiting workflow.
- Reminder workflow.
- Global Play search with Gmail-like field/status/date operators; default searches Plays, `in:anywhere` expands scope later.
- Settings foundation.
- High-fidelity Play activity/history logging for future insights and AI learning.

Deferred from Phase 1: realtime multi-device synchronization and offline synchronization.

## Phase 2 — Google Integration

Goal: make PlayHouse continuously interoperable with the user's Google world.

Capabilities:
- Multiple Google accounts per Carnival user.
- Calendar discovery and per-calendar blocking/ignore configuration.
- Unified availability across selected connected calendars.
- Import appointments from Google Calendar.
- Preserve and synchronize existing Google Calendar IDs.
- Gmail starred-thread import.
- New starred incoming email becomes Normal; new starred outgoing email becomes Reminder.
- Known Google Contact populates Player.
- Gmail unstar marks the corresponding email Play Done.
- Marking an email Play Done unstarrs the Gmail thread.
- Safeguards against synchronization loops.
- Calendar semantics for `AT_Appointments`, `AT_plays`, `AT_Reminders`, `AT_done`, `AT_Places`, and `AT_Events`.

## Phase 3 — Deterministic Roller

Goal: reproduce and improve the rule-based scheduling engine before introducing AI scheduling.

Capabilities:
- Midnight scheduled run in each user's timezone.
- Manual Run Roller action at any time.
- Build/rebuild a rolling seven-day schedule.
- User settings: workday start, workday stop, scheduling increment.
- Midday manual run starts at the next increment boundary (e.g. 10:14 -> 10:15 for 15-minute increment; -> 10:30 for 30-minute increment).
- Duration-based Normal Play scheduling.
- Appointments are fixed constraints; Roller places Normal Plays around them.
- Preserve user drag/drop order subject to fixed constraints.
- If a Play cannot fit, apply its Push rule; default Push is Everyday.
- Push rules include Everyday, Weekdays, Weekends.
- Due Reminder converts automatically to Normal when Roller runs and is inserted at the top of that day's Plays.
- Reminder duration is ignored while waiting.
- Country/federal holiday blocking.
- Carnival Personal Time override measured in whole days with start date, end date and optional label.
- `AT_Places` travel/excursion periods block normal scheduling in V1.
- Explainable Roller decision logs including the inputs/rules that caused moves, skips, pushes and scheduling decisions.

## Phase 4 — Desktop Workspace

Goal: reproduce the productive two-surface desktop experience while keeping PlayHouse web-based.

Capabilities:
- Chrome is the supported V1 desktop browser.
- Window A is the dedicated PlayHouse PWA/application surface.
- Window B is a normal Chrome browser/context window.
- Both windows are always part of the desktop workspace and visible together.
- Window sizes/positions are resizable and remembered.
- When no Play is selected, Window B shows Calendar.
- PlayHouse can direct Window B to a Play URL, Gmail thread/list, Google Contact, Topic URL, or other context.
- Window B retains normal browser Back/Forward/Refresh/navigation behavior.
- A lightweight Chrome extension/desktop adapter may be used only for window orchestration and navigation; business logic remains in Carnival web services/apps.

## Phase 5 — Mobile and Tablet UX

Goal: make mobile/tablet a core usable Carnival experience rather than a desktop shrink-down.

Capabilities:
- Fully responsive PlayHouse.
- Swipe between PlayHouse and Calendar/context surfaces.
- Calendar is the default second surface when nothing is selected.
- Context routing for Plays, URLs, Gmail and Contacts, respecting mobile browser embedding/security limitations.
- Mobile-appropriate moving, selection and ordering interactions.

Realtime multi-device synchronization can be introduced in this phase or a dedicated platform phase when needed. Conflict policy for V1 is last change wins.

## Phase 6 — Native Carnival Calendar

Goal: design PlayHouse and Calendar together as a single Carnival UX while retaining Google Calendar as the headless calendar backend.

Capabilities:
- Native Carnival rendering of Plays, appointments, reminders, events and travel.
- Superimposed calendar layers with colors representing semantic/rank calendars.
- Direct interaction between PlayHouse and calendar.
- Google Calendar remains synchronization/backend infrastructure rather than the primary UI.
- Desktop and mobile share the same calendar domain model.

## Phase 7 — AI Roller and Intelligent PlayHouse

Goal: evolve deterministic scheduling into learned, context-aware Carnival intelligence.

Potential capabilities:
- Mood/environment awareness.
- Character/personality type established during onboarding.
- Learning from scheduling, pushes, completion behavior, durations and overrides.
- Learned estimates of when and how the user completes different Plays.
- Have To / Want To balance and sustainable velocity.
- Location and opportunity optimization.
- Constellation Plays that make primary Plays easier, richer, social, motivating or delightful.
- Human-togetherness optimization as a fundamental objective.
- AI explanations and recommendations built on the V1 event/history dataset.

## Phase 8 — Carnival Platform Expansion

Potential capabilities:
- Tree of Life.
- Carnival Weekends.
- Household/shared-user experiences and Play sharing.
- Carnival-to-Carnival relationships.
- Email/SMS notification delivery (notification architecture can exist earlier).
- Offline operation and later synchronization.
- Broader cross-application intelligence and shared Carnival context.