-- Publish only lifecycle tables whose RLS policies already define the viewer's
-- authorized rows. Clients subscribe with ticket, institution or user filters.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'reports',
    'tickets',
    'ticket_events',
    'ticket_comments',
    'routing_decisions'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables publication_table
      where publication_table.pubname = 'supabase_realtime'
        and publication_table.schemaname = 'public'
        and publication_table.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

