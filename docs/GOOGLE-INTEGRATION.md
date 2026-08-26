# Carnival Google Integration Specification

## Platform Setup

Carnival uses a dedicated Google Cloud project named `Carnival Life`.

Enabled APIs:
- Google Calendar API
- Gmail API
- Google People API

Google Auth Platform/OAuth application configuration has been initialized. Final Web OAuth client origins and redirect URIs should be created only after the actual local and Vercel application callback URLs are known.

The preferred long-term administrative identity is a `carnivaltheapp.com` Google Workspace account rather than a personal/public Gmail or Blue Field Law identity.

## Authentication and Connected Accounts

Carnival users sign in using Google OAuth.

A Carnival user can connect multiple Google accounts. Authentication identity and connected Google data accounts should therefore not be modeled as a single inseparable account row.

Each connected Google account needs its own:
- provider account identity;
- granted scopes;
- secure token/refresh-token storage;
- sync cursors/state;
- connected/disconnected/error status;
- calendar configuration.

## Google Contacts / People

Player is a pointer to a Google Contact, including the possibility of the user themself.

Use Google People API for contact lookup/selection and contact opening behavior.

Do not make duplicated first/last/email/phone values on every Play the canonical contact record. Cached display values are acceptable for resilience/performance, but Google Contact identity remains the Player reference in V1.

Contact Topics are Carnival-owned custom contact metadata, not necessarily Google-native fields. A Topic can have a URL. This is designed for future use and broader `in:anywhere` search.

## Gmail

### Import

A starred Gmail thread represents an active Email Play.

When a new starred email is imported:
- if the contact can be resolved, populate Player;
- latest incoming email -> Normal Email Play;
- latest outgoing email -> Reminder Email Play.

Legacy `last_id` represents the last known Gmail message ID in a thread and helps determine incoming/outgoing state. Preserve legacy Gmail IDs during migration.

Ideal future behavior is event-driven notification from Gmail when relevant mail arrives rather than constant polling. V1 integration may stage this based on implementation complexity.

### Completion Synchronization

Gmail and PlayHouse synchronize completion in both directions:
- Gmail thread unstarred -> corresponding Email Play becomes Done;
- Email Play marked Done in PlayHouse -> unstar corresponding Gmail thread.

Implement idempotency/sync-origin safeguards so one side's update does not create an endless synchronization loop.

### Player Action

For an Email Play, clicking Player opens/shows Gmail conversations with that person in the context browser/surface.

Double-clicking/opening an Email Play opens the relevant Gmail thread.

## Google Calendar

### Source of Appointments

Appointments originate in Google Calendar, not PlayHouse. They are imported/synchronized as fixed scheduling constraints.

Users may connect multiple Google accounts. Roller combines availability across configured blocking calendars from all accounts.

Users can configure individual calendars as ignored by Roller so shared, birthday, informational or other calendars do not necessarily block scheduling.

### Semantic Carnival Calendars

Current calendar semantics:
- `AT_Appointments` — appointments/fixed constraints;
- `AT_plays` — Normal scheduled Plays;
- `AT_Reminders` — Reminder Plays represented as all-day items;
- `AT_done` — completed Plays;
- `AT_Places` — out-of-town/international travel/location context;
- `AT_Events` — event details such as concerts, including events shared with other people.

Roller determines the appropriate semantic calendar for output. The user should not have to choose a single global write calendar.

The UI may superimpose calendars, using calendar/rank semantics and colors to distinguish layers.

### Identifiers

Legacy Plays can contain:
- `event_id` — Google Calendar event identifier;
- `long_id` — the corresponding long Google Calendar identifier used by the legacy implementation.

Preserve both during migration to maintain continuity and avoid unnecessary duplicate events.

## Places / Travel

`AT_Places` usually represents out-of-town excursions or international travel. The same event may be repeated on each applicable date at a nominal time (for example 6 AM) with a title such as `Japan Cruise`.

This communicates location/travel context rather than a detailed transportation itinerary.

Deterministic Roller V1 treats applicable Places/travel dates as blocked for normal scheduling. Future AI Roller can use destination/timezone/location context more intelligently.

## Future Native Calendar

Google Calendar should not be treated as Carnival's permanent calendar user interface.

Future Carnival will provide a native combined PlayHouse/Calendar UX on desktop and mobile while Google Calendar remains a headless synchronization/backend system.

Therefore, keep Google API adapters separate from PlayHouse UI components and from Roller's scheduling domain logic.