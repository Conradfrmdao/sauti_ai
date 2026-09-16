-- Fix the production function created in 018: `confirmed_at` collided with a
-- reports column during PL/pgSQL name resolution.
create or replace function public.confirm_ticket_resolution(
  target_ticket_id uuid,
  issue_fixed boolean,
  feedback text default null
)
returns table (
  ticket_id uuid,
  ticket_code text,
  ticket_status text,
  citizen_confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.tickets;
  target_report public.reports;
  clean_feedback text;
  confirmation_time timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if issue_fixed is null then
    raise exception 'Choose whether the issue is fixed.';
  end if;
  if length(coalesce(feedback, '')) > 1000 then
    raise exception 'Feedback must be 1,000 characters or fewer.';
  end if;

  select * into target_ticket
  from public.tickets ticket
  where ticket.id = target_ticket_id
  for update;
  if target_ticket.id is null then
    raise exception 'Ticket not found or not owned by current user.';
  end if;

  select * into target_report
  from public.reports report
  where report.id = target_ticket.report_id
    and report.user_id = (select auth.uid())
  for update;
  if target_report.id is null then
    raise exception 'Ticket not found or not owned by current user.';
  end if;

  if issue_fixed and target_ticket.status = 'closed'
    and target_ticket.citizen_resolution_confirmed_at is not null
  then
    ticket_id := target_ticket.id;
    ticket_code := target_ticket.ticket_code;
    ticket_status := target_ticket.status;
    citizen_confirmed_at := target_ticket.citizen_resolution_confirmed_at;
    return next;
    return;
  end if;

  if not issue_fixed and target_ticket.status = 'reopened' then
    ticket_id := target_ticket.id;
    ticket_code := target_ticket.ticket_code;
    ticket_status := target_ticket.status;
    citizen_confirmed_at := null;
    return next;
    return;
  end if;

  if target_ticket.status <> 'resolution_proposed' then
    raise exception 'This ticket is not awaiting citizen resolution confirmation.';
  end if;

  clean_feedback := nullif(btrim(coalesce(feedback, '')), '');

  if issue_fixed then
    confirmation_time := now();
    update public.tickets
    set status = 'closed',
        citizen_resolution_confirmed_at = confirmation_time,
        citizen_feedback = clean_feedback,
        reopen_reason = null,
        resolved_at = confirmation_time,
        closed_at = confirmation_time,
        state_version = state_version + 1,
        updated_at = confirmation_time
    where id = target_ticket.id
    returning * into target_ticket;

    update public.reports report
    set status = 'closed', updated_at = confirmation_time
    where report.id = target_ticket.report_id;

    insert into public.ticket_events (
      ticket_id, actor_user_id, actor_type, event_type,
      from_status, to_status, note, visibility, metadata
    ) values
    (
      target_ticket.id, (select auth.uid()), 'citizen', 'resolved_confirmed',
      'resolution_proposed', 'resolved_confirmed',
      coalesce(clean_feedback, 'The citizen confirmed that the issue is fixed.'),
      'citizen', jsonb_build_object('source', 'citizen_workspace')
    ),
    (
      target_ticket.id, (select auth.uid()), 'citizen', 'closed',
      'resolved_confirmed', 'closed',
      'The ticket closed after citizen confirmation.',
      'citizen', jsonb_build_object('source', 'citizen_workspace')
    );
  else
    update public.tickets
    set status = 'reopened',
        citizen_feedback = clean_feedback,
        reopen_reason = coalesce(clean_feedback, 'The citizen reported that the issue remains unresolved.'),
        resolved_at = null,
        closed_at = null,
        state_version = state_version + 1,
        updated_at = now()
    where id = target_ticket.id
    returning * into target_ticket;

    update public.reports report
    set status = 'reopened', updated_at = now()
    where report.id = target_ticket.report_id;

    insert into public.ticket_events (
      ticket_id, actor_user_id, actor_type, event_type,
      from_status, to_status, note, visibility, metadata
    ) values (
      target_ticket.id, (select auth.uid()), 'citizen', 'citizen_reopened',
      'resolution_proposed', 'reopened',
      coalesce(clean_feedback, 'The citizen reported that the issue remains unresolved.'),
      'citizen', jsonb_build_object('source', 'citizen_workspace')
    );
  end if;

  ticket_id := target_ticket.id;
  ticket_code := target_ticket.ticket_code;
  ticket_status := target_ticket.status;
  citizen_confirmed_at := target_ticket.citizen_resolution_confirmed_at;
  return next;
end;
$$;

revoke all on function public.confirm_ticket_resolution(uuid, boolean, text) from public;
grant execute on function public.confirm_ticket_resolution(uuid, boolean, text) to authenticated;
