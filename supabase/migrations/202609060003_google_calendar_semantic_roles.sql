create type public.google_calendar_semantic_role as enum (
  'appointment',
  'event',
  'place',
  'play',
  'reminder',
  'done',
  'none'
);

alter table public.google_calendars
  add column semantic_role public.google_calendar_semantic_role
  not null default 'none';

comment on column public.google_calendars.semantic_role is
  'Persisted Carnival meaning for a Google calendar. Google calendar ID remains authoritative after classification.';

update public.google_calendars
set semantic_role = case lower(btrim(summary))
  when 'at_appointments' then 'appointment'::public.google_calendar_semantic_role
  when 'at_events' then 'event'::public.google_calendar_semantic_role
  when 'at_places' then 'place'::public.google_calendar_semantic_role
  when 'at_plays' then 'play'::public.google_calendar_semantic_role
  when 'at_reminders' then 'reminder'::public.google_calendar_semantic_role
  when 'at_done' then 'done'::public.google_calendar_semantic_role
  else 'none'::public.google_calendar_semantic_role
end
where semantic_role = 'none';
