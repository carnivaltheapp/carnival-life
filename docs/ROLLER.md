# Carnival Roller Specification

## Purpose

Carnival Roller is the intelligent scheduling brain of Carnival Life. It turns Plays stored in Carnival into a realistic, evolving calendar of what the user should do next.

Roller navigates fixed constraints such as appointments, deadlines, travel/Places, holidays, Personal Time and emergencies while considering Play dimensions, unfinished work, available time, location, travel and learned behavior. Long-term Roller balances Have Tos and Want Tos, can generate Constellation Plays, and optimizes for sustainable velocity and human togetherness rather than productivity alone.

V1 intentionally begins with a deterministic rule engine. AI Roller is a later phase built on the same data/events.

## Ownership Boundary

PlayHouse owns creating, organizing, editing and interacting with Plays.

Roller owns decisions about when Plays should occur, how unfinished Plays move forward, and which Carnival calendar receives scheduled output.

Roller is a separate Carnival application/subproject even if initially deployed using shared infrastructure.

## Execution Triggers

V1 Roller runs:
- automatically via cron at midnight in each user's timezone;
- manually through a Run Roller action in PlayHouse at any time.

It does not need to run after every Play edit in V1.

Each run plans/rebuilds a rolling seven-day schedule.

## Workday Settings

Per-user settings include:
- workday start;
- workday stop;
- scheduling increment, such as 15 or 30 minutes.

When building before the workday, scheduling begins at configured workday start.

When manually invoked during the workday, the first schedulable Normal begins at the next increment boundary. Example: at 10:14, a 15-minute increment starts at 10:15; a 30-minute increment starts at 10:30.

## Ordering and Duration

Normal Plays are scheduled into time slots using Duration.

Roller preserves the user's Play order established through drag/drop, subject to fixed calendar constraints.

Appointments are fixed constraints. Roller must skip over appointment time rather than overlapping Normal Plays.

If a Play cannot fit in the remaining eligible time, Roller applies its Push rule and preserves relative order as much as possible.

## Push Rules

V1 Push values:
- Everyday — next eligible day; also the default when no Push rule is set.
- Weekdays — Monday through Friday eligible.
- Weekends — Saturday and Sunday eligible.

Push also respects blocking constraints. A nominally eligible weekday is not eligible if it is blocked by holiday, Personal Time, travel/Places or other configured blocking constraints.

The future AI Roller may replace simple Push logic with learned scheduling decisions, but deterministic V1 behavior must remain explainable and testable.

## Reminders

A Reminder is waiting for an external event/person and does not consume scheduled duration.

When Roller runs on the Reminder's assigned date, it converts the Reminder to a Normal Play, inserts it at the top of that day's Normal Plays, and includes it in time-slot scheduling.

Whether the external party has actually completed the expected action is manually determined in V1.

Done/Create completes the waiting/action Play and activates/creates the next Play in its sequence.

## Calendar Constraints

### Appointments
Appointments originate in Google Calendar. Selected calendars are superimposed into a unified availability view. Users can configure calendars that should be visible/connected but ignored as Roller blocking constraints.

### Holidays
Roller should know applicable federal/national holidays based on the user's country. They should not require manual calendar entry in the target architecture.

### Personal Time
Carnival-native Personal Time is a whole-day override with:
- start date;
- end date;
- optional label.

Normal V1 scheduling skips these dates.

### Places / Travel
`AT_Places` is generally used for out-of-town excursions or international travel. A repeated event such as `Japan Cruise`, often at a nominal time such as 6 AM, identifies that the user is away during those dates rather than describing a detailed transportation itinerary.

In deterministic V1, Roller skips normal scheduling across applicable Places/travel days. Later Roller may become context-aware enough to schedule appropriate travel Want Tos or destination-specific Plays.

## Google Calendar Semantics

Current semantic calendars include:
- `AT_Appointments` — appointments/fixed constraints;
- `AT_plays` — scheduled Normal Plays;
- `AT_Reminders` — Reminder items represented as all-day events;
- `AT_done` — completed Plays/history;
- `AT_Places` — travel/location periods;
- `AT_Events` — shared event details such as concerts, potentially shared with other people.

Roller determines the appropriate semantic calendar rather than requiring the user to select a single write calendar.

Calendar layers can be superimposed and use different colors to communicate rank/semantic type.

Long term, Google Calendar remains a headless backend while Carnival renders a native combined PlayHouse/Calendar UX.

## Multiple Google Accounts

A Carnival user may connect multiple Google accounts.

Roller combines blocking availability from all configured participating calendars/accounts. Example: a personal dentist appointment and a work meeting both block the same user's schedule.

Users can configure calendars that Roller ignores for blocking purposes.

## Explainability and History

Every deterministic Roller decision should be explainable and logged where practical. Examples:
- moved to Wednesday because Tuesday was full and Push=Weekdays;
- skipped Friday because Personal Time was active;
- placed after an appointment because the earlier interval was too short;
- Reminder converted to Normal because its due date was reached.

Store structured decision inputs/reasons, not only human-readable strings, so later analytics and AI training can use them.

## Future AI Roller

Future Roller should be able to consider:
- mood and environmental context;
- character/personality type established at onboarding;
- learned behavior from Play processing and completion history;
- actual vs estimated duration;
- time-of-day patterns;
- location and travel opportunities;
- unfinished work;
- Have To vs Want To balance;
- social opportunities;
- Constellation Plays;
- feedback from completed experiences.

Fundamental long-term rule: optimize for human togetherness every chance we get.