create table public.slack_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  team_id text not null check (length(btrim(team_id)) > 0),
  team_name text not null check (length(btrim(team_name)) > 0),
  slack_user_id text not null check (length(btrim(slack_user_id)) > 0),
  granted_scopes text[] not null default '{}',
  connection_status public.google_connection_status not null default 'connected',
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, team_id),
  unique (id, owner_user_id)
);

comment on table public.slack_connections is
  'Non-secret Slack workspace and user connection metadata. OAuth tokens are stored in the private schema.';

create index slack_connections_owner_user_id_idx
  on public.slack_connections (owner_user_id);

create trigger slack_connections_set_updated_at
before update on public.slack_connections
for each row execute function public.set_updated_at();

alter table public.slack_connections enable row level security;
revoke all on table public.slack_connections from anon, authenticated;
grant select, insert, update, delete on table public.slack_connections to authenticated;

create policy slack_connections_select_own
on public.slack_connections for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy slack_connections_insert_own
on public.slack_connections for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy slack_connections_update_own
on public.slack_connections for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create policy slack_connections_delete_own
on public.slack_connections for delete
to authenticated
using ((select auth.uid()) = owner_user_id);

create table private.slack_connection_credentials (
  slack_connection_id uuid primary key
    references public.slack_connections (id) on delete cascade,
  encrypted_access_token text not null check (length(encrypted_access_token) > 0),
  encryption_iv text not null check (length(encryption_iv) > 0),
  encryption_version smallint not null default 1 check (encryption_version = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.slack_connection_credentials is
  'Server-only encrypted Slack user OAuth tokens; unavailable through the browser-facing Data API.';

alter table private.slack_connection_credentials enable row level security;
revoke all on table private.slack_connection_credentials from public, anon, authenticated;

create or replace function public.store_slack_connection_credential(
  p_slack_connection_id uuid,
  p_owner_user_id uuid,
  p_encrypted_access_token text,
  p_encryption_iv text,
  p_encryption_version smallint default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.slack_connections
    where id = p_slack_connection_id and owner_user_id = p_owner_user_id
  ) then
    raise exception 'Slack connection does not belong to the specified owner.'
      using errcode = '42501';
  end if;

  insert into private.slack_connection_credentials (
    slack_connection_id, encrypted_access_token, encryption_iv, encryption_version
  ) values (
    p_slack_connection_id, p_encrypted_access_token, p_encryption_iv, p_encryption_version
  )
  on conflict (slack_connection_id) do update
  set encrypted_access_token = excluded.encrypted_access_token,
      encryption_iv = excluded.encryption_iv,
      encryption_version = excluded.encryption_version,
      updated_at = now();
end;
$$;

create or replace function public.get_slack_connection_credential(
  p_slack_connection_id uuid,
  p_owner_user_id uuid
)
returns table (
  encrypted_access_token text,
  encryption_iv text,
  encryption_version smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select credential.encrypted_access_token,
         credential.encryption_iv,
         credential.encryption_version
  from private.slack_connection_credentials credential
  join public.slack_connections connection
    on connection.id = credential.slack_connection_id
  where connection.id = p_slack_connection_id
    and connection.owner_user_id = p_owner_user_id;
$$;

revoke all on function public.store_slack_connection_credential(uuid, uuid, text, text, smallint)
  from public, anon, authenticated;
revoke all on function public.get_slack_connection_credential(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.store_slack_connection_credential(uuid, uuid, text, text, smallint)
  to service_role;
grant execute on function public.get_slack_connection_credential(uuid, uuid)
  to service_role;
