# Carnival Conceptual Data Model

This document defines domain ownership and conceptual entities. Exact SQL types, indexes and constraints should be finalized during implementation and represented as version-controlled Supabase migrations. Do not manually create an ad-hoc production schema from this document.

## Principles

- One shared Carnival Supabase/Postgres database.
- Multi-user isolation from day one.
- Household/sharing-ready model from day one, although sharing UI/workflows are later.
- PlayHouse and Roller share domain data but retain clear application ownership.
- External Google identities are references/integrations, not substitutes for Carnival's own domain model.
- Preserve append-oriented behavioral history for later analytics/AI.
- Use explicit placement/state instead of legacy sentinel dates.

## Core Identity

### users
Carnival user/profile linked to authentication identity. Suggested concepts:
- id (UUID)
- auth user reference
- display/profile settings
- country
- timezone
- created/updated timestamps

### households / memberships
Future-ready structures for explicit shared relationships. Do not expose sharing behavior in Phase 1, but avoid assuming all data is permanently single-owner.

### google_accounts
Multiple rows per Carnival user are allowed.
Concepts:
- Carnival user owner
- Google provider account ID/email/display metadata
- token/connection state (secrets stored securely)
- granted scopes
- sync state/cursors
- timestamps/status

### google_calendars
Discovered calendars per connected account.
Concepts:
- Google calendar ID
- display name/color metadata
- semantic Carnival role if applicable
- whether it blocks Roller
- whether Carnival writes to it
- sync state

## PlayHouse Domain

### plays
Current materialized state of each Play.

Conceptual fields:
- id UUID
- owner_user_id
- title
- status (`open`, `done`, `trash` or equivalent)
- play_type (`normal`, `reminder`)
- source_type (`user`, `gmail`, future sources)
- scheduled_date nullable
- basket_id nullable
- duration_minutes nullable/meaningful for Normal
- player_contact reference nullable
- branch reference/value nullable
- note nullable
- url nullable
- push_rule
- place/context nullable
- sort_order
- created_at / updated_at / completed_at
- legacy_mongo_id nullable unique within migration source
- source metadata as needed

Constraint/invariant: a Play is placed either on a real calendar date or in a Basket; do not encode Baskets as fake dates.

### baskets
User/system Basket definitions. Seed relevant system/default baskets:
- Backlog
- Soon
- Later
- In Touch
- To Watch
- To Go
- On The Way

`Cal` is a calendar/date destination concept rather than necessarily a Basket row.

Allow future user-defined baskets without forcing them into V1 UX.

### play_relationships
Supports Done/Create and future dependencies/Constellation structures.
Concepts:
- from_play_id
- to_play_id
- relationship_type (`next`, future dependency/constellation types)
- timestamps/metadata

### branches
Branch is currently a Play category and later part of Tree of Life. Initial migration may preserve legacy Branch strings while the normalized branch/tree model evolves.

### contact_references
Player points to a Google Contact/People identity associated with a connected Google account. Store stable provider identifiers plus minimal cached display metadata needed for UI resilience. Avoid turning cached contact data into a second authoritative address book.

### contact_topics
Future-ready Carnival-owned metadata associated with a contact reference.
Concepts:
- contact reference
- topic title
- optional URL
- optional note/metadata

## External Linkage

Prefer separate linkage tables when external integration state becomes complex rather than continuously expanding `plays`.

### play_google_calendar_links
Concepts:
- play_id
- connected Google account/calendar
- event_id
- long_id/legacy identifier if still required
- sync version/status/timestamps

### play_gmail_links
Concepts:
- play_id
- connected Google account
- thread_id
- message_id
- last_message_id (`last_id` legacy continuity)
- star/sync state
- sync version/status/timestamps

Email is an independent source dimension: a Gmail-linked Play may be Normal or Reminder.

## Roller Domain

### roller_settings
Per-user scheduling settings:
- workday start
- workday stop
- scheduling increment minutes
- timezone/country references as needed
- future Roller preferences

### personal_time
Whole-day Carnival override:
- user
- start_date
- end_date
- optional label

### roller_runs
One record per scheduled/manual run:
- user
- trigger (`midnight`, `manual`, future)
- planning window
- started/completed timestamps
- status/version
- summary metrics/errors

### roller_decisions
Structured explainability log tied to a Roller run and Play where applicable.
Concepts:
- decision/action type
- input state/rule
- source date/time and target date/time
- reason code
- structured reason payload
- human-readable explanation
- timestamps

This data is intentionally valuable for future AI training/analytics.

## Behavioral Event History

### play_events
Append-oriented event stream/history for meaningful user/system behavior.

Concepts:
- id
- play_id
- user/actor where applicable
- event_type
- timestamp
- before/after or structured payload
- source (`user`, `roller`, `gmail_sync`, `calendar_sync`, `migration`, etc.)
- device/session metadata when useful and privacy-appropriate
- correlation/run IDs

Examples include create, edit, move, reorder, schedule, push, complete, trash, Reminder->Normal, Done/Create, Player change and manual override.

Keep current `plays` state optimized for product use while `play_events` preserves learning/debug history.

## Notifications

Architect for future notification preferences/events, but actual email/SMS delivery is later. Do not couple Roller directly to Twilio/email providers in V1.

## Realtime and Offline

Realtime multi-device sync is later than Phase 1. Supabase's realtime capabilities may be used when introduced. Conflict policy can begin as last-change-wins with timestamps/history.

Offline operation is later; avoid schema/API choices that make later synchronization impossible, but do not introduce CRDT/offline complexity into V1.

## Security / RLS

All user-owned tables require Row Level Security policies before production. A user must not be able to access another user's Plays, Google connections, Roller history or private contact metadata unless an explicit future sharing relationship authorizes it.

Service-role operations must remain server-side only.