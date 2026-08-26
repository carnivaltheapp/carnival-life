begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(25);

select has_table('public', 'users', 'Carnival users table exists');
select has_table('public', 'baskets', 'Baskets table exists');
select has_table('public', 'google_accounts', 'Google account metadata table exists');
select has_table('public', 'contact_references', 'Contact references table exists');
select has_table('public', 'plays', 'Plays table exists');
select has_table('public', 'play_relationships', 'Play relationships table exists');
select has_table('public', 'play_events', 'Play event history table exists');
select has_table('public', 'roller_settings', 'Roller settings table exists');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.users'::regclass),
  'RLS is enabled on users'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.baskets'::regclass),
  'RLS is enabled on baskets'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.google_accounts'::regclass),
  'RLS is enabled on google_accounts'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.contact_references'::regclass),
  'RLS is enabled on contact_references'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.plays'::regclass),
  'RLS is enabled on plays'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.play_relationships'::regclass),
  'RLS is enabled on play_relationships'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.play_events'::regclass),
  'RLS is enabled on play_events'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.roller_settings'::regclass),
  'RLS is enabled on roller_settings'
);

select has_constraint(
  'public',
  'plays',
  'plays_exactly_one_placement',
  'Plays enforce exactly one placement'
);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'phase1-one@example.test',
  '{"full_name":"Phase One"}'::jsonb
);

select is(
  (
    select count(*)
    from public.users
    where id = '00000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'Auth trigger creates a Carnival profile'
);
select is(
  (
    select count(*)
    from public.baskets
    where owner_user_id = '00000000-0000-4000-8000-000000000001'::uuid
  ),
  7::bigint,
  'Auth trigger creates seven default Baskets'
);
select is(
  (
    select count(*)
    from public.roller_settings
    where owner_user_id = '00000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'Auth trigger creates default Roller settings'
);

select throws_ok(
  $$
    insert into public.plays (owner_user_id, title)
    values ('00000000-0000-4000-8000-000000000001'::uuid, 'Missing placement')
  $$,
  '23514',
  null,
  'A Play without a placement is rejected'
);

select lives_ok(
  $$
    insert into public.plays (owner_user_id, title, scheduled_date)
    values (
      '00000000-0000-4000-8000-000000000001'::uuid,
      'A dated Play',
      '2026-08-25'::date
    )
  $$,
  'A Play with a real date is accepted'
);

select throws_ok(
  $$
    insert into public.plays (
      owner_user_id,
      title,
      scheduled_date,
      basket_id
    )
    select
      owner_user_id,
      'Double placement',
      '2026-08-25'::date,
      id
    from public.baskets
    where owner_user_id = '00000000-0000-4000-8000-000000000001'::uuid
    limit 1
  $$,
  '23514',
  null,
  'A Play with both date and Basket is rejected'
);

select policies_are(
  'public',
  'plays',
  array['plays_insert_own', 'plays_select_own', 'plays_update_own'],
  'Plays expose only select, insert, and update ownership policies'
);

select policies_are(
  'public',
  'play_events',
  array['play_events_insert_own', 'play_events_select_own'],
  'Play events are append-only for authenticated clients'
);

select * from finish();
rollback;
