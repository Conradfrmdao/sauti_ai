-- ============================================================
-- SAUTI1 AI
-- Private citizen evidence storage
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'report-attachments',
  'report-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Citizens can upload own report evidence"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'report-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
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
          and private.is_institution_member(report.institution_id)
        )
        or private.is_platform_admin()
      )
  )
);

-- Uploaded files can only be removed while their report is still editable.
create policy "Citizens can remove draft report evidence"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'report-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.report_attachments attachment
    join public.reports report on report.id = attachment.report_id
    where attachment.storage_path = storage.objects.name
      and report.user_id = (select auth.uid())
      and report.status in ('draft', 'pending_confirmation')
  )
);
