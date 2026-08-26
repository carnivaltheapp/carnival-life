# Carnival PlayHouse Specification

## Purpose

PlayHouse is Carnival Life's application for creating, organizing, viewing and managing Plays. It replaces the current AutoHotkey v1 prototype with a web-based, Vercel-deployed PWA while preserving the useful behavior of the prototype and replacing workaround UX with modern web interaction.

A Play is an item Carnival may schedule, hold, delegate, relate to another Play, or use as context for future planning.

## Core UI Model

The primary view shows Plays for the currently selected calendar date or Basket. If nothing is selected and the user clicks a calendar date or Basket, that destination becomes the displayed Play list.

Selection uses modern conventions:
- single click selects a Play;
- Shift-click selects a consecutive range;
- Ctrl-click on Windows / Cmd-click on macOS toggles individual selection;
- selected Plays can be dragged together;
- drag within the list reorders;
- drag onto a calendar date moves to that date;
- drag onto a Basket moves to that Basket.

The legacy click-right/click-left priority workaround and RePrioritize function are not carried forward. A clean sort/order field backs drag-and-drop ordering.

## Play Types and Email Dimension

V1 user-facing Play type is primarily:
- Normal — actionable work/activity that can consume scheduled time.
- Reminder — waiting for an external party/event; it does not consume scheduled duration while waiting.

Email is independent of Normal/Reminder. A Play can be an Email Play and Normal, or an Email Play and Reminder. Legacy `regarding=email` produces the `E` indicator in the first column.

Incoming starred email -> Normal Email Play.
Outgoing starred email -> Reminder Email Play.

Unstarring Gmail marks the corresponding Play Done. Marking the Play Done in PlayHouse unstarrs Gmail.

## Reminder and Delegation Workflow

A Reminder represents waiting for an external event or person. Its duration does not matter while it is a Reminder.

In V1, satisfaction of the external event is determined manually.

On the date assigned to a Reminder, when Roller runs, the Reminder automatically becomes a Normal Play, is inserted at the top of that day's Normal Plays, and is scheduled as part of that day.

Done/Create marks the current Play Done and creates/activates the next Play in the sequence. This supports delegated waiting flows such as waiting for a person to make an introduction and then proceeding to the next step.

Play relationships must therefore support an explicit next-Play/dependency relationship from Phase 1.

## Player

Player is a pointer to a Google Contact and may also point to the user themself.

The Player field should not primarily duplicate first name, last name, phone and email into the Play record. Those are contact data available from Google Contacts, with appropriate cached display metadata if required for performance/resilience.

Player interaction is contextual:
- Email Play: clicking Player shows Gmail conversations involving that person.
- Non-email Play: clicking Player opens the Google Contact.

Contact Topics are a future/extended contact concept. Topics are conversation subjects associated with a contact (for example kids, travel, finance, remodel, events, shopping). Each Topic may have a URL such as a Google Sheet, Google Doc or webpage.

## Fields

Core Play concepts include:
- title;
- placement: calendar date or Basket;
- type: Normal or Reminder;
- email/source dimension;
- Player/contact reference;
- Branch/category;
- note;
- URL;
- duration in minutes for Normal Plays;
- Push rule;
- Place/context;
- order/sort position;
- status/lifecycle;
- optional relationship to next/dependent Play;
- Google Calendar linkage where applicable;
- Gmail linkage where applicable;
- timestamps and legacy migration identifier.

Branch is currently a category for the Play. It belongs to the future Carnival Tree of Life but should remain a first-class reference/value now.

Place helps Roller understand where a Play takes place (examples include office, outside, any). The concept is retained, but its future taxonomy needs additional design.

## Baskets

V1 relevant destinations:
- Cal — normal calendar/date scheduling;
- Backlog — unscheduled Plays out of the way;
- Soon — unscheduled near-term Plays;
- Later — unscheduled longer-term Plays;
- In Touch — people/relationship Plays Roller may occasionally inject into the schedule;
- To Watch — programs/content the user may want to watch;
- To Go — places the user may want to visit; future Weekends/Roller can suggest them;
- On The Way — location-dependent errands that can be opportunistically combined with travel to another Play.

Other legacy baskets can be ignored initially.

Baskets are explicit database entities/placement states. Never encode a Basket as a fake far-future date in the new model.

## Change Actions

The legacy Change workflow allowed changing Play attributes such as rank/type, Push and Place. The web version should use modern editing/contextual controls rather than reproducing chained dropdowns literally.

Normal vs Reminder replaces the relevant legacy rank distinction. Other old rank values are unused and need not become first-class V1 UX.

## Search

Search is global across Plays and all dates by default. A plain search term should match the term in searchable Play fields.

Support Gmail-like query prefixes/operators for fields and filters, including concepts such as:
- player;
- branch;
- basket;
- open/done/trash status;
- Normal/Reminder;
- email source;
- date/date range.

Default scope is Plays. `in:anywhere` explicitly broadens search to other Carnival information as that information becomes available, including Contact Topics and related data.

## Desktop Context Browser

Desktop V1 supports Chrome.

Window A is a dedicated PlayHouse application/PWA and should remain on PlayHouse.

Window B is a normal Chrome browser. It is visible beside PlayHouse and can be resized. When nothing is selected, Window B defaults to Calendar. Selecting/activating contextual content can navigate Window B to:
- a Play URL;
- a Gmail thread;
- Gmail conversations with Player;
- Google Contact;
- Topic URL;
- other relevant web content.

Window B remains a normal browser with Back, Forward, Refresh and ordinary navigation. PlayHouse only controls contextual destination changes.

A lightweight Chrome extension or desktop adapter may be used for opening/restoring/positioning/navigating Window B because a pure PWA cannot reliably orchestrate an independent browser window. Business logic must not live in that extension.

## Mobile and Tablet

Mobile/tablet usability is a core requirement, not an afterthought.

Conceptually the user swipes between:
- PlayHouse;
- Calendar/context.

When nothing is selected, the second surface is Calendar. Selecting contextual content changes that surface where browser security allows. Gmail/Google pages that cannot be embedded may need to open externally while preserving an easy return to PlayHouse.

Eventually Carnival will render its own native calendar as this second surface.

## Settings

Settings include at least:
- workday start;
- workday stop;
- Roller scheduling increment (e.g. 15 or 30 minutes);
- timezone/country context;
- calendar participation/blocking settings as Google integration is added.

## History and Data Capture

From V1, preserve as much useful behavioral data as practical for later insights and AI learning. Maintain an append-oriented activity/event history rather than only overwriting the current Play record.

Capture meaningful events including:
- creation;
- edits;
- moves between dates/Baskets;
- reorder operations;
- scheduled times;
- actual completion time;
- Push events;
- Reminder -> Normal transitions;
- Player/Branch/type changes;
- Done/Trash;
- Done/Create;
- manual overrides;
- Roller decisions and reasons;
- source/device/session metadata where useful and privacy-appropriate.

V1 does not need to surface all of this history in the UI.

## Realtime, Offline and Conflict Policy

Realtime multi-device synchronization is later than Phase 1. The architecture should not prevent it.

When realtime editing is introduced, V1-level conflict behavior may be last-change-wins. Preserve timestamps/history so conflicts and behavior can be analyzed.

Offline operation is later and should not complicate initial V1.