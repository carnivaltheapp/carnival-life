# Legacy PlayHouse Migration Specification

## Source

Legacy PlayHouse is an AutoHotkey v1 prototype backed by MongoDB Atlas. The existing code is behavioral reference only and is not to be ported architecturally.

MongoDB source discovered through Studio 3T:
- database: `restlandmark`
- collection: `tasks_task`

Historical/snapshot collections are not migration sources.

## Approved Migration Scope

The owner explicitly chose to migrate only active, non-deleted Plays dated August 25, 2026 forward. Legacy Basket records are included automatically because the prototype encodes Baskets using far-future dates.

Mongo filter:

```javascript
db.tasks_task.find({
  is_active: true,
  is_deleted: false,
  task_date: {
    $gte: ISODate("2026-08-25T00:00:00Z")
  }
})
```

At discovery time this returned **782 records**. Treat 782 as the migration control count for the snapshot taken from that filter. If the source changes before the snapshot is exported, record the new snapshot timestamp and count explicitly rather than silently assuming 782.

Older active records and null-date legacy records are intentionally excluded from this migration.

## Export Strategy

Prefer a private JSON/CSV snapshot over giving the new Carnival system direct MongoDB production access.

Requirements:
- preserve every legacy field in the raw private snapshot;
- never commit the snapshot to GitHub;
- keep MongoDB credentials out of the Carnival codebase;
- migration code may ignore obsolete fields, but the raw snapshot remains available for validation;
- migration should be repeatable/idempotent in development.

## Legacy Basket Encoding

The prototype uses fake dates to represent Baskets. Do not reproduce this design in Supabase.

Mapping:

| Legacy task_date | Carnival Basket |
|---|---|
| 2200-01-01 | On The Way |
| 2200-01-02 | To Go |
| 2300-01-01 | In Touch |
| 2400-01-01 | Soon |
| 2400-01-11 | Backlog |
| 2500-01-01 | Later |
| 2600-01-01 | To Watch |

During migration these values become explicit Basket placement and the fake date is not stored as the Play's real scheduled date.

## Legacy Field Interpretation

Known fields:

| Legacy field | Interpretation / migration treatment |
|---|---|
| `_id` | Preserve as `legacy_mongo_id` for traceability/idempotency. |
| `created_date` | Preserve when valid. |
| `updated_date` | Preserve when valid. |
| `is_deleted` | Source filter/lifecycle; only false is migrated. |
| `is_active` | Source filter/lifecycle; only true is migrated. |
| `user_id` | Legacy user identifier; map explicitly to the target Carnival user during migration, never assume globally meaningful IDs. |
| `action_type` | Play title. |
| `task_date` | Scheduled date unless it matches a legacy Basket sentinel. |
| `task_time` | Legacy field; inspect only if needed for a source record. |
| `task_type` | Legacy Play rank/type. Relevant current mapping includes `H` = Normal and `S` = Reminder. Old irrelevant values need not become new product concepts. |
| `duration` | Minutes for Normal Plays. Duration is irrelevant while a Play is a Reminder. |
| `url` | Associated Play URL. |
| `first`, `last`, `phone`, `ptype`, `email`, `etype` | Legacy duplicated contact display/contact data. Player in the new system is a Google Contact pointer; retain only what is needed as migration fallback/display metadata. |
| `contact_id` | Google Contact identifier; preserve for Player linkage. |
| `note` | Play note. |
| `priority_index` | Legacy ordering workaround. Convert into initial relative `sort_order`; do not expose legacy priority mechanics. |
| `push_type` | Roller Push rule (e.g. Everyday, Weekdays, Weekends). |
| `branch` | Branch/category. Preserve value for initial migration; future Tree of Life can normalize it. |
| `event_id` | Google Calendar event identifier; preserve. |
| `long_id` | The long Google Calendar identifier; Google Calendar has two identifiers in the legacy implementation. Preserve. |
| `thread_id` | Gmail thread identifier; preserve. |
| `message_id` | Gmail message identifier; preserve. |
| `last_id` | Last Gmail email/message ID known in the thread, used by legacy logic to determine whether the latest message is incoming or outgoing. Preserve for continuity. |
| `place` | Place dropdown/context such as office/outside/any. Preserve. |
| `regarding` | `user` is ordinary/default; `email` means Email Play (`E` indicator). |

Explicitly ignored legacy fields for the new implementation unless later source investigation proves otherwise:
- `old_task_id`
- `time_task`
- `is_pushed`
- `g_address`

Other prototype-only fields should not automatically become Supabase columns merely because they exist in MongoDB.

## Email vs Type

Email is an independent dimension, not a rank/type.

A migrated record with `regarding=email` is an Email Play. It may separately be Normal or Reminder according to `task_type`/current behavior.

Preserve Gmail identifiers so the new system can continue synchronization with existing threads rather than creating duplicates.

## Calendar Linkage

Preserve `event_id` and `long_id` so migrated Plays can continue referring to existing Google Calendar records where valid. Do not recreate all calendar events blindly.

## Validation

Every migration run should produce a validation report containing at least:
- source snapshot timestamp;
- source record count;
- successfully imported count;
- skipped/rejected count with reasons;
- Normal vs Reminder counts;
- Email Play count;
- counts by Basket;
- real calendar-date count;
- records with/without Player/contact ID;
- records with Google Calendar IDs;
- records with Gmail thread IDs;
- duplicate `legacy_mongo_id` detection;
- invalid/unparseable values.

For the original approved snapshot, successful + intentionally rejected rows must reconcile to the 782-record control total.

## Cutover

Do not delete or modify legacy MongoDB data during migration. The old system remains a read-only reference until V1 acceptance and cutover are complete.