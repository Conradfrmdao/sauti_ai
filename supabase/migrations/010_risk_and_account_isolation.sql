-- ============================================================
-- SAUTI1 AI
-- Account isolation and institution workflow hardening
-- ============================================================

-- Citizens may edit their own contact information, but only an existing
-- platform admin may change the platform role used by authorization helpers.
create or replace function private.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and not private.is_platform_admin() then
    raise exception 'Only a platform administrator can change account roles.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
before update on public.profiles
for each row execute function private.protect_profile_role();

-- Institution staff must never see a citizen draft. Access begins only after
-- the citizen confirms and the workflow routes the report.
drop policy if exists "Citizens can view own reports" on public.reports;
create policy "Citizens can view own reports"
on public.reports
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (
    institution_id is not null
    and status in ('submitted', 'routed', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')
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
      and report.status in ('submitted', 'routed', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')
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
      and report.status in ('submitted', 'routed', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')
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
          and report.status in ('submitted', 'routed', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')
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
          and report.status in ('submitted', 'routed', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')
          and private.is_institution_member(report.institution_id)
        )
        or private.is_platform_admin()
      )
  )
);

-- Ticket state changes must pass through update_ticket_status so transitions
-- are authorized, validated and recorded in ticket_events.
drop policy if exists "Institution members can update assigned institution tickets" on public.tickets;

-- ============================================================
-- END
-- ============================================================
