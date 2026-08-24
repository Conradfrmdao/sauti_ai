-- ============================================================
-- SAUTI1 AI
-- Vertical Slice Workflow RPCs
--
-- These functions keep ticket creation and institution
-- acknowledgements server-side while preserving RLS for normal
-- table access.
-- ============================================================

-- ------------------------------------------------------------
-- Allow SAUTI1 server workflow to append AI transcript messages
-- for the signed-in citizen's own conversation.
-- ------------------------------------------------------------

create or replace function public.append_ai_message(
  target_conversation_id uuid,
  message_body text,
  message_metadata jsonb default '{}'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_message public.messages;
begin
  if not exists (
    select 1
    from public.conversations c
    where c.id = target_conversation_id
      and c.user_id = (select auth.uid())
  ) then
    raise exception 'Conversation not found or not owned by current user.';
  end if;

  insert into public.messages (
    conversation_id,
    sender_type,
    body,
    metadata
  )
  values (
    target_conversation_id,
    'ai',
    message_body,
    coalesce(message_metadata, '{}'::jsonb)
  )
  returning *
  into inserted_message;

  return inserted_message;
end;
$$;


-- ------------------------------------------------------------
-- Confirm a citizen report and route it to the detected
-- institution. For the MVP vertical slice, if an institution was
-- not already set, route to MTN Uganda.
-- ------------------------------------------------------------

create or replace function public.submit_report_to_institution(
  target_report_id uuid
)
returns table (
  ticket_id uuid,
  ticket_code text,
  ticket_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports;
  target_institution_id uuid;
  existing_ticket public.tickets;
  inserted_ticket public.tickets;
begin
  select *
  into target_report
  from public.reports r
  where r.id = target_report_id
    and r.user_id = (select auth.uid())
    and r.status in ('draft', 'pending_confirmation');

  if target_report.id is null then
    raise exception 'Report not found, already submitted, or not owned by current user.';
  end if;

  target_institution_id := target_report.institution_id;

  if target_institution_id is null then
    select i.id
    into target_institution_id
    from public.institutions i
    where i.slug = 'mtn-uganda'
      and i.status = 'active'
      and i.verified = true
    limit 1;
  end if;

  if target_institution_id is null then
    raise exception 'No active MTN Uganda institution was found.';
  end if;

  update public.reports
  set
    institution_id = target_institution_id,
    status = 'routed',
    confirmed_at = coalesce(confirmed_at, now()),
    updated_at = now()
  where id = target_report.id
  returning *
  into target_report;

  select *
  into existing_ticket
  from public.tickets t
  where t.report_id = target_report.id
  limit 1;

  if existing_ticket.id is not null then
    ticket_id := existing_ticket.id;
    ticket_code := existing_ticket.ticket_code;
    ticket_status := existing_ticket.status;
    return next;
    return;
  end if;

  insert into public.tickets (
    report_id,
    institution_id,
    category,
    priority,
    status
  )
  values (
    target_report.id,
    target_institution_id,
    target_report.detected_category,
    target_report.priority,
    'routed'
  )
  returning *
  into inserted_ticket;

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
    inserted_ticket.id,
    (select auth.uid()),
    'routed',
    'pending_confirmation',
    'routed',
    'Citizen confirmed report. SAUTI1 routed ticket to MTN Uganda.',
    jsonb_build_object(
      'source',
      target_report.source,
      'ai_confidence',
      target_report.ai_confidence
    )
  );

  ticket_id := inserted_ticket.id;
  ticket_code := inserted_ticket.ticket_code;
  ticket_status := inserted_ticket.status;
  return next;
end;
$$;


-- ------------------------------------------------------------
-- Institution acknowledgement.
-- ------------------------------------------------------------

create or replace function public.acknowledge_ticket(
  target_ticket_id uuid,
  acknowledgement_note text default null
)
returns table (
  ticket_id uuid,
  ticket_code text,
  ticket_status text,
  acknowledged_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.tickets;
  previous_status text;
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
    raise exception 'Current user cannot acknowledge this ticket.';
  end if;

  previous_status := target_ticket.status;

  update public.tickets
  set
    status = 'acknowledged',
    acknowledged_at = coalesce(public.tickets.acknowledged_at, now()),
    updated_at = now()
  where id = target_ticket.id
  returning *
  into target_ticket;

  update public.reports
  set
    status = 'acknowledged',
    updated_at = now()
  where id = target_ticket.report_id;

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
    'acknowledged',
    previous_status,
    'acknowledged',
    coalesce(
      nullif(trim(acknowledgement_note), ''),
      'MTN Uganda acknowledged this ticket.'
    ),
    '{}'::jsonb
  );

  ticket_id := target_ticket.id;
  ticket_code := target_ticket.ticket_code;
  ticket_status := target_ticket.status;
  acknowledged_at := target_ticket.acknowledged_at;
  return next;
end;
$$;


grant execute
on function public.append_ai_message(uuid, text, jsonb)
to authenticated;

grant execute
on function public.submit_report_to_institution(uuid)
to authenticated;

grant execute
on function public.acknowledge_ticket(uuid, text)
to authenticated;

-- ============================================================
-- END
-- ============================================================
