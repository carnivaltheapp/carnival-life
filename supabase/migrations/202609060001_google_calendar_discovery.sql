create table public.google_calendars (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  google_account_id uuid not null,
  provider_calendar_id text not null check (length(btrim(provider_calendar_id)) > 0),
  summary text not null check (length(btrim(summary)) > 0),
  is_primary boolean not null default false,
  access_role text,
  time_zone text,
  is_blocking boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (google_account_id, provider_calendar_id),
  unique (id, owner_user_id),
  foreign key (google_account_id, owner_user_id)
    references public.google_accounts (id, owner_user_id)
    on delete cascade
);

comment on table public.google_calendars is
  'Minimal Google Calendar List metadata plus Carnival-owned Blocking/Ignored configuration.';
comment on column public.google_calendars.is_blocking is
  'Carnival availability configuration. False means Ignored; true means Blocking.';

create index google_calendars_owner_user_id_idx
  on public.google_calendars (owner_user_id);

create trigger google_calendars_set_updated_at
before update on public.google_calendars
for each row execute function public.set_updated_at();

alter table public.google_calendars enable row level security;

revoke all on table public.google_calendars from anon, authenticated;
grant select, insert, update on table public.google_calendars to authenticated;

create policy google_calendars_select_own
on public.google_calendars for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy google_calendars_insert_own
on public.google_calendars for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy google_calendars_update_own
on public.google_calendars for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);
