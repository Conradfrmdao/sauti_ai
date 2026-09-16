-- ============================================================
-- SAUTI1
-- Institution roles, collaboration, assignment and safe transfer
-- ============================================================

begin;

alter table public.institution_members
  drop constraint if exists institution_members_role_check;
alter table public.institution_members
  add constraint institution_members_role_check
  check (role in ('agent', 'viewer', 'supervisor', 'institution_admin'));

alter table public.tickets
  add column if not exists transfer_requested_at timestamptz,
  add column if not exists transfer_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists transfer_reason text,
  add column if not exists suggested_institution_id uuid references public.institutions(id) on delete set null;

create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_institution_id uuid references public.institutions(id) on delete set null,
  visibility text not null check (visibility in ('internal', 'citizen')),
  body text not null check (char_length(btrim(body)) between 2 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists ticket_comments_set_updated_at on public.ticket_comments;
create trigger ticket_comments_set_updated_at
before update on public.ticket_comments
for each row execute function public.set_updated_at();

create index if not exists ticket_comments_ticket_created_idx
  on public.ticket_comments (ticket_id, created_at desc);
create index if not exists tickets_transfer_review_idx
  on public.tickets (transfer_requested_at desc)
  where status = 'needs_review';

alter table public.ticket_comments enable row level security;

drop policy if exists "Authorized users can read ticket comments" on public.ticket_comments;
create policy "Authorized users can read ticket comments"
on public.ticket_comments
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets ticket
    join public.reports report on report.id = ticket.report_id
    where ticket.id = ticket_comments.ticket_id
      and (
        (report.user_id = (select auth.uid()) and ticket_comments.visibility = 'citizen')
        or private.is_institution_member(ticket.institution_id)
        or private.is_platform_admin()
      )
  )
);

revoke all on public.ticket_comments from anon;
revoke insert, update, delete on public.ticket_comments from authenticated;
grant select on public.ticket_comments to authenticated;
grant select, insert, update, delete on public.ticket_comments to service_role;

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
  previous_assignee uuid;
  assignment_event text;
  event_actor_type text;
begin
  select * into target_ticket
  from public.tickets ticket
  where ticket.id = target_ticket_id
  for update;

  if target_ticket.id is null then
    raise exception 'Ticket not found.';
  end if;

  if private.is_platform_admin() then
    event_actor_type := 'admin';
  elsif exists (
    select 1
    from public.institution_members member
    join public.institutions institution on institution.id = member.institution_id
    where member.institution_id = target_ticket.institution_id
      and member.user_id = (select auth.uid())
      and member.active = true
      and member.role in ('supervisor', 'institution_admin')
      and institution.status = 'active'
  ) then
    event_actor_type := 'institution';
  else
    raise exception 'Only a supervisor or institution administrator can assign tickets.';
  end if;

  if target_ticket.status not in ('acknowledged', 'assigned', 'in_progress', 'reopened') then
    raise exception 'A ticket must be acknowledged and active before assignment.';
  end if;

  if not exists (
    select 1
    from public.institution_members member
    where member.institution_id = target_ticket.institution_id
      and member.user_id = target_assignee_id
      and member.active = true
      and member.role <> 'viewer'
  ) then
    raise exception 'The assignee is not an active operational member of this institution.';
  end if;

  if target_ticket.assigned_to = target_assignee_id then
    ticket_id := target_ticket.id;
    ticket_code := target_ticket.ticket_code;
    ticket_status := target_ticket.status;
    assigned_to := target_ticket.assigned_to;
    return next;
    return;
  end if;

  previous_status := target_ticket.status;
  previous_assignee := target_ticket.assigned_to;
  assignment_event := case when previous_assignee is null then 'assigned' else 'reassigned' end;

  update public.tickets
  set assigned_to = target_assignee_id,
      assigned_by = (select auth.uid()),
      assigned_at = now(),
      status = case when status = 'in_progress' then status else 'assigned' end,
      state_version = state_version + 1,
      updated_at = now()
  where id = target_ticket.id
  returning * into target_ticket;

  update public.reports
  set status = target_ticket.status, updated_at = now()
  where id = target_ticket.report_id;

  insert into public.ticket_events (
    ticket_id, actor_user_id, actor_type, actor_institution_id,
    event_type, from_status, to_status, note, visibility, metadata
  ) values (
    target_ticket.id,
    (select auth.uid()),
    event_actor_type,
    case when event_actor_type = 'institution' then target_ticket.institution_id else null end,
    assignment_event,
    previous_status,
    target_ticket.status,
    case when assignment_event = 'assigned'
      then 'The institution assigned this ticket to a team member.'
      else 'The institution reassigned this ticket to another team member.'
    end,
    'citizen',
    jsonb_build_object(
      'source', 'institution_workspace',
      'previous_assignee_id', previous_assignee,
      'assignee_id', target_assignee_id,
      'state_version', target_ticket.state_version
    )
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

create or replace function public.add_ticket_comment(
  target_ticket_id uuid,
  target_visibility text,
  comment_body text
)
returns table (
  comment_id uuid,
  ticket_id uuid,
  visibility text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.tickets;
  inserted_comment public.ticket_comments;
  member_role text;
  event_actor_type text;
  clean_body text;
begin
  if target_visibility not in ('internal', 'citizen') then
    raise exception 'Comment visibility must be internal or citizen.';
  end if;

  clean_body := btrim(coalesce(comment_body, ''));
  if char_length(clean_body) not between 2 and 2000 then
    raise exception 'Comments must contain between 2 and 2,000 characters.';
  end if;

  select * into target_ticket
  from public.tickets ticket
  where ticket.id = target_ticket_id;

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
    raise exception 'Current user cannot add notes to this ticket.';
  end if;

  if target_ticket.status in ('closed', 'cancelled') then
    raise exception 'Notes cannot be added to a terminal ticket.';
  end if;

  insert into public.ticket_comments (
    ticket_id, author_user_id, author_institution_id, visibility, body
  ) values (
    target_ticket.id,
    (select auth.uid()),
    case when event_actor_type = 'institution' then target_ticket.institution_id else null end,
    target_visibility,
    clean_body
  ) returning * into inserted_comment;

  insert into public.ticket_events (
    ticket_id, actor_user_id, actor_type, actor_institution_id,
    event_type, from_status, to_status, note, visibility, metadata
  ) values (
    target_ticket.id,
    (select auth.uid()),
    event_actor_type,
    case when event_actor_type = 'institution' then target_ticket.institution_id else null end,
    case when target_visibility = 'internal' then 'internal_note_added' else 'citizen_update_added' end,
    target_ticket.status,
    target_ticket.status,
    clean_body,
    target_visibility,
    jsonb_build_object('source', 'institution_workspace', 'comment_id', inserted_comment.id)
  );

  update public.tickets set updated_at = now() where id = target_ticket.id;

  comment_id := inserted_comment.id;
  ticket_id := inserted_comment.ticket_id;
  visibility := inserted_comment.visibility;
  created_at := inserted_comment.created_at;
  return next;
end;
$$;

revoke all on function public.add_ticket_comment(uuid, text, text) from public;
grant execute on function public.add_ticket_comment(uuid, text, text) to authenticated;

create or replace function public.request_ticket_transfer(
  target_ticket_id uuid,
  transfer_reason text,
  target_suggested_institution_id uuid default null
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
  target_ticket public.tickets;
  member_role text;
  clean_reason text;
  previous_status text;
begin
  clean_reason := btrim(coalesce(transfer_reason, ''));
  if char_length(clean_reason) not between 12 and 1000 then
    raise exception 'Explain why this is outside your mandate in 12 to 1,000 characters.';
  end if;

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

  if not (
    member_role in ('supervisor', 'institution_admin')
    or (member_role = 'agent' and target_ticket.assigned_to = (select auth.uid()))
  ) then
    raise exception 'Current user cannot request transfer of this ticket.';
  end if;

  if target_ticket.status not in ('routed', 'acknowledged', 'assigned', 'in_progress', 'reopened') then
    raise exception 'This ticket cannot enter routing review from its current state.';
  end if;

  if target_suggested_institution_id is not null and not exists (
    select 1 from public.institutions institution
    where institution.id = target_suggested_institution_id
      and institution.id <> target_ticket.institution_id
      and institution.status = 'active'
      and institution.verified = true
  ) then
    raise exception 'The suggested institution is not active and verified.';
  end if;

  previous_status := target_ticket.status;

  update public.tickets
  set status = 'needs_review',
      assigned_to = null,
      assigned_by = null,
      assigned_at = null,
      transfer_requested_at = now(),
      transfer_requested_by = (select auth.uid()),
      transfer_reason = clean_reason,
      suggested_institution_id = target_suggested_institution_id,
      state_version = state_version + 1,
      updated_at = now()
  where id = target_ticket.id
  returning * into target_ticket;

  update public.reports
  set status = 'needs_review', updated_at = now()
  where id = target_ticket.report_id;

  insert into public.ticket_events (
    ticket_id, actor_user_id, actor_type, actor_institution_id,
    event_type, from_status, to_status, note, visibility, metadata
  ) values
  (
    target_ticket.id, (select auth.uid()), 'institution', target_ticket.institution_id,
    'transfer_requested', previous_status, 'needs_review',
    'The institution requested a routing review. SAUTI1 operations will reassess responsibility.',
    'citizen', jsonb_build_object('source', 'institution_workspace')
  ),
  (
    target_ticket.id, (select auth.uid()), 'institution', target_ticket.institution_id,
    'transfer_review_detail', previous_status, 'needs_review', clean_reason,
    'admin', jsonb_build_object(
      'source', 'institution_workspace',
      'from_institution_id', target_ticket.institution_id,
      'suggested_institution_id', target_suggested_institution_id
    )
  );

  ticket_id := target_ticket.id;
  ticket_code := target_ticket.ticket_code;
  ticket_status := target_ticket.status;
  return next;
end;
$$;

revoke all on function public.request_ticket_transfer(uuid, text, uuid) from public;
grant execute on function public.request_ticket_transfer(uuid, text, uuid) to authenticated;

commit;

-- ============================================================
-- END
-- ============================================================
