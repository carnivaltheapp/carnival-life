begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(12);

select has_table('public', 'google_calendars', 'Google calendars table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.google_calendars'::regclass),
  'RLS is enabled on Google calendars'
);
select policies_are(
  'public',
  'google_calendars',
  array[
    'google_calendars_insert_own',
    'google_calendars_select_own',
    'google_calendars_update_own'
  ],
  'Google calendars expose only owner-scoped policies'
);
select col_type_is(
  'public',
  'google_calendars',
  'semantic_role',
  'google_calendar_semantic_role',
  'Google calendars persist a constrained semantic role'
);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-000000000011'::uuid, 'calendar-one@example.test'),
  ('00000000-0000-4000-8000-000000000012'::uuid, 'calendar-two@example.test');

insert into public.google_accounts (id, owner_user_id, provider_subject)
values
  (
    '00000000-0000-4000-8000-000000000021'::uuid,
    '00000000-0000-4000-8000-000000000011'::uuid,
    'provider-one'
  ),
  (
    '00000000-0000-4000-8000-000000000022'::uuid,
    '00000000-0000-4000-8000-000000000012'::uuid,
    'provider-two'
  ),
  (
    '00000000-0000-4000-8000-000000000023'::uuid,
    '00000000-0000-4000-8000-000000000011'::uuid,
    'provider-one-secondary'
  );

insert into public.google_calendars (
  id, owner_user_id, google_account_id, provider_calendar_id, summary, semantic_role
)
values
  (
    '00000000-0000-4000-8000-000000000031'::uuid,
    '00000000-0000-4000-8000-000000000011'::uuid,
    '00000000-0000-4000-8000-000000000021'::uuid,
    'calendar-one',
    'First calendar',
    'none'
  ),
  (
    '00000000-0000-4000-8000-000000000032'::uuid,
    '00000000-0000-4000-8000-000000000012'::uuid,
    '00000000-0000-4000-8000-000000000022'::uuid,
    'calendar-two',
    'Second calendar',
    'none'
  ),
  (
    '00000000-0000-4000-8000-000000000033'::uuid,
    '00000000-0000-4000-8000-000000000011'::uuid,
    '00000000-0000-4000-8000-000000000023'::uuid,
    'calendar-one',
    'Same provider ID on another connected account',
    'place'
  );

select is(
  (
    select semantic_role from public.google_calendars
    where id = '00000000-0000-4000-8000-000000000031'::uuid
  ),
  'none'::public.google_calendar_semantic_role,
  'Ordinary calendars default to no semantic role'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000011',
  true
);

select is(
  (select count(*) from public.google_calendars),
  2::bigint,
  'An authenticated user sees only their calendars'
);
select is(
  (select count(distinct google_account_id) from public.google_calendars),
  2::bigint,
  'Calendar identity remains scoped to each connected Google account'
);
select is(
  (
    select is_blocking from public.google_calendars
    where id = '00000000-0000-4000-8000-000000000031'::uuid
  ),
  false,
  'New calendars default to Ignored at the database boundary'
);
select lives_ok(
  $$
    update public.google_calendars
    set is_blocking = true,
        semantic_role = 'appointment'
    where id = '00000000-0000-4000-8000-000000000031'::uuid
  $$,
  'An owner can persist Blocking configuration'
);
select is(
  (
    select is_blocking from public.google_calendars
    where id = '00000000-0000-4000-8000-000000000031'::uuid
  ),
  true,
  'Blocking configuration persists'
);
select is(
  (
    select array_agg(semantic_role::text order by google_account_id)
    from public.google_calendars
    where provider_calendar_id = 'calendar-one'
  ),
  array['appointment', 'place'],
  'Semantic assignments remain scoped to each connected account'
);
select throws_ok(
  $$
    insert into public.google_calendars (
      owner_user_id, google_account_id, provider_calendar_id, summary
    ) values (
      '00000000-0000-4000-8000-000000000012'::uuid,
      '00000000-0000-4000-8000-000000000022'::uuid,
      'cross-owner',
      'Cross owner calendar'
    )
  $$,
  '42501',
  null,
  'RLS rejects another owner''s calendar configuration'
);

select * from finish();
rollback;
