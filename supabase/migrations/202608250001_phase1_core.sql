-- Carnival Life Phase 1 core schema.
--
-- This migration establishes the multi-user PlayHouse data foundation only.
-- Google OAuth credentials, provider tokens, legacy data, and Roller execution
-- are deliberately outside this slice.

create type public.play_status as enum ('open', 'done', 'trash');
create type public.play_type as enum ('normal', 'reminder');
create type public.play_source_type as enum ('user', 'gmail');
create type public.push_rule as enum ('everyday', 'weekdays', 'weekends');
create type public.play_relationship_type as enum ('next');
create type public.play_event_source as enum (
  'user',
  'roller',
  'gmail_sync',
  'calendar_sync',
  'migration',
  'system'
);
create type public.google_connection_status as enum (
  'connected',
  'disconnected',
  'error'
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  country_code text check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'Carnival profiles keyed one-to-one to Supabase Auth users.';
comment on column public.users.timezone is
  'IANA timezone name; validated by application settings until a timezone catalog is introduced.';

create table public.baskets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_system boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, slug),
  unique (id, owner_user_id)
);

comment on table public.baskets is
  'Explicit Play destinations. Cal is represented by a scheduled date, not a Basket row.';

create table public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  provider_subject text not null,
  email text,
  display_name text,
  avatar_url text,
  granted_scopes text[] not null default '{}',
  connection_status public.google_connection_status not null default 'connected',
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, provider_subject),
  unique (id, owner_user_id)
);

comment on table public.google_accounts is
  'Non-secret metadata for Google accounts connected to a Carnival user. OAuth tokens are not stored here.';

create table public.contact_references (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  google_account_id uuid,
  provider_resource_name text,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  email text,
  avatar_url text,
  is_self boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_user_id),
  unique (google_account_id, provider_resource_name),
  foreign key (google_account_id, owner_user_id)
    references public.google_accounts (id, owner_user_id)
    on delete cascade,
  check (
    (google_account_id is null and provider_resource_name is null)
    or (google_account_id is not null and provider_resource_name is not null)
  )
);

comment on table public.contact_references is
  'Stable Google People references with minimal cached display metadata; not an authoritative address book.';

create table public.plays (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 500),
  status public.play_status not null default 'open',
  play_type public.play_type not null default 'normal',
  source_type public.play_source_type not null default 'user',
  scheduled_date date,
  basket_id uuid,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  player_contact_id uuid,
  branch text,
  note text,
  url text,
  push_rule public.push_rule not null default 'everyday',
  place text,
  sort_order bigint not null default 0,
  legacy_mongo_id text,
  source_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(source_metadata) = 'object'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, owner_user_id),
  foreign key (basket_id, owner_user_id)
    references public.baskets (id, owner_user_id),
  foreign key (player_contact_id, owner_user_id)
    references public.contact_references (id, owner_user_id),
  constraint plays_exactly_one_placement
    check ((scheduled_date is not null) <> (basket_id is not null))
);

comment on table public.plays is
  'Materialized current state for PlayHouse Plays. History is stored separately in play_events.';
comment on constraint plays_exactly_one_placement on public.plays is
  'A Play is placed on exactly one real date or in one explicit Basket.';

create unique index plays_owner_legacy_mongo_id_key
  on public.plays (owner_user_id, legacy_mongo_id)
  where legacy_mongo_id is not null;

create table public.play_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  from_play_id uuid not null,
  to_play_id uuid not null,
  relationship_type public.play_relationship_type not null default 'next',
  created_at timestamptz not null default now(),
  foreign key (from_play_id, owner_user_id)
    references public.plays (id, owner_user_id)
    on delete cascade,
  foreign key (to_play_id, owner_user_id)
    references public.plays (id, owner_user_id)
    on delete cascade,
  unique (from_play_id, to_play_id, relationship_type),
  check (from_play_id <> to_play_id)
);

comment on table public.play_relationships is
  'Explicit next-Play relationships supporting Done/Create and later dependency models.';

create table public.play_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  play_id uuid not null,
  actor_user_id uuid references public.users (id) on delete set null,
  event_type text not null check (length(btrim(event_type)) between 1 and 100),
  source public.play_event_source not null default 'user',
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (play_id, owner_user_id)
    references public.plays (id, owner_user_id)
    on delete cascade
);

comment on table public.play_events is
  'Append-only behavioral history for debugging, analytics, and future learning.';

create table public.roller_settings (
  owner_user_id uuid primary key references public.users (id) on delete cascade,
  workday_start time not null default '09:00',
  workday_stop time not null default '17:00',
  scheduling_increment_minutes integer not null default 15 check (
    scheduling_increment_minutes in (5, 10, 15, 20, 30, 60)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (workday_start < workday_stop)
);

comment on table public.roller_settings is
  'Phase 1 settings foundation. Roller execution remains a later phase.';

create index baskets_owner_user_id_idx on public.baskets (owner_user_id);
create index google_accounts_owner_user_id_idx on public.google_accounts (owner_user_id);
create index contact_references_owner_user_id_idx on public.contact_references (owner_user_id);
create index plays_owner_user_id_idx on public.plays (owner_user_id);
create index plays_owner_date_order_idx
  on public.plays (owner_user_id, scheduled_date, sort_order)
  where status = 'open' and scheduled_date is not null;
create index plays_owner_basket_order_idx
  on public.plays (owner_user_id, basket_id, sort_order)
  where status = 'open' and basket_id is not null;
create index plays_owner_status_idx on public.plays (owner_user_id, status);
create index play_relationships_owner_user_id_idx
  on public.play_relationships (owner_user_id);
create index play_relationships_to_play_id_idx
  on public.play_relationships (to_play_id);
create index play_events_owner_user_id_idx on public.play_events (owner_user_id);
create index play_events_play_occurred_at_idx
  on public.play_events (play_id, occurred_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger baskets_set_updated_at
before update on public.baskets
for each row execute function public.set_updated_at();

create trigger google_accounts_set_updated_at
before update on public.google_accounts
for each row execute function public.set_updated_at();

create trigger contact_references_set_updated_at
before update on public.contact_references
for each row execute function public.set_updated_at();

create trigger plays_set_updated_at
before update on public.plays
for each row execute function public.set_updated_at();

create trigger roller_settings_set_updated_at
before update on public.roller_settings
for each row execute function public.set_updated_at();

create function public.seed_default_baskets(target_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.baskets (owner_user_id, name, slug, is_system, sort_order)
  values
    (target_user_id, 'Backlog', 'backlog', true, 10),
    (target_user_id, 'Soon', 'soon', true, 20),
    (target_user_id, 'Later', 'later', true, 30),
    (target_user_id, 'In Touch', 'in-touch', true, 40),
    (target_user_id, 'To Watch', 'to-watch', true, 50),
    (target_user_id, 'To Go', 'to-go', true, 60),
    (target_user_id, 'On The Way', 'on-the-way', true, 70)
  on conflict (owner_user_id, slug) do nothing;
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  perform public.seed_default_baskets(new.id);

  insert into public.roller_settings (owner_user_id)
  values (new.id)
  on conflict (owner_user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles/defaults if a development project already has Auth users
-- when this migration is first applied.
insert into public.users (id, display_name, avatar_url)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name'),
  raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;

select public.seed_default_baskets(id) from public.users;

insert into public.roller_settings (owner_user_id)
select id from public.users
on conflict (owner_user_id) do nothing;

alter table public.users enable row level security;
alter table public.baskets enable row level security;
alter table public.google_accounts enable row level security;
alter table public.contact_references enable row level security;
alter table public.plays enable row level security;
alter table public.play_relationships enable row level security;
alter table public.play_events enable row level security;
alter table public.roller_settings enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.baskets from anon, authenticated;
revoke all on table public.google_accounts from anon, authenticated;
revoke all on table public.contact_references from anon, authenticated;
revoke all on table public.plays from anon, authenticated;
revoke all on table public.play_relationships from anon, authenticated;
revoke all on table public.play_events from anon, authenticated;
revoke all on table public.roller_settings from anon, authenticated;

grant select, update on table public.users to authenticated;
grant select, insert, update, delete on table public.baskets to authenticated;
grant select, insert, update, delete on table public.google_accounts to authenticated;
grant select, insert, update, delete on table public.contact_references to authenticated;
grant select, insert, update on table public.plays to authenticated;
grant select, insert, update, delete on table public.play_relationships to authenticated;
grant select, insert on table public.play_events to authenticated;
grant select, insert, update on table public.roller_settings to authenticated;

create policy users_select_own
on public.users for select
to authenticated
using ((select auth.uid()) = id);

create policy users_update_own
on public.users for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy baskets_select_own
on public.baskets for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy baskets_insert_own
on public.baskets for insert
to authenticated
with check (
  (select auth.uid()) = owner_user_id
  and not is_system
);

create policy baskets_update_own
on public.baskets for update
to authenticated
using (
  (select auth.uid()) = owner_user_id
  and not is_system
)
with check (
  (select auth.uid()) = owner_user_id
  and not is_system
);

create policy baskets_delete_own
on public.baskets for delete
to authenticated
using (
  (select auth.uid()) = owner_user_id
  and not is_system
);

create policy google_accounts_select_own
on public.google_accounts for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy google_accounts_insert_own
on public.google_accounts for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy google_accounts_update_own
on public.google_accounts for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create policy google_accounts_delete_own
on public.google_accounts for delete
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy contact_references_select_own
on public.contact_references for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy contact_references_insert_own
on public.contact_references for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy contact_references_update_own
on public.contact_references for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create policy contact_references_delete_own
on public.contact_references for delete
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy plays_select_own
on public.plays for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy plays_insert_own
on public.plays for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy plays_update_own
on public.plays for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create policy play_relationships_select_own
on public.play_relationships for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy play_relationships_insert_own
on public.play_relationships for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy play_relationships_update_own
on public.play_relationships for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create policy play_relationships_delete_own
on public.play_relationships for delete
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy play_events_select_own
on public.play_events for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy play_events_insert_own
on public.play_events for insert
to authenticated
with check (
  (select auth.uid()) = owner_user_id
  and (actor_user_id is null or actor_user_id = (select auth.uid()))
);

create policy roller_settings_select_own
on public.roller_settings for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy roller_settings_insert_own
on public.roller_settings for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy roller_settings_update_own
on public.roller_settings for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.seed_default_baskets(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
