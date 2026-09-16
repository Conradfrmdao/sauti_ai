-- ============================================================
-- SAUTI1
-- Workflow integrity, suspension enforcement and operations RPCs
-- ============================================================

begin;

-- A report is a single civic case and can never have two tickets.
do $$
begin
  if exists (
    select 1
    from public.tickets
    group by report_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate tickets exist for a report. Reconcile them before applying migration 017.';
  end if;
end;
$$;

create unique index if not exists tickets_one_per_report_idx
  on public.tickets (report_id);

create index if not exists tickets_open_queue_idx
  on public.tickets (institution_id, priority, created_at desc)
  where status not in ('resolved', 'closed', 'rejected');

create index if not exists ticket_events_ticket_created_idx
  on public.ticket_events (ticket_id, created_at desc);

-- Storage and relational deletes cannot share a transaction. Cancellation
-- records each object before deleting its attachment rows so a storage outage
-- never loses the cleanup work or leaves a live draft without its evidence.
create table if not exists public.storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (btrim(bucket) <> ''),
  object_path text not null check (btrim(object_path) <> ''),
  reason text not null check (btrim(reason) <> ''),
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  last_attempt_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bucket, object_path)
);

create index if not exists storage_cleanup_jobs_pending_idx
  on public.storage_cleanup_jobs (created_at)
  where status = 'pending';

alter table public.storage_cleanup_jobs enable row level security;
revoke all on public.storage_cleanup_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.storage_cleanup_jobs to service_role;

create or replace function private.cancel_draft_conversation(
  target_conversation_id uuid,
  target_channel text
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

  if target_channel not in ('text', 'voice') then
    raise exception 'Unsupported draft conversation channel.';
  end if;

  if not exists (
    select 1
    from public.conversations conversation
    where conversation.id = target_conversation_id
      and conversation.user_id = (select auth.uid())
      and conversation.channel = target_channel
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
    raise exception 'A submitted report cannot be cancelled.';
  end if;

  insert into public.storage_cleanup_jobs (
    bucket, object_path, reason, requested_by
  )
  select
    'report-attachments',
    attachment.storage_path,
    target_channel || '_draft_cancelled',
    (select auth.uid())
  from public.report_attachments attachment
  join public.reports report on report.id = attachment.report_id
  where report.conversation_id = target_conversation_id
    and report.user_id = (select auth.uid())
    and report.status in ('draft', 'pending_confirmation')
    and nullif(btrim(attachment.storage_path), '') is not null
  on conflict (bucket, object_path) do update
  set status = 'pending',
      reason = excluded.reason,
      requested_by = excluded.requested_by,
      last_error = null,
      completed_at = null;

  delete from public.reports report
  where report.conversation_id = target_conversation_id
    and report.user_id = (select auth.uid())
    and report.status in ('draft', 'pending_confirmation');

  get diagnostics deleted_reports = row_count;

  delete from public.conversations conversation
  where conversation.id = target_conversation_id
    and conversation.user_id = (select auth.uid())
    and conversation.channel = target_channel;

  cancelled := true;
  deleted_report_count := deleted_reports;
  return next;
end;
$$;

revoke all on function private.cancel_draft_conversation(uuid, text) from public;

create or replace function public.cancel_text_conversation(
  target_conversation_id uuid
)
returns table (
  cancelled boolean,
  deleted_report_count integer
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.cancel_draft_conversation(target_conversation_id, 'text');
$$;

create or replace function public.cancel_voice_conversation(
  target_conversation_id uuid
)
returns table (
  cancelled boolean,
  deleted_report_count integer
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.cancel_draft_conversation(target_conversation_id, 'voice');
$$;

revoke all on function public.cancel_text_conversation(uuid) from public;
revoke all on function public.cancel_voice_conversation(uuid) from public;
grant execute on function public.cancel_text_conversation(uuid) to authenticated;
grant execute on function public.cancel_voice_conversation(uuid) to authenticated;

alter table public.external_channel_contacts
  add column if not exists link_verified_at timestamptz,
  add column if not exists link_method text;

create or replace function public.protect_external_contact_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.linked_user_id is null then
    new.link_verified_at := null;
    new.link_method := null;
    return new;
  end if;

  if tg_op = 'INSERT'
    or new.linked_user_id is distinct from old.linked_user_id
    or new.link_verified_at is distinct from old.link_verified_at
    or new.link_method is distinct from old.link_method
  then
    if new.link_verified_at is null or new.link_method <> 'otp' then
      raise exception 'A low-tech contact can only be linked after OTP verification.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists external_channel_contacts_protect_link
  on public.external_channel_contacts;
create trigger external_channel_contacts_protect_link
before insert or update on public.external_channel_contacts
for each row execute function public.protect_external_contact_link();

-- A suspended institution must not retain data or workflow access through an
-- otherwise-active membership.
create or replace function private.is_institution_member(target_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.institution_members im
    join public.institutions i on i.id = im.institution_id
    where im.institution_id = target_institution_id
      and im.user_id = (select auth.uid())
      and im.active = true
      and i.status = 'active'
  );
$$;

create or replace function private.is_institution_admin(target_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.institution_members im
    join public.institutions i on i.id = im.institution_id
    where im.institution_id = target_institution_id
      and im.user_id = (select auth.uid())
      and im.role = 'institution_admin'
      and im.active = true
      and i.status = 'active'
  );
$$;

-- The application now writes AI messages with the server-only service client
-- after authenticating and authorizing the citizen/conversation.
revoke all on function public.append_ai_message(uuid, text, jsonb) from public;
revoke all on function public.append_ai_message(uuid, text, jsonb) from authenticated;
grant execute on function public.append_ai_message(uuid, text, jsonb) to service_role;

-- Citizens may acknowledge that they opened a draft, but all AI extraction,
-- routing, source, priority and status fields are written only by trusted
-- server code or security-definer workflow functions.
revoke insert, update on public.reports from authenticated;
grant update (attention_read_at) on public.reports to authenticated;

-- Lock the report before checking status/ticket existence so retries and
-- concurrent confirmations always return exactly one ticket.
create or replace function public.submit_report_to_institution(target_report_id uuid)
returns table (
  ticket_id uuid,
  ticket_code text,
  ticket_status text,
  institution_id uuid,
  institution_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports;
  target_institution public.institutions;
  existing_ticket public.tickets;
  inserted_ticket public.tickets;
begin
  select *
  into target_report
  from public.reports r
  where r.id = target_report_id
    and r.user_id = (select auth.uid())
  for update;

  if target_report.id is null then
    raise exception 'Report not found or not owned by current user.';
  end if;

  select *
  into existing_ticket
  from public.tickets t
  where t.report_id = target_report.id;

  if existing_ticket.id is not null then
    select *
    into target_institution
    from public.institutions i
    where i.id = existing_ticket.institution_id;

    ticket_id := existing_ticket.id;
    ticket_code := existing_ticket.ticket_code;
    ticket_status := existing_ticket.status;
    institution_id := existing_ticket.institution_id;
    institution_name := coalesce(target_institution.short_name, target_institution.name);
    return next;
    return;
  end if;

  if target_report.status not in ('draft', 'pending_confirmation') then
    raise exception 'Report is no longer available for submission.';
  end if;

  if target_report.source not in ('text', 'voice') then
    raise exception 'This submission path only accepts Web or browser Voice reports.';
  end if;

  if target_report.conversation_id is null or not exists (
    select 1
    from public.conversations c
    where c.id = target_report.conversation_id
      and c.user_id = (select auth.uid())
      and c.channel = target_report.source
  ) then
    raise exception 'The report source does not match its owned conversation.';
  end if;

  if length(trim(coalesce(target_report.description, ''))) < 10 then
    raise exception 'Add enough detail to describe the issue before submission.';
  end if;

  if nullif(trim(coalesce(target_report.detected_category, '')), '') is null then
    raise exception 'The report category must be confirmed before submission.';
  end if;

  if target_report.institution_id is null then
    raise exception 'The responsible institution must be confirmed before submission.';
  end if;

  select *
  into target_institution
  from public.institutions i
  where i.id = target_report.institution_id
    and i.status = 'active'
    and i.verified = true;

  if target_institution.id is null then
    raise exception 'The selected institution is not available for routing.';
  end if;

  update public.reports
  set status = 'routed',
      confirmed_at = coalesce(confirmed_at, now()),
      updated_at = now()
  where id = target_report.id;

  insert into public.tickets (
    report_id, institution_id, category, priority, status
  )
  values (
    target_report.id,
    target_institution.id,
    target_report.detected_category,
    target_report.priority,
    'routed'
  )
  returning * into inserted_ticket;

  insert into public.ticket_events (
    ticket_id, actor_user_id, event_type, from_status, to_status, note, metadata
  )
  values (
    inserted_ticket.id,
    (select auth.uid()),
    'routed',
    target_report.status,
    'routed',
    'Citizen confirmed the report. SAUTI1 routed it to ' ||
      coalesce(target_institution.short_name, target_institution.name) || '.',
    jsonb_build_object(
      'source', target_report.source,
      'ai_confidence', target_report.ai_confidence,
      'institution_slug', target_institution.slug
    )
  );

  ticket_id := inserted_ticket.id;
  ticket_code := inserted_ticket.ticket_code;
  ticket_status := inserted_ticket.status;
  institution_id := target_institution.id;
  institution_name := coalesce(target_institution.short_name, target_institution.name);
  return next;
end;
$$;

revoke all on function public.submit_report_to_institution(uuid) from public;
grant execute on function public.submit_report_to_institution(uuid) to authenticated;

-- Serialize transitions, cap public notes and require a useful resolution
-- record instead of a generic "solved" event.
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
  where t.id = target_ticket_id
  for update;

  if target_ticket.id is null then
    raise exception 'Ticket not found.';
  end if;

  if not (
    private.is_institution_member(target_ticket.institution_id)
    or private.is_platform_admin()
  ) then
    raise exception 'Current user cannot update this ticket.';
  end if;

  if length(coalesce(status_note, '')) > 1000 then
    raise exception 'Status notes must be 1,000 characters or fewer.';
  end if;

  previous_status := target_ticket.status;

  if target_status not in ('acknowledged', 'in_progress', 'resolved', 'closed') then
    raise exception 'Unsupported ticket status.';
  end if;

  if target_status = 'resolved' and length(trim(coalesce(status_note, ''))) < 12 then
    raise exception 'Add a clear resolution note before marking this ticket solved.';
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
  set status = target_status, updated_at = now()
  where id = target_ticket.report_id;

  event_note := coalesce(
    nullif(trim(status_note), ''),
    case target_status
      when 'acknowledged' then 'The institution acknowledged this ticket.'
      when 'in_progress' then 'The institution started working on this ticket.'
      when 'closed' then 'The institution closed this ticket.'
    end
  );

  insert into public.ticket_events (
    ticket_id, actor_user_id, event_type, from_status, to_status, note, metadata
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

revoke all on function public.update_ticket_status(uuid, text, text) from public;
grant execute on function public.update_ticket_status(uuid, text, text) to authenticated;

-- Keep compatibility for deployed clients, but make legacy acknowledgement
-- obey the same locked transition graph.
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
language sql
security definer
set search_path = ''
as $$
  select u.ticket_id, u.ticket_code, u.ticket_status, u.acknowledged_at
  from public.update_ticket_status(
    target_ticket_id,
    'acknowledged',
    acknowledgement_note
  ) u;
$$;

revoke all on function public.acknowledge_ticket(uuid, text) from public;
grant execute on function public.acknowledge_ticket(uuid, text) to authenticated;

-- Immutable platform-operation audit trail. Metadata is deliberately limited
-- to IDs and state changes by the functions below.
create table if not exists public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_events_created_idx
  on public.platform_audit_events (created_at desc);

alter table public.platform_audit_events enable row level security;

drop policy if exists "Platform admins can read operations audit" on public.platform_audit_events;
create policy "Platform admins can read operations audit"
on public.platform_audit_events
for select
to authenticated
using (private.is_platform_admin());

revoke all on public.platform_audit_events from anon;
revoke all on public.platform_audit_events from authenticated;
grant select on public.platform_audit_events to authenticated;

create or replace function public.assign_ticket(
  target_ticket_id uuid,
  target_assignee_id uuid
)
returns table (
  ticket_id uuid,
  ticket_code text,
  ticket_status text,
  assigned_to uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.tickets;
  previous_status text;
begin
  select * into target_ticket
  from public.tickets t
  where t.id = target_ticket_id
  for update;

  if target_ticket.id is null then
    raise exception 'Ticket not found.';
  end if;

  if not private.is_platform_admin() and not exists (
    select 1
    from public.institution_members im
    join public.institutions i on i.id = im.institution_id
    where im.institution_id = target_ticket.institution_id
      and im.user_id = (select auth.uid())
      and im.active = true
      and im.role in ('supervisor', 'institution_admin')
      and i.status = 'active'
  ) then
    raise exception 'Only a supervisor or institution administrator can assign tickets.';
  end if;

  if target_ticket.status in ('resolved', 'closed', 'rejected') then
    raise exception 'A completed or rejected ticket cannot be assigned.';
  end if;

  if not exists (
    select 1
    from public.institution_members im
    where im.institution_id = target_ticket.institution_id
      and im.user_id = target_assignee_id
      and im.active = true
  ) then
    raise exception 'The assignee is not an active member of this institution.';
  end if;

  previous_status := target_ticket.status;

  update public.tickets
  set assigned_to = target_assignee_id,
      status = case when status = 'in_progress' then status else 'assigned' end,
      acknowledged_at = coalesce(acknowledged_at, now()),
      updated_at = now()
  where id = target_ticket.id
  returning * into target_ticket;

  update public.reports
  set status = case when target_ticket.status = 'in_progress' then 'in_progress' else 'acknowledged' end,
      updated_at = now()
  where id = target_ticket.report_id;

  insert into public.ticket_events (
    ticket_id, actor_user_id, event_type, from_status, to_status, note, metadata
  )
  values (
    target_ticket.id,
    (select auth.uid()),
    'assigned',
    previous_status,
    target_ticket.status,
    'The institution assigned this ticket to a team member.',
    jsonb_build_object('source', 'institution_workspace')
  );

  ticket_id := target_ticket.id;
  ticket_code := target_ticket.ticket_code;
  ticket_status := target_ticket.status;
  assigned_to := target_ticket.assigned_to;
  return next;
end;
$$;

revoke all on function public.assign_ticket(uuid, uuid) from public;
grant execute on function public.assign_ticket(uuid, uuid) to authenticated;

-- Return only the minimum team-directory fields. This avoids granting broad
-- row access to teammate profile phone numbers or other profile data.
create or replace function public.get_institution_team_directory(target_institution_id uuid)
returns table (
  user_id uuid,
  full_name text,
  member_role text,
  department text,
  active boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    im.user_id,
    p.full_name,
    im.role,
    im.department,
    im.active,
    im.created_at
  from public.institution_members im
  left join public.profiles p on p.id = im.user_id
  where im.institution_id = target_institution_id
    and (
      private.is_institution_member(target_institution_id)
      or private.is_platform_admin()
    )
  order by im.active desc, im.created_at asc;
$$;

revoke all on function public.get_institution_team_directory(uuid) from public;
grant execute on function public.get_institution_team_directory(uuid) to authenticated;

create or replace function public.reroute_ticket(
  target_ticket_id uuid,
  target_institution_id uuid,
  reroute_note text default null
)
returns table (
  ticket_id uuid,
  ticket_code text,
  ticket_status text,
  institution_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.tickets;
  next_institution public.institutions;
  previous_institution_id uuid;
  previous_status text;
  event_note text;
begin
  if not private.is_platform_admin() then
    raise exception 'Only a platform administrator can reroute tickets.';
  end if;

  if length(coalesce(reroute_note, '')) > 1000 then
    raise exception 'Reroute notes must be 1,000 characters or fewer.';
  end if;

  select * into target_ticket
  from public.tickets t
  where t.id = target_ticket_id
  for update;

  if target_ticket.id is null then
    raise exception 'Ticket not found.';
  end if;

  if target_ticket.status in ('resolved', 'closed', 'rejected') then
    raise exception 'A completed or rejected ticket cannot be rerouted.';
  end if;

  select * into next_institution
  from public.institutions i
  where i.id = target_institution_id
    and i.status = 'active'
    and i.verified = true;

  if next_institution.id is null then
    raise exception 'The destination institution is not active and verified.';
  end if;

  if target_ticket.institution_id = next_institution.id then
    raise exception 'Choose a different destination institution.';
  end if;

  previous_institution_id := target_ticket.institution_id;
  previous_status := target_ticket.status;
  event_note := coalesce(
    nullif(trim(reroute_note), ''),
    'SAUTI1 operations corrected the destination institution.'
  );

  update public.tickets
  set institution_id = next_institution.id,
      assigned_to = null,
      status = 'routed',
      acknowledged_at = null,
      resolved_at = null,
      updated_at = now()
  where id = target_ticket.id
  returning * into target_ticket;

  update public.reports
  set institution_id = next_institution.id,
      status = 'routed',
      updated_at = now()
  where id = target_ticket.report_id;

  insert into public.ticket_events (
    ticket_id, actor_user_id, event_type, from_status, to_status, note, metadata
  )
  values (
    target_ticket.id,
    (select auth.uid()),
    'rerouted',
    previous_status,
    'routed',
    event_note,
    jsonb_build_object(
      'from_institution_id', previous_institution_id,
      'to_institution_id', next_institution.id,
      'source', 'admin_workspace'
    )
  );

  insert into public.platform_audit_events (
    actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    (select auth.uid()),
    'ticket_rerouted',
    'ticket',
    target_ticket.id,
    jsonb_build_object(
      'from_institution_id', previous_institution_id,
      'to_institution_id', next_institution.id
    )
  );

  ticket_id := target_ticket.id;
  ticket_code := target_ticket.ticket_code;
  ticket_status := target_ticket.status;
  institution_id := target_ticket.institution_id;
  return next;
end;
$$;

revoke all on function public.reroute_ticket(uuid, uuid, text) from public;
grant execute on function public.reroute_ticket(uuid, uuid, text) to authenticated;

create or replace function public.update_institution_operational_state(
  target_institution_id uuid,
  target_status text,
  target_onboarding_state text,
  target_verified boolean
)
returns table (
  institution_id uuid,
  institution_status text,
  onboarding_state text,
  verified boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_institution public.institutions;
begin
  if not private.is_platform_admin() then
    raise exception 'Only a platform administrator can change institution state.';
  end if;

  if target_status not in ('pending', 'active', 'suspended') then
    raise exception 'Unsupported institution status.';
  end if;

  if target_onboarding_state not in ('catalogued', 'invited', 'onboarded') then
    raise exception 'Unsupported onboarding state.';
  end if;

  update public.institutions
  set status = target_status,
      onboarding_state = target_onboarding_state,
      verified = target_verified,
      updated_at = now()
  where id = target_institution_id
  returning * into updated_institution;

  if updated_institution.id is null then
    raise exception 'Institution not found.';
  end if;

  insert into public.platform_audit_events (
    actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    (select auth.uid()),
    'institution_state_updated',
    'institution',
    updated_institution.id,
    jsonb_build_object(
      'status', updated_institution.status,
      'onboarding_state', updated_institution.onboarding_state,
      'verified', updated_institution.verified
    )
  );

  institution_id := updated_institution.id;
  institution_status := updated_institution.status;
  onboarding_state := updated_institution.onboarding_state;
  verified := updated_institution.verified;
  return next;
end;
$$;

revoke all on function public.update_institution_operational_state(uuid, text, text, boolean)
from public;
grant execute on function public.update_institution_operational_state(uuid, text, text, boolean)
to authenticated;

commit;

-- ============================================================
-- END
-- ============================================================
