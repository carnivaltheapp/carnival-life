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

## Version 1 behavior

- Component navigation and All Features view.
- Search across title, description, and notes.
- Status and priority filtering, combined with component/search filters.
- A table containing feature title/description, component, status, priority, sequence,
  and actions.
- Create, edit, confirmed delete, optional manual sequence, notes, and multiple simple
  dependencies.
- Lower sequence values render first; unsequenced records render afterward.
- Responsive layout that preserves the approved desktop table design.

Version 1 intentionally excludes automatic sequencing, graphs, Kanban, AI behavior,
GitHub synchronization, assignments, sprints, notifications, comments, and attachments.

## Data and ownership

Operational records use the existing Carnival MongoDB connection and database:

- `carnival_development_features` stores owner-scoped roadmap records.
- `carnival_development_console_meta` records the one-time demo seed version per owner.

Every feature has a stable UUID, owner scope, title, description, component, status,
priority, optional sequence, dependency feature IDs, notes, and created/updated times.
Indexes enforce owner/feature identity and support sequence and filter reads. Deletes also
remove the deleted ID from remaining dependency lists for the same owner.

The initial sample records are explicitly marked as demo data in Mongo and in their notes.
They are inserted once per owner and can be edited or removed without being recreated.
They are examples, not approved Carnival requirements.

## API

Authenticated, owner-scoped JSON endpoints are available for machine access:

- `GET /api/development/features`
- `POST /api/development/features`
- `GET /api/development/features/{featureId}`
- `PATCH /api/development/features/{featureId}`
- `DELETE /api/development/features/{featureId}`

Responses use public camel-case feature objects and never return Mongo `_id` or
`owner_user_id`. Writes derive ownership from the authenticated Supabase session; clients
cannot supply or override it. Title and description are required, enums and lengths are
validated, dependency IDs must exist for the owner, and a feature cannot depend on itself.
The endpoints return private, no-store responses.

This structured API is the Version 1 machine-access boundary for future planning tools.
No AI functionality is part of this implementation.
