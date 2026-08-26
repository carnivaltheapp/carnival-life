-- Atomic lifecycle normalization and append-only history for Play mutations.

create or replace function public.normalize_play_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.completed_at := now();
    elsif old.status is distinct from 'done' then
      new.completed_at := now();
    elsif new.completed_at is null then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

create trigger plays_normalize_completion
before insert or update of status, completed_at on public.plays
for each row execute function public.normalize_play_completion();

create or replace function public.append_play_event_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed_fields text[] := '{}';
  before_state jsonb;
  after_state jsonb;
  context_payload jsonb;
  event_source public.play_event_source := 'system';
  has_general_edit boolean := false;
begin
  if auth.uid() is not null then
    event_source := 'user';
  end if;

  after_state := to_jsonb(new) - array[
    'owner_user_id',
    'created_at',
    'updated_at'
  ];

  if tg_op = 'INSERT' then
    insert into public.play_events (
      owner_user_id,
      play_id,
      actor_user_id,
      event_type,
      source,
      payload
    ) values (
      new.owner_user_id,
      new.id,
      auth.uid(),
      'create',
      event_source,
      jsonb_build_object('after', after_state, 'changed_fields', jsonb_build_array('*'))
    );

    return new;
  end if;

  before_state := to_jsonb(old) - array[
    'owner_user_id',
    'created_at',
    'updated_at'
  ];

  if old.title is distinct from new.title then
    changed_fields := array_append(changed_fields, 'title');
    has_general_edit := true;
  end if;
  if old.status is distinct from new.status then
    changed_fields := array_append(changed_fields, 'status');
  end if;
  if old.completed_at is distinct from new.completed_at then
    changed_fields := array_append(changed_fields, 'completed_at');
  end if;
  if old.play_type is distinct from new.play_type then
    changed_fields := array_append(changed_fields, 'play_type');
  end if;
  if old.scheduled_date is distinct from new.scheduled_date then
    changed_fields := array_append(changed_fields, 'scheduled_date');
  end if;
  if old.basket_id is distinct from new.basket_id then
    changed_fields := array_append(changed_fields, 'basket_id');
  end if;
  if old.duration_minutes is distinct from new.duration_minutes then
    changed_fields := array_append(changed_fields, 'duration_minutes');
    has_general_edit := true;
  end if;
  if old.player_contact_id is distinct from new.player_contact_id then
    changed_fields := array_append(changed_fields, 'player_contact_id');
    has_general_edit := true;
  end if;
  if old.branch is distinct from new.branch then
    changed_fields := array_append(changed_fields, 'branch');
    has_general_edit := true;
  end if;
  if old.note is distinct from new.note then
    changed_fields := array_append(changed_fields, 'note');
    has_general_edit := true;
  end if;
  if old.url is distinct from new.url then
    changed_fields := array_append(changed_fields, 'url');
    has_general_edit := true;
  end if;
  if old.push_rule is distinct from new.push_rule then
    changed_fields := array_append(changed_fields, 'push_rule');
    has_general_edit := true;
  end if;
  if old.place is distinct from new.place then
    changed_fields := array_append(changed_fields, 'place');
    has_general_edit := true;
  end if;
  if old.sort_order is distinct from new.sort_order then
    changed_fields := array_append(changed_fields, 'sort_order');
    has_general_edit := true;
  end if;

  if cardinality(changed_fields) = 0 then
    return new;
  end if;

  context_payload := jsonb_build_object(
    'before', before_state,
    'after', after_state,
    'changed_fields', to_jsonb(changed_fields)
  );

  if has_general_edit then
    insert into public.play_events (
      owner_user_id, play_id, actor_user_id, event_type, source, payload
    ) values (
      new.owner_user_id,
      new.id,
      auth.uid(),
      'edit',
      event_source,
      context_payload
    );
  end if;

  if old.scheduled_date is distinct from new.scheduled_date
     or old.basket_id is distinct from new.basket_id then
    insert into public.play_events (
      owner_user_id, play_id, actor_user_id, event_type, source, payload
    ) values (
      new.owner_user_id,
      new.id,
      auth.uid(),
      'move',
      event_source,
      context_payload
    );
  end if;

  if old.play_type is distinct from new.play_type then
    insert into public.play_events (
      owner_user_id, play_id, actor_user_id, event_type, source, payload
    ) values (
      new.owner_user_id,
      new.id,
      auth.uid(),
      'type_change',
      event_source,
      context_payload
    );
  end if;

  if old.status is distinct from new.status then
    insert into public.play_events (
      owner_user_id, play_id, actor_user_id, event_type, source, payload
    ) values (
      new.owner_user_id,
      new.id,
      auth.uid(),
      case new.status
        when 'done' then 'done'
        when 'trash' then 'trash'
        else 'reopen'
      end,
      event_source,
      context_payload
    );
  end if;

  return new;
end;
$$;

create trigger plays_append_event_history
after insert or update on public.plays
for each row execute function public.append_play_event_history();

comment on function public.append_play_event_history() is
  'Atomically records create, edit, move, type, and lifecycle changes with before/after Play state.';
