-- ============================================================
-- SAUTI1 AI
-- Attachment ownership hardening for server-side AI analysis
-- ============================================================

-- A report may only reference a conversation owned by the same citizen.
-- This prevents a guessed conversation id from ever becoming visible through
-- a later routed report.
drop policy if exists "Citizens can create draft reports" on public.reports;
create policy "Citizens can create draft reports"
on public.reports
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status in ('draft', 'pending_confirmation')
  and exists (
    select 1
    from public.conversations conversation
    where conversation.id = reports.conversation_id
      and conversation.user_id = (select auth.uid())
  )
);

drop policy if exists "Citizens can update unsubmitted reports" on public.reports;
create policy "Citizens can update unsubmitted reports"
on public.reports
for update
to authenticated
using (
  user_id = (select auth.uid())
  and status in ('draft', 'pending_confirmation')
)
with check (
  user_id = (select auth.uid())
  and status in ('draft', 'pending_confirmation')
  and exists (
    select 1
    from public.conversations conversation
    where conversation.id = reports.conversation_id
      and conversation.user_id = (select auth.uid())
  )
);

drop policy if exists "Citizens can upload own report evidence" on storage.objects;
create policy "Citizens can upload own report evidence"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'report-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.reports report
    where report.id::text = (storage.foldername(name))[2]
      and report.user_id = (select auth.uid())
      and report.status in ('draft', 'pending_confirmation')
  )
);

drop policy if exists "Citizens can remove own draft attachment metadata" on public.report_attachments;
create policy "Citizens can remove own draft attachment metadata"
on public.report_attachments
for delete
to authenticated
using (
  uploaded_by = (select auth.uid())
  and exists (
    select 1
    from public.reports report
    where report.id = report_attachments.report_id
      and report.user_id = (select auth.uid())
      and report.status in ('draft', 'pending_confirmation')
  )
);

-- ============================================================
-- END
-- ============================================================
