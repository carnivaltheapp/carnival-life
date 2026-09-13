begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

select has_table('public', 'slack_connections', 'Slack connection metadata table exists');
select has_table('private', 'slack_connection_credentials', 'Private Slack credential table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.slack_connections'::regclass),
  'RLS is enabled on Slack connection metadata'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'Authenticated clients cannot access the private credential schema'
);
select ok(
  not has_table_privilege('authenticated', 'private.slack_connection_credentials', 'SELECT'),
  'Authenticated clients cannot read Slack tokens'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_slack_connection_credential(uuid,uuid)',
    'EXECUTE'
  ),
  'Authenticated clients cannot call the Slack credential read boundary'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.store_slack_connection_credential(uuid,uuid,text,text,smallint)',
    'EXECUTE'
  ),
  'Authenticated clients cannot call the Slack credential write boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_slack_connection_credential(uuid,uuid)',
    'EXECUTE'
  ),
  'Service-role code can read encrypted Slack credentials'
);
select policies_are(
  'public',
  'slack_connections',
  array[
    'slack_connections_delete_own',
    'slack_connections_insert_own',
    'slack_connections_select_own',
    'slack_connections_update_own'
  ],
  'Slack connection policies are owner-scoped'
);

select * from finish();
rollback;
