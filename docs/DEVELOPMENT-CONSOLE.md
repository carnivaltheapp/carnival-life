# Carnival Development Console

## Purpose

The Development Console is Carnival Life's lightweight, structured roadmap. It records
upcoming features, priorities, intended sequence, and simple dependencies so humans and
future development tooling can review what should be built next. It is deliberately not a
general project-management, sprint, Kanban, or issue-tracking system.

## Application surface

The console is part of the existing PlayHouse Next.js deployment and is available at the
stable path `/development`. The current production URL is therefore
`https://carnival-playhouse.vercel.app/development`; changing the production domain does
not change the route. The route is server-rendered and supports direct browser entry and
refresh.

The Development Console is modular and does not depend on PlayHouse grid state. Its UI,
domain model, repository, and API are contained under the Development feature boundary.

## Component navigation

The left navigation is persisted and owner-scoped. `All Features` is a fixed system view;
it is not a component record and cannot be renamed, reordered, hidden, or deleted. The
subtle **Edit Components** control opens the component manager, where an owner can add,
rename, reorder, choose a supported icon, hide/unhide, and safely delete components.
Each component row has a drag handle for optimistic vertical ordering, with an insertion
marker and immediate owner-scoped MongoDB persistence. Failed saves restore the prior
order and show an error. Hidden components remain draggable in the manager; `All Features`
is outside the persisted component list and stays fixed at the top.

Hidden components remain in MongoDB and retain their assigned features, but do not appear
in normal navigation or as choices for new features. When editing a feature already assigned
to a hidden component, that current assignment remains visible and valid. Deleting an empty
component requires confirmation. Deleting a component that owns features first reports the
feature count and requires a destination component; the repository moves those owner-scoped
features before deleting the source component.

## Current behavior

- Component navigation and All Features view.
- Drag handles reorder roadmap features vertically and persist one canonical global sequence.
- Dragging a feature onto a visible sidebar component reassigns it without changing priority.
- Search across title, description, and notes.
- Status and priority filtering, combined with component/search filters.
- A table containing feature title/description, component, status, priority, sequence,
  and actions.
- Create, edit, confirmed delete, optional manual sequence, notes, and multiple simple
  dependencies.
- Lower sequence values render first; unsequenced records render afterward.
- Responsive layout that preserves the approved desktop table design.

The displayed order is the global development sequence. Reordering in a component view
reorders that component's features inside the global slots they already occupy, preserving
the relative order and positions of unrelated components. Search, status, and priority
filters disable vertical reordering because hidden records would make the result ambiguous;
the UI explains that those filters must be cleared. Component drops remain available.
The existing sequence field in the feature editor remains as a keyboard-accessible fallback.

Version 1 intentionally excludes automatic sequencing, graphs, Kanban, AI behavior,
GitHub synchronization, assignments, sprints, notifications, comments, and attachments.

## Data and ownership

Operational records use the existing Carnival MongoDB connection and database:

- `carnival_development_features` stores owner-scoped roadmap records.
- `carnival_development_components` stores owner-scoped navigation components.
- `carnival_development_console_meta` records one-time component and demo seed versions per owner.

Each component has a stable UUID (`component_id`), owner scope, name, normalized name key,
icon identifier, numeric sort order, hidden flag, and created/updated times. Unique indexes
enforce owner-scoped component identity and component names.

Every feature has a stable UUID, owner scope, title, description, stable `component_id`,
permanent owner-scoped human reference (`CF-001`, `CF-002`, ...),
compatibility component-name snapshot, status,
priority, optional sequence, dependency feature IDs, notes, and created/updated times.
Indexes enforce owner/feature identity and support sequence and filter reads. Deletes also
remove the deleted ID from remaining dependency lists for the same owner.

The component seed preserves the exact marker-134 names and order with deterministic stable
IDs. On first load for each owner, it upserts those components and backfills legacy feature
records that only contain a component name. The compatibility name remains on feature
documents so older readers keep working, while all new writes use the stable component ID.
The migration is owner-scoped, idempotent, and recorded only after backfill completes.

The initial sample records are explicitly marked as demo data in Mongo and in their notes.
They are inserted once per owner and can be edited or removed without being recreated.
They are examples, not approved Carnival requirements.

Existing features receive `CF-###` references deterministically by creation time (then
existing sequence and stable UUID as tie-breakers) without changing development sequence.
New references come from an atomic owner-scoped counter in
`carnival_development_console_meta`; the feature collection also has a unique owner/reference
index. Edits, component moves, and reorders never write the reference, and deletion never
decrements the counter, so a reference is permanent and never reused.

## API

Authenticated, owner-scoped JSON endpoints are available for machine access:

- `GET /api/development/features`
- `POST /api/development/features`
- `GET /api/development/features/{featureId}`
- `PATCH /api/development/features/{featureId}`
- `DELETE /api/development/features/{featureId}`
- `PATCH /api/development/features/reorder`
- `PATCH /api/development/features/{featureId}/component`
- `GET /api/development/components`
- `POST /api/development/components`
- `GET /api/development/components/{componentId}`
- `PATCH /api/development/components/{componentId}`
- `DELETE /api/development/components/{componentId}`
- `PATCH /api/development/components/reorder`

Responses use public camel-case feature objects and never return Mongo `_id` or
`owner_user_id`. Writes derive ownership from the authenticated Supabase session; clients
cannot supply or override it. Title and description are required, enums and lengths are
validated, dependency IDs must exist for the owner, and a feature cannot depend on itself.
The endpoints return private, no-store responses. Component deletion returns HTTP 409 with
`component_in_use` and an owner-scoped feature count when a move destination is required.
The reorder endpoint accepts the complete unique component-ID set so another owner's
component can never be injected into the order.

Feature reorder accepts the complete owner feature-ID set, validates that exact set inside
a MongoDB transaction, and bulk-writes contiguous sequence values. Component reassignment
is a targeted owner-scoped update of only the stable component ID/name snapshot. The client
updates optimistically and restores its prior state if either operation fails.

This structured API is the Version 1 machine-access boundary for future planning tools.
No AI functionality is part of this implementation.

## Read-only machine roadmap API

Authorized development tools can read the current MongoDB roadmap without browser-session
authentication:

- `GET /api/development/roadmap`
- `GET /api/development/roadmap/CF-###`
- `GET /api/development/roadmap/schema`

Send `Authorization: Bearer <token>`, where the server-only token is configured as
`CARNIVAL_ROADMAP_READ_TOKEN`. The token should be generated as a cryptographically strong
secret of at least 32 characters, must never use a `NEXT_PUBLIC_` prefix, and must be stored
in Vercel Production/Preview environment configuration rather than Git. Missing, malformed,
or incorrect credentials return HTTP 401. The machine routes export GET only; the token
cannot authorize feature/component writes, deletion, reordering, or reassignment.

The unfiltered roadmap response contains `components`, canonical `features`, explicit
`dependencies`, and `globalSequence`. Feature objects include both internal `id` and the
canonical human `featureId`, plus title, description, component data, status, priority,
sequence, dependencies, notes, and timestamps. Dependency objects carry internal IDs and
`CF-###` references. Hidden components are included. Supported convenience filters are
`component`, `status`, `priority`, and case-insensitive `q`; for example:

```text
GET /api/development/roadmap?q=CF-014
GET /api/development/roadmap?component=Roller&status=Planned
GET /api/development/roadmap/CF-014
```

Machine access fails closed if the deployment contains more than one Development Console
owner, rather than combining owner data. A future multi-owner connector must bind separate
credentials to explicit owners.

The API is connector-ready, but an HTTP endpoint alone does not let ChatGPT call it. The
next integration step is to configure and test a Carnival ChatGPT connector/tool that sends
the bearer token from its secure credential store and exposes the roadmap and schema GET
operations. Do not claim ChatGPT access until that connector is installed, authenticated,
and successfully retrieves a `CF-###` record.
