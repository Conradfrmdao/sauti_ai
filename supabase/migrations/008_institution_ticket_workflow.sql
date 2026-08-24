-- ============================================================
-- SAUTI1 AI
-- Institution ticket detail and resolution workflow
-- ============================================================

-- Institution staff need the citizen's public account details only when the
-- citizen has a report routed to that staff member's institution.
create policy "Institution members can read routed citizen profiles"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.reports r
    where r.user_id = profiles.id
      and r.institution_id is not null
      and private.is_institution_member(r.institution_id)
  )
  or private.is_platform_admin()
);

-- The report conversation is part of the ticket record. Keep unrelated
-- citizen conversations private.
create policy "Institution members can read routed report messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.reports r
    where r.conversation_id = messages.conversation_id
      and r.institution_id is not null
      and private.is_institution_member(r.institution_id)
  )
  or private.is_platform_admin()
);

create or replace function public.update_ticket_status(
  target_ticket_id uuid,
  target_status text,
  status_note text default null
)
returns table (
  ticket_id uuid,
  ticket_code text,
  ticket_status text,
  acknowledged_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.tickets;
  previous_status text;
  event_note text;
begin
  select *
  into target_ticket
  from public.tickets t
  where t.id = target_ticket_id;

  if target_ticket.id is null then
    raise exception 'Ticket not found.';
  end if;

  if not (
    private.is_institution_member(target_ticket.institution_id)
    or private.is_platform_admin()
  ) then
    raise exception 'Current user cannot update this ticket.';
  end if;

  previous_status := target_ticket.status;

  if target_status not in ('acknowledged', 'in_progress', 'resolved', 'closed') then
    raise exception 'Unsupported ticket status.';
  end if;

  if target_status = previous_status then
    ticket_id := target_ticket.id;
    ticket_code := target_ticket.ticket_code;
    ticket_status := target_ticket.status;
    acknowledged_at := target_ticket.acknowledged_at;
    resolved_at := target_ticket.resolved_at;
    return next;
    return;
  end if;

  if not (
    (previous_status in ('submitted', 'routed') and target_status = 'acknowledged')
    or (previous_status in ('acknowledged', 'assigned') and target_status in ('in_progress', 'resolved'))
    or (previous_status = 'in_progress' and target_status = 'resolved')
    or (previous_status = 'resolved' and target_status = 'closed')
  ) then
    raise exception 'Ticket cannot move from % to %.', previous_status, target_status;
  end if;

  update public.tickets
  set
    status = target_status,
    acknowledged_at = case
      when target_status = 'acknowledged' then coalesce(public.tickets.acknowledged_at, now())
      else public.tickets.acknowledged_at
    end,
    resolved_at = case
      when target_status in ('resolved', 'closed') then coalesce(public.tickets.resolved_at, now())
      else public.tickets.resolved_at
    end,
    updated_at = now()
  where id = target_ticket.id
  returning * into target_ticket;

  update public.reports
  set
    status = target_status,
    updated_at = now()
  where id = target_ticket.report_id;

  event_note := coalesce(
    nullif(trim(status_note), ''),
    case target_status
      when 'acknowledged' then 'The institution acknowledged this ticket.'
      when 'in_progress' then 'The institution started working on this ticket.'
      when 'resolved' then 'The institution marked this ticket as solved.'
      when 'closed' then 'The institution closed this ticket.'
    end
  );

  insert into public.ticket_events (
    ticket_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    target_ticket.id,
    (select auth.uid()),
    target_status,
    previous_status,
    target_status,
    event_note,
    jsonb_build_object('source', 'institution_workspace')
  );

  ticket_id := target_ticket.id;
  ticket_code := target_ticket.ticket_code;
  ticket_status := target_ticket.status;
  acknowledged_at := target_ticket.acknowledged_at;
  resolved_at := target_ticket.resolved_at;
  return next;
end;
$$;

grant execute
on function public.update_ticket_status(uuid, text, text)
to authenticated;

-- ============================================================
-- END
-- ============================================================
