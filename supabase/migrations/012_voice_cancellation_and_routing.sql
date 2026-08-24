-- ============================================================
-- SAUTI1 AI
-- Voice cancellation lifecycle and utility-meter routing
-- ============================================================

-- Make water-meter language explicit in the verified institution catalogue.
update public.institutions
set
  routing_keywords = array(
    select distinct keyword
    from unnest(
      coalesce(routing_keywords, '{}'::text[]) ||
      array['water meter', 'stolen water meter', 'missing water meter']
    ) as keyword
  ),
  updated_at = now()
where slug = 'nwsc-uganda';

update public.institution_services service
set
  routing_keywords = array(
    select distinct keyword
    from unnest(
      coalesce(service.routing_keywords, '{}'::text[]) ||
      array['water meter', 'stolen water meter', 'missing water meter']
    ) as keyword
  ),
  updated_at = now()
from public.institutions institution
where service.institution_id = institution.id
  and institution.slug = 'nwsc-uganda'
  and service.slug = 'water-sewerage';

-- Permanently discard only an authenticated citizen's own unsent voice case.
-- Submitted or routed reports can never be removed through this function.
create or replace function public.cancel_voice_conversation(
  target_conversation_id uuid
)
returns table (
  cancelled boolean,
  deleted_report_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_reports integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.conversations conversation
    where conversation.id = target_conversation_id
      and conversation.user_id = (select auth.uid())
      and conversation.channel = 'voice'
  ) then
    cancelled := true;
    deleted_report_count := 0;
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.reports report
    where report.conversation_id = target_conversation_id
      and report.user_id = (select auth.uid())
      and report.status not in ('draft', 'pending_confirmation')
  ) then
    raise exception 'A submitted voice report cannot be cancelled.';
  end if;

  delete from public.reports report
  where report.conversation_id = target_conversation_id
    and report.user_id = (select auth.uid())
    and report.status in ('draft', 'pending_confirmation');

  get diagnostics deleted_reports = row_count;

  delete from public.conversations conversation
  where conversation.id = target_conversation_id
    and conversation.user_id = (select auth.uid())
    and conversation.channel = 'voice';

  cancelled := true;
  deleted_report_count := deleted_reports;
  return next;
end;
$$;

revoke all
on function public.cancel_voice_conversation(uuid)
from public;

grant execute
on function public.cancel_voice_conversation(uuid)
to authenticated;

-- ============================================================
-- END
-- ============================================================
