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

Each permanent feature reference also has a public, read-only sharing page at
`/development/CF-###`. The page is server-rendered directly from the current MongoDB record,
requires no Carnival session, and exposes only that known feature's public roadmap fields.
It has no list, search, edit, owner, or internal-ID surface; dependencies are reduced to
their `CF-###` references and titles. Unknown references return 404, and every sharing page
declares `noindex, nofollow`. The Console's copy control copies the current-origin sharing
URL (for example `https://carnival-playhouse.vercel.app/development/CF-010`) rather than only
the feature reference.

Components have equivalent current-name sharing URLs such as `/development/gmail`,
`/development/playhouse`, and `/development/roller`. A component page is server-rendered
from the same MongoDB records and contains only that component's feature cards, including
full Notes and public dependency references. Component slugs are derived from the current
persisted name rather than stored as identity, so renaming updates the URL while the stable
component UUID and feature relationships remain unchanged. Unknown or ambiguous slugs return
404. These pages are also public read-only and `noindex, nofollow`; they expose no owner data,
internal IDs, navigation, or editing controls.

The Development Console is modular and does not depend on PlayHouse grid state. Its UI,
domain model, repository, and API are contained under the Development feature boundary.

The root `/development` route is session-aware. Authenticated owners receive the complete
interactive Console described below. Without a Carnival session, the same URL server-renders a
public read-only **All Features** roadmap directly from current MongoDB records. That public view
contains every feature's CF reference, title, description, component, status, priority, sequence,
public dependency references/titles, and full Notes. It contains no owner/internal IDs or create,
edit, delete, drag, or component-management controls and declares `noindex, nofollow`.

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
- Notes support unrestricted long-form product/development documentation. The editor grows
  with its content up to a viewport-safe limit, preserves paragraphs, and keeps Notes out of
  the compact roadmap table; full text remains available in the editor and machine API.
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

## ChatGPT roadmap MCP integration

Carnival exposes a Streamable HTTP MCP server at:

```text
https://carnival-playhouse.vercel.app/api/development/mcp
```

It reads the current owner-scoped MongoDB collections on every tool call; it does not export,
cache, or copy the roadmap into ChatGPT. Read tools remain:

- `get_feature(featureId)` — direct, case-insensitive `CF-###` lookup with dependencies and
  previous/next canonical-sequence context.
- `search_features(query)` — searches CF ID, title, description, component, and full Notes.
- `list_features(component?, status?, priority?)` — filtered ordered feature listing.
- `list_components()` — stable component ID, name, sort order, and hidden state.
- `get_roadmap()` — complete ordered roadmap, dependency graph, and components.

Read tools advertise read-only, non-destructive, closed-world annotations. The MCP also exposes
these narrowly scoped mutation tools:

- `update_feature(featureId, changes)` — updates only title, description, component, status,
  priority, or Notes.
- `reorder_feature(featureId, sequence)` — uses the canonical global exact-set reorder path.
- `add_dependency(featureId, dependencyFeatureId)` and
  `remove_dependency(featureId, dependencyFeatureId)` — validate both permanent CF references.
- `append_notes(featureId, text)` — appends a new paragraph without replacing existing Notes.

Write tools require owner-bound OAuth with `roadmap:write`, return the updated feature, and are
described for use only after an explicit user mutation request. There is no create, feature delete,
component delete, or arbitrary database tool. The legacy GET API remains protected by
`CARNIVAL_ROADMAP_READ_TOKEN`; that server-only token is also accepted for MCP Inspector and
automated contract testing, remains `roadmap:read` only, and cannot invoke write tools.

### Carnival-owned OAuth 2.1

Marker `P3-ROADMAP-MCP-141` temporarily made interactive MCP authentication depend on the
Supabase OAuth server. Marker `P3-CARNIVAL-OAUTH-142` corrects that architecture: Carnival is
now its own narrow OAuth 2.1 authorization server for roadmap access. Supabase does not issue
or validate MCP access tokens and is not advertised in MCP/OAuth discovery. The existing
Carnival browser session is reused only to identify the signed-in owner at consent time; this
does not create another user database or change existing application sign-in.

The Carnival issuer provides:

- `GET /.well-known/oauth-authorization-server` — authorization-server discovery.
- `GET /.well-known/oauth-protected-resource/api/development/mcp` — MCP resource metadata.
- `POST /api/oauth/register` — restricted dynamic registration for current ChatGPT callback
  URLs; clients are public and use no client secret.
- `GET /oauth/authorize` and `POST /api/oauth/authorize` — existing Carnival login plus the
  explicit scope-aware Allow/Cancel consent screen.
- `POST /api/oauth/token` — authorization-code exchange with mandatory PKCE S256.

Authorization codes expire after five minutes and are single-use. Access tokens expire after
15 minutes. Codes and tokens are cryptographically random; only SHA-256 hashes are stored in
dedicated MongoDB OAuth collections. Every exchange and MCP request validates the exact issuer,
registered redirect URI, client, `resource`/audience, expiration, and requested supported scopes.
`roadmap:read` authorizes only read tools; the separate `roadmap:write` scope is mandatory for
every mutation tool. Existing read-only grants and `CARNIVAL_ROADMAP_READ_TOKEN` never permit writes.

The OAuth implementation is a replaceable identity boundary. It returns the immutable current
Carnival owner ID to unchanged MCP tools; a future datastore/authentication migration therefore
does not require changing CF IDs, tool schemas, or ChatGPT-facing behavior.

Marker `P3-ROADMAP-MCP-CONNECT-143` corrects the first live ChatGPT connection defect found in
142. The resource endpoint formerly returned HTTP 401 before the MCP handshake, so ChatGPT could
discover OAuth and dynamically register but could not discover any tools or invoke one to trigger
the linking UI. Unauthenticated Streamable HTTP clients may now initialize and list the read-only
tool descriptors. Every descriptor declares `roadmap:read`; an unauthenticated tool call returns
the standard `_meta["mcp/www_authenticate"]` challenge without reading MongoDB. Invalid supplied
bearer tokens still receive HTTP 401. A validated token remains mandatory before any roadmap data
is loaded, so this protocol-discovery correction does not make roadmap records public.

Marker `P3-FEATURE-SHARE-144` adds the deliberately separate known-ID sharing surface described
above. It does not weaken the authenticated Console CRUD APIs, bearer-protected roadmap API, or
OAuth-protected MCP tools. Public pages perform a direct feature lookup and resolve only that
feature's dependencies; they never call Console seeding/backfill code or mutate roadmap data.

Marker `P3-COMPONENT-SHARE-145` extends the same sharing surface to component-name slugs.
Selecting a component in the authenticated Console updates browser history without reloading or
changing edit behavior, while the adjacent copy control provides its full current-origin public
URL. Back/forward history restores the in-place component filter. Public component requests use
the read-only server route and do not expose Console controls or other components' cards.

Marker `P3-ROADMAP-PUBLIC-146` makes the root `/development` URL the shareable All Features
equivalent. Authentication continues to select the unchanged interactive Console; signed-out
requests receive the server-rendered read-only roadmap. The public loader reads but never seeds,
backfills, or mutates Development Console data.

Marker `P3-ROADMAP-WRITE-147` adds owner-scoped, explicit-request-only MCP mutation tools and the
separate `roadmap:write` OAuth scope. Mutations reuse Development Console validation and Mongo
repository paths; canonical reorder remains exact-set/contiguous, dependencies reject missing,
self, and duplicate references, and Notes append with paragraph preservation. Public roadmap and
CF/component sharing routes remain read-only.

Marker `P3-ROADMAP-OAUTH-INSPECTOR-151` corrects the OAuth consent handoff. Consent is submitted by
POST, so its callback redirect uses HTTP 303 to produce the authorization protocol's required GET;
the former 307 repeated the POST at ChatGPT's callback and was rejected before token exchange.
Tool descriptors and runtime `mcp/www_authenticate` challenges are least-privilege: read tools ask
for `roadmap:read`, write tools ask for `roadmap:write`, and the consent text reflects the exact
requested scopes. Strict loopback-IP registration support allows the official MCP Inspector to
exercise the same PKCE flow without relaxing exact redirect matching at authorization or token
exchange. Marker 151 supersedes marker 148's over-broad combined descriptors and the initial
149/150 deployments of this callback correction.

Marker `P3-ROADMAP-OAUTH-REFRESH-154` makes normal OAuth expiration recoverable. Production
reconnect traces showed the expired MCP request receive `401`, complete discovery, and then stop at
dynamic registration while the authorization server still advertised and issued only the
authorization-code grant. Carnival now advertises and registers `refresh_token`, issues a hashed
30-day refresh credential with each 15-minute access credential, and rotates the refresh credential
on every use. Refreshes remain bound to the original client, owner, issuer, resource, and consented
scopes; they may narrow scopes but cannot add one. Roadmap tools and data are unchanged.

### One-time ChatGPT connection procedure

1. In ChatGPT Settings → Security and login, enable Developer mode.
2. In ChatGPT Plugins, add the production MCP URL above. ChatGPT discovers Carnival OAuth and
   dynamically registers its callback automatically.
3. When redirected to `/oauth/authorize`, sign into Carnival if necessary, then choose Allow
   for both `roadmap:read` and `roadmap:write` if you want write tools. An existing read-only
   connection must be refreshed or reconnected to grant the new scope.
4. Install the resulting personal plugin, open a new Work conversation, and ask
   `Can you see CF-010?`. Confirm ChatGPT calls `get_feature` and returns the live record.

Do not claim live ChatGPT access until step 4 has succeeded. Official ChatGPT MCP connections
cannot use arbitrary custom bearer secrets, so `CARNIVAL_ROADMAP_READ_TOKEN` remains an
optional server-to-server/testing capability rather than an interactive ChatGPT credential.

Marker `P3-CONTACT-GROUPS-155` implements CF-011 Contact Groups as Labels. A Play can now retain
multiple canonical Google Player references, including individual People resources and stable
Google Contact Group resources. Player search includes user-created labels with member counts;
groups expand against the live People API into a temporary, initially checked member list. Only
contact/group references are stored on the Play—expanded membership and checkbox state are never
persisted or written back to Google Contacts. Existing single-Player Plays remain compatible.

Marker `P3-RIGHT-SURFACE-RETRACTED-156` fixes the Chrome toolbar Aux/Misc toggle while the native
drawer is retracted. Native evidence showed the host correctly rejecting threshold-owner transfer
because no retract threshold is active in that state; the controller had incorrectly made that
expected condition fatal. Retracted switches now skip only the inactive transfer. Open-drawer
switches retain the acknowledged incoming-owner handoff, geometry, serialization, and safety rules.

Marker `P3-RIGHT-SURFACE-REUSE-157` prevents repeated Aux/Misc switching from accumulating Chrome
windows when a stored Aux runtime window ID is stale or temporarily missing. Before creating Aux,
the controller now rediscovers an existing window whose ordered tabs match the saved Aux session,
mirroring the established Misc recovery path. Closing Aux still clears its identity, and a new
window is created normally when no valid existing session match remains.

Marker `P3-GMAIL-SHIFT-CREATE-158` adds an explicit Gmail row-drop intent. A normal Gmail drag
continues linking or confirming replacement on the existing Headline/Reminder. Holding Shift at
drop uses the established Gmail Play creation and row-positioning path instead, leaving the target
Play unchanged and allowing the deliberate conversation link to coexist on multiple Plays.
