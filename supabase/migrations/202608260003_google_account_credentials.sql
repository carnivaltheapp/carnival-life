create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.google_account_credentials (
  google_account_id uuid primary key
    references public.google_accounts (id) on delete cascade,
  encrypted_refresh_token text not null check (length(encrypted_refresh_token) > 0),
  encryption_iv text not null check (length(encryption_iv) > 0),
  encryption_version smallint not null default 1 check (encryption_version = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.google_account_credentials is
  'Server-only encrypted Google refresh tokens. This schema is not exposed by the Supabase Data API.';

alter table private.google_account_credentials enable row level security;
revoke all on table private.google_account_credentials from public, anon, authenticated;

create or replace function public.store_google_account_credential(
  p_google_account_id uuid,
  p_owner_user_id uuid,
  p_encrypted_refresh_token text,
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
    select 1
    from public.google_accounts
    where id = p_google_account_id
      and owner_user_id = p_owner_user_id
  ) then
    raise exception 'Google account does not belong to the specified owner.'
      using errcode = '42501';
  end if;

  insert into private.google_account_credentials (
    google_account_id,
    encrypted_refresh_token,
    encryption_iv,
    encryption_version
  )
  values (
    p_google_account_id,
    p_encrypted_refresh_token,
    p_encryption_iv,
    p_encryption_version
  )
  on conflict (google_account_id) do update
  set encrypted_refresh_token = excluded.encrypted_refresh_token,
      encryption_iv = excluded.encryption_iv,
      encryption_version = excluded.encryption_version,
      updated_at = now();
end;
$$;

create or replace function public.get_google_account_credential(
  p_google_account_id uuid,
  p_owner_user_id uuid
)
returns table (
  encrypted_refresh_token text,
  encryption_iv text,
  encryption_version smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    credentials.encrypted_refresh_token,
    credentials.encryption_iv,
    credentials.encryption_version
  from private.google_account_credentials as credentials
  join public.google_accounts as account
    on account.id = credentials.google_account_id
  where account.id = p_google_account_id
    and account.owner_user_id = p_owner_user_id;
$$;

revoke all on function public.store_google_account_credential(uuid, uuid, text, text, smallint)
  from public, anon, authenticated;
revoke all on function public.get_google_account_credential(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.store_google_account_credential(uuid, uuid, text, text, smallint)
  to service_role;
grant execute on function public.get_google_account_credential(uuid, uuid)
  to service_role;

comment on function public.store_google_account_credential(uuid, uuid, text, text, smallint) is
  'Service-role-only write boundary for encrypted Google refresh tokens.';
comment on function public.get_google_account_credential(uuid, uuid) is
  'Service-role-only read boundary for encrypted Google refresh tokens.';
