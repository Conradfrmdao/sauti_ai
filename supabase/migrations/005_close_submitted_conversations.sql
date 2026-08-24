-- A submitted report completes its intake conversation. Keeping the
-- conversation active would make the next Text Sauti1 visit reopen an old case.

create or replace function public.close_submitted_report_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.conversation_id is not null
     and old.status in ('draft', 'pending_confirmation')
     and new.status not in ('draft', 'pending_confirmation') then
    update public.conversations
    set
      status = 'closed',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
    where id = new.conversation_id;
  end if;

  return new;
end;
$$;

drop trigger if exists reports_close_conversation_after_submission on public.reports;

create trigger reports_close_conversation_after_submission
after update of status on public.reports
for each row
execute function public.close_submitted_report_conversation();

-- Repair conversations submitted before this lifecycle rule existed.
update public.conversations c
set
  status = 'closed',
  ended_at = coalesce(c.ended_at, r.confirmed_at, r.updated_at, now()),
  updated_at = now()
from public.reports r
where r.conversation_id = c.id
  and c.status = 'active'
  and r.status not in ('draft', 'pending_confirmation');
