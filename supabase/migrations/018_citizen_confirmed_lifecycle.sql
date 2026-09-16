-- ============================================================
-- SAUTI1
-- Authoritative lifecycle and citizen-confirmed outcomes
-- ============================================================

begin;

alter table public.tickets
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists resolution_note text,
  add column if not exists resolution_proposed_at timestamptz,
  add column if not exists citizen_resolution_confirmed_at timestamptz,
  add column if not exists citizen_feedback text,
  add column if not exists reopen_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists state_version integer not null default 1
    check (state_version > 0);

-- Preserve the meaning of pre-existing terminal records while moving new
-- resolutions behind citizen confirmation.
update public.tickets ticket
set resolution_note = coalesce(
      nullif(btrim(ticket.resolution_note), ''),
      (
        select nullif(btrim(event.note), '')
        from public.ticket_events event
        where event.ticket_id = ticket.id
          and event.to_status = 'resolved'
        order by event.created_at desc
        limit 1
      ),
      'Resolution recorded before citizen confirmation was introduced.'
    ),
    resolution_proposed_at = coalesce(ticket.resolution_proposed_at, ticket.resolved_at, ticket.updated_at)
where ticket.status = 'resolved';

update public.tickets
set citizen_resolution_confirmed_at = coalesce(citizen_resolution_confirmed_at, resolved_at, updated_at),
    closed_at = coalesce(closed_at, resolved_at, updated_at),
    resolution_note = coalesce(
      nullif(btrim(resolution_note), ''),
      'Closed before citizen confirmation was introduced.'
    )
where status = 'closed';

alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.reports drop constraint if exists reports_status_check;

update public.tickets set status = 'resolution_proposed' where status = 'resolved';
update public.tickets set status = 'cancelled' where status = 'rejected';
update public.reports set status = 'resolution_proposed' where status = 'resolved';
update public.reports set status = 'cancelled' where status = 'rejected';

alter table public.tickets
  add constraint tickets_status_check check (
    status in (
      'submitted', 'routed', 'needs_review', 'acknowledged', 'assigned',
      'in_progress', 'resolution_proposed', 'resolved_confirmed',
      'reopened', 'closed', 'cancelled'
    )
  );

alter table public.reports
  add constraint reports_status_check check (
    status in (
      'draft', 'pending_confirmation', 'submitted', 'routed', 'needs_review',
      'acknowledged', 'assigned', 'in_progress', 'resolution_proposed',
      'resolved_confirmed', 'reopened', 'closed', 'cancelled'
    )
  );

alter table public.ticket_events
  add column if not exists actor_type text not null default 'system',
  add column if not exists actor_institution_id uuid references public.institutions(id) on delete set null,
  add column if not exists visibility text not null default 'citizen';

alter table public.ticket_events
  drop constraint if exists ticket_events_actor_type_check,
  add constraint ticket_events_actor_type_check
    check (actor_type in ('citizen', 'institution', 'admin', 'system')),
  drop constraint if exists ticket_events_visibility_check,
  add constraint ticket_events_visibility_check
    check (visibility in ('internal', 'citizen', 'admin', 'system'));

update public.ticket_events event
set actor_type = case
  when event.actor_user_id is null then 'system'
  when exists (
    select 1 from public.profiles profile
    where profile.id = event.actor_user_id and profile.role = 'admin'
  ) then 'admin'
  when exists (
    select 1
    from public.tickets ticket
    join public.reports report on report.id = ticket.report_id
    where ticket.id = event.ticket_id and report.user_id = event.actor_user_id
  ) then 'citizen'
  else 'institution'
end;

update public.ticket_events event
set actor_institution_id = ticket.institution_id
from public.tickets ticket
where ticket.id = event.ticket_id
  and event.actor_type = 'institution'
  and event.actor_institution_id is null;

create index if not exists tickets_assigned_queue_idx
  on public.tickets (institution_id, assigned_to, status, updated_at desc);
create index if not exists tickets_resolution_confirmation_idx
  on public.tickets (resolution_proposed_at)
  where status = 'resolution_proposed';
create index if not exists ticket_events_visibility_idx
  on public.ticket_events (ticket_id, visibility, created_at desc);

-- Citizens see only explicitly citizen-visible history. Institution members
-- see their operational history, and platform admins see the complete trail.
drop policy if exists "Authorized users can view ticket history" on public.ticket_events;
create policy "Authorized users can view ticket history"
on public.ticket_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets ticket
    join public.reports report on report.id = ticket.report_id
    where ticket.id = ticket_events.ticket_id
      and (
        (report.user_id = (select auth.uid()) and ticket_events.visibility = 'citizen')
        or private.is_institution_member(ticket.institution_id)
        or private.is_platform_admin()
      )
  )
);

-- Future lifecycle states should not accidentally hide submitted cases from
-- the responsible institution. Drafts remain citizen/admin-only.
drop policy if exists "Citizens can view own reports" on public.reports;
create policy "Citizens can view own reports"
on public.reports
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (
    institution_id is not null
    and status not in ('draft', 'pending_confirmation')
    and private.is_institution_member(institution_id)
  )
  or private.is_platform_admin()
);

drop policy if exists "Institution members can read routed citizen profiles" on public.profiles;
create policy "Institution members can read routed citizen profiles"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.reports report
    where report.user_id = profiles.id
      and report.institution_id is not null
      and report.status not in ('draft', 'pending_confirmation')
      and private.is_institution_member(report.institution_id)
  )
  or private.is_platform_admin()
);

drop policy if exists "Institution members can read routed report messages" on public.messages;
create policy "Institution members can read routed report messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.reports report
    where report.conversation_id = messages.conversation_id
      and report.institution_id is not null
      and report.status not in ('draft', 'pending_confirmation')
      and private.is_institution_member(report.institution_id)
  )
  or private.is_platform_admin()
);

drop policy if exists "Users can view authorized report attachments" on public.report_attachments;
create policy "Users can view authorized report attachments"
on public.report_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.reports report
    where report.id = report_attachments.report_id
      and (
        report.user_id = (select auth.uid())
        or (
          report.institution_id is not null
          and report.status not in ('draft', 'pending_confirmation')
          and private.is_institution_member(report.institution_id)
        )
        or private.is_platform_admin()
      )
  )
);

drop policy if exists "Authorized users can read report evidence" on storage.objects;
create policy "Authorized users can read report evidence"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'report-attachments'
  and exists (
    select 1
    from public.report_attachments attachment
    join public.reports report on report.id = attachment.report_id
    where attachment.storage_path = storage.objects.name
      and (
        report.user_id = (select auth.uid())
        or (
          report.institution_id is not null
          and report.status not in ('draft', 'pending_confirmation')
          and private.is_institution_member(report.institution_id)
        )
        or private.is_platform_admin()
      )
  )
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
  member_role text;
  event_actor_type text;
begin
  select * into target_ticket
  from public.tickets ticket
  where ticket.id = target_ticket_id
  for update;

  if target_ticket.id is null then
    raise exception 'Ticket not found.';
  end if;

  select member.role into member_role
  from public.institution_members member
  join public.institutions institution on institution.id = member.institution_id
  where member.institution_id = target_ticket.institution_id
    and member.user_id = (select auth.uid())
    and member.active = true
    and institution.status = 'active';

  if private.is_platform_admin() then
    event_actor_type := 'admin';
  elsif member_role in ('supervisor', 'institution_admin')
    or (member_role = 'agent' and target_ticket.assigned_to = (select auth.uid()))
  then
    event_actor_type := 'institution';
  else
    raise exception 'Current user cannot update this ticket.';
  end if;

  if length(coalesce(status_note, '')) > 1000 then
    raise exception 'Status notes must be 1,000 characters or fewer.';
  end if;

  previous_status := target_ticket.status;

  -- Compatibility for the immediately preceding deployed client: the old
  -- "resolved" command now means propose resolution and can never close a
  -- ticket without the citizen.
  if target_status = 'resolved' then
    target_status := 'resolution_proposed';
  end if;

  if target_status not in ('acknowledged', 'in_progress', 'resolution_proposed') then
    raise exception 'Unsupported institution ticket status.';
  end if;

  if target_status = 'resolution_proposed'
    and length(trim(coalesce(status_note, ''))) < 12
  then
    raise exception 'Add a clear resolution note before proposing resolution.';
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
    or (previous_status in ('acknowledged', 'assigned', 'reopened') and target_status = 'in_progress')
    or (
      previous_status in ('acknowledged', 'assigned', 'in_progress', 'reopened')
      and target_status = 'resolution_proposed'
    )
  ) then
    raise exception 'Ticket cannot move from % to %.', previous_status, target_status;
  end if;

  event_note := coalesce(
    nullif(trim(status_note), ''),
    case target_status
      when 'acknowledged' then 'The institution acknowledged this ticket.'
      when 'in_progress' then 'The institution started working on this ticket.'
    end
  );

  update public.tickets
  set status = target_status,
      acknowledged_at = case
        when target_status = 'acknowledged' then coalesce(public.tickets.acknowledged_at, now())
        else public.tickets.acknowledged_at
      end,
      resolution_note = case
        when target_status = 'resolution_proposed' then event_note
        else public.tickets.resolution_note
      end,
      resolution_proposed_at = case
        when target_status = 'resolution_proposed' then now()
        else public.tickets.resolution_proposed_at
      end,
      state_version = state_version + 1,
      updated_at = now()
  where id = target_ticket.id
  returning * into target_ticket;

  update public.reports
  set status = target_status, updated_at = now()
  where id = target_ticket.report_id;

  insert into public.ticket_events (
    ticket_id, actor_user_id, actor_type, actor_institution_id,
    event_type, from_status, to_status, note, visibility, metadata
  )
  values (
    target_ticket.id,
    (select auth.uid()),
    event_actor_type,
    case when event_actor_type = 'institution' then target_ticket.institution_id else null end,
    target_status,
    previous_status,
    target_status,
    event_note,
    'citizen',
    jsonb_build_object('source', 'institution_workspace', 'state_version', target_ticket.state_version)
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

    update public.reports
    set status = 'closed', updated_at = confirmation_time
    where id = target_ticket.report_id;

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

    update public.reports
    set status = 'reopened', updated_at = now()
    where id = target_ticket.report_id;

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

commit;

-- ============================================================
-- END
-- ============================================================
