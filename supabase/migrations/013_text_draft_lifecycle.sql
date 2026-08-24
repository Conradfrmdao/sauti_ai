-- ============================================================
-- SAUTI1 AI
-- Text draft cancellation lifecycle
-- ============================================================

-- Permanently discard only an authenticated citizen's own unsubmitted text
-- conversation. Submitted or routed reports can never be removed here.
create or replace function public.cancel_text_conversation(
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
      and conversation.channel = 'text'
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
    raise exception 'A submitted text report cannot be cancelled.';
  end if;

  delete from public.reports report
  where report.conversation_id = target_conversation_id
    and report.user_id = (select auth.uid())
    and report.status in ('draft', 'pending_confirmation');

  get diagnostics deleted_reports = row_count;

  delete from public.conversations conversation
  where conversation.id = target_conversation_id
    and conversation.user_id = (select auth.uid())
    and conversation.channel = 'text';

  cancelled := true;
  deleted_report_count := deleted_reports;
  return next;
end;
$$;

revoke all
on function public.cancel_text_conversation(uuid)
from public;

grant execute
on function public.cancel_text_conversation(uuid)
to authenticated;

-- ============================================================
-- END
-- ============================================================
