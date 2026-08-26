-- Explicit next-Play relationships and transactional Done/Create workflow.

create unique index play_relationships_one_next_per_source
  on public.play_relationships (from_play_id)
  where relationship_type = 'next';

create or replace function public.validate_next_play_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    old.owner_user_id is distinct from new.owner_user_id
    or old.from_play_id is distinct from new.from_play_id
    or old.relationship_type is distinct from new.relationship_type
  ) then
    raise exception using
      errcode = '23514',
      message = 'A next relationship source and owner cannot be changed.';
  end if;

  if new.from_play_id = new.to_play_id then
    raise exception using
      errcode = '23514',
      message = 'A Play cannot point to itself.';
  end if;

  if exists (
    with recursive next_path(play_id) as (
      select new.to_play_id
      union
      select relationship.to_play_id
      from public.play_relationships relationship
      join next_path path on relationship.from_play_id = path.play_id
      where relationship.owner_user_id = new.owner_user_id
        and relationship.relationship_type = 'next'
        and relationship.id <> new.id
    )
    select 1 from next_path where play_id = new.from_play_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'This next relationship would create a cycle.';
  end if;

  return new;
end;
$$;

create trigger play_relationships_validate_next
before insert or update on public.play_relationships
for each row execute function public.validate_next_play_relationship();

create or replace function public.append_next_relationship_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  event_owner_id uuid;
  event_play_id uuid;
  event_name text;
  event_payload jsonb;
  event_source public.play_event_source := 'system';
begin
  if actor_id is not null then
    event_source := 'user';
  end if;

  if tg_op = 'INSERT' then
    event_owner_id := new.owner_user_id;
    event_play_id := new.from_play_id;
    event_name := 'next_relationship_created';
    event_payload := jsonb_build_object(
      'relationship_id', new.id,
      'relationship_type', new.relationship_type,
      'before', null,
      'after', jsonb_build_object('next_play_id', new.to_play_id)
    );
  elsif tg_op = 'UPDATE' then
    event_owner_id := new.owner_user_id;
    event_play_id := new.from_play_id;
    event_name := 'next_relationship_changed';
    event_payload := jsonb_build_object(
      'relationship_id', new.id,
      'relationship_type', new.relationship_type,
      'before', jsonb_build_object('next_play_id', old.to_play_id),
      'after', jsonb_build_object('next_play_id', new.to_play_id)
    );
  else
    event_owner_id := old.owner_user_id;
    event_play_id := old.from_play_id;
    event_name := 'next_relationship_removed';
    event_payload := jsonb_build_object(
      'relationship_id', old.id,
      'relationship_type', old.relationship_type,
      'before', jsonb_build_object('next_play_id', old.to_play_id),
      'after', null
    );
  end if;

  if exists (
    select 1
    from public.plays
    where id = event_play_id and owner_user_id = event_owner_id
  ) then
    insert into public.play_events (
      owner_user_id,
      play_id,
      actor_user_id,
      event_type,
      source,
      payload
    ) values (
      event_owner_id,
      event_play_id,
      actor_id,
      event_name,
      event_source,
      event_payload
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger play_relationships_history_insert
after insert on public.play_relationships
for each row execute function public.append_next_relationship_event();

create trigger play_relationships_history_update
after update of to_play_id on public.play_relationships
for each row
when (old.to_play_id is distinct from new.to_play_id)
execute function public.append_next_relationship_event();

create trigger play_relationships_history_delete
after delete on public.play_relationships
for each row execute function public.append_next_relationship_event();

create or replace function public.set_next_play(
  p_from_play_id uuid,
  p_to_play_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  perform 1
  from public.plays
  where id = p_from_play_id
    and owner_user_id = actor_id
    and status = 'open'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'The source Play is unavailable.';
  end if;

  if p_to_play_id is null then
    delete from public.play_relationships
    where owner_user_id = actor_id
      and from_play_id = p_from_play_id
      and relationship_type = 'next';
    return;
  end if;

  if p_from_play_id = p_to_play_id then
    raise exception using errcode = '23514', message = 'A Play cannot point to itself.';
  end if;

  perform 1
  from public.plays
  where id = p_to_play_id and owner_user_id = actor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'The next Play is unavailable.';
  end if;

  insert into public.play_relationships (
    owner_user_id,
    from_play_id,
    to_play_id,
    relationship_type
  ) values (
    actor_id,
    p_from_play_id,
    p_to_play_id,
    'next'
  )
  on conflict (from_play_id) where relationship_type = 'next'
  do update set to_play_id = excluded.to_play_id;
end;
$$;

create or replace function public.done_create_existing(
  p_play_id uuid
)
returns table (
  next_play_id uuid,
  next_scheduled_date date,
  next_basket_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_play public.plays%rowtype;
  next_play public.plays%rowtype;
  next_relationship public.play_relationships%rowtype;
  previous_next_status public.play_status;
  workflow_id uuid := gen_random_uuid();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select * into current_play
  from public.plays
  where id = p_play_id and owner_user_id = actor_id
  for update;

  if not found or current_play.status <> 'open' then
    raise exception using errcode = 'P0002', message = 'The current Play is unavailable.';
  end if;

  select * into next_relationship
  from public.play_relationships
  where owner_user_id = actor_id
    and from_play_id = current_play.id
    and relationship_type = 'next'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'No next Play is linked.';
  end if;

  select * into next_play
  from public.plays
  where id = next_relationship.to_play_id and owner_user_id = actor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'The next Play is unavailable.';
  end if;

  previous_next_status := next_play.status;

  if next_play.status <> 'open' then
    update public.plays
    set status = 'open'
    where id = next_play.id
    returning * into next_play;
  end if;

  update public.plays
  set status = 'done'
  where id = current_play.id;

  insert into public.play_events (
    owner_user_id,
    play_id,
    actor_user_id,
    event_type,
    source,
    correlation_id,
    payload
  ) values (
    actor_id,
    current_play.id,
    actor_id,
    'done_create',
    'user',
    workflow_id,
    jsonb_build_object(
      'next_play_id', next_play.id,
      'next_play_created', false,
      'relationship_id', next_relationship.id
    )
  );

  insert into public.play_events (
    owner_user_id,
    play_id,
    actor_user_id,
    event_type,
    source,
    correlation_id,
    payload
  ) values (
    actor_id,
    next_play.id,
    actor_id,
    'next_play_activated',
    'user',
    workflow_id,
    jsonb_build_object(
      'previous_play_id', current_play.id,
      'previous_status', previous_next_status,
      'relationship_id', next_relationship.id
    )
  );

  return query select next_play.id, next_play.scheduled_date, next_play.basket_id;
end;
$$;

create or replace function public.done_create_new(
  p_play_id uuid,
  p_title text,
  p_play_type public.play_type,
  p_scheduled_date date,
  p_basket_id uuid
)
returns table (
  next_play_id uuid,
  next_scheduled_date date,
  next_basket_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_play public.plays%rowtype;
  new_play public.plays%rowtype;
  new_relationship public.play_relationships%rowtype;
  workflow_id uuid := gen_random_uuid();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select * into current_play
  from public.plays
  where id = p_play_id and owner_user_id = actor_id
  for update;

  if not found or current_play.status <> 'open' then
    raise exception using errcode = 'P0002', message = 'The current Play is unavailable.';
  end if;

  if exists (
    select 1
    from public.play_relationships
    where owner_user_id = actor_id
      and from_play_id = current_play.id
      and relationship_type = 'next'
  ) then
    raise exception using errcode = '23505', message = 'A next Play is already linked.';
  end if;

  if length(btrim(coalesce(p_title, ''))) not between 1 and 500 then
    raise exception using errcode = '23514', message = 'The next Play title is invalid.';
  end if;

  if (p_scheduled_date is not null) = (p_basket_id is not null) then
    raise exception using errcode = '23514', message = 'Choose exactly one next Play placement.';
  end if;

  if p_basket_id is not null and not exists (
    select 1
    from public.baskets
    where id = p_basket_id and owner_user_id = actor_id
  ) then
    raise exception using errcode = '23503', message = 'The next Play Basket is unavailable.';
  end if;

  insert into public.plays (
    owner_user_id,
    title,
    status,
    play_type,
    source_type,
    scheduled_date,
    basket_id,
    player_contact_id,
    branch,
    push_rule,
    place
  ) values (
    actor_id,
    btrim(p_title),
    'open',
    coalesce(p_play_type, 'normal'),
    'user',
    p_scheduled_date,
    p_basket_id,
    current_play.player_contact_id,
    current_play.branch,
    current_play.push_rule,
    current_play.place
  )
  returning * into new_play;

  insert into public.play_relationships (
    owner_user_id,
    from_play_id,
    to_play_id,
    relationship_type
  ) values (
    actor_id,
    current_play.id,
    new_play.id,
    'next'
  )
  returning * into new_relationship;

  update public.plays
  set status = 'done'
  where id = current_play.id;

  insert into public.play_events (
    owner_user_id,
    play_id,
    actor_user_id,
    event_type,
    source,
    correlation_id,
    payload
  ) values (
    actor_id,
    current_play.id,
    actor_id,
    'done_create',
    'user',
    workflow_id,
    jsonb_build_object(
      'next_play_id', new_play.id,
      'next_play_created', true,
      'relationship_id', new_relationship.id
    )
  );

  insert into public.play_events (
    owner_user_id,
    play_id,
    actor_user_id,
    event_type,
    source,
    correlation_id,
    payload
  ) values (
    actor_id,
    new_play.id,
    actor_id,
    'next_play_created',
    'user',
    workflow_id,
    jsonb_build_object(
      'previous_play_id', current_play.id,
      'relationship_id', new_relationship.id,
      'inherited_context', jsonb_build_array('player_contact_id', 'branch', 'push_rule', 'place')
    )
  );

  return query select new_play.id, new_play.scheduled_date, new_play.basket_id;
end;
$$;

revoke all on function public.validate_next_play_relationship() from public, anon, authenticated;
revoke all on function public.append_next_relationship_event() from public, anon, authenticated;
revoke all on function public.set_next_play(uuid, uuid) from public, anon;
revoke all on function public.done_create_existing(uuid) from public, anon;
revoke all on function public.done_create_new(uuid, text, public.play_type, date, uuid)
  from public, anon;

grant execute on function public.set_next_play(uuid, uuid) to authenticated;
grant execute on function public.done_create_existing(uuid) to authenticated;
grant execute on function public.done_create_new(uuid, text, public.play_type, date, uuid)
  to authenticated;

comment on function public.done_create_existing(uuid) is
  'Atomically completes a Play and activates its owned next Play.';
comment on function public.done_create_new(uuid, text, public.play_type, date, uuid) is
  'Atomically completes a Play, creates and links its next Play, and records workflow history.';
