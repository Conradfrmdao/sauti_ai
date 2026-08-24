-- ============================================================
-- SAUTI1 AI
-- Read state for draft attention notifications
-- ============================================================

alter table public.reports
add column if not exists attention_read_at timestamptz;

create index if not exists reports_unread_text_drafts_idx
on public.reports (user_id, updated_at desc)
where source = 'text'
  and status in ('draft', 'pending_confirmation')
  and attention_read_at is null;

comment on column public.reports.attention_read_at is
'When the citizen last opened this draft attention item. Null means unread.';

-- Reading an attention item is not a report-content edit. This trigger runs
-- after reports_set_updated_at and restores the prior timestamp when no other
-- report field changed.
create or replace function public.preserve_report_updated_at_for_attention_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    pg_catalog.to_jsonb(new) - 'attention_read_at' - 'updated_at'
  ) is not distinct from (
    pg_catalog.to_jsonb(old) - 'attention_read_at' - 'updated_at'
  ) then
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_reports_preserve_attention_read_updated_at
on public.reports;

create trigger zz_reports_preserve_attention_read_updated_at
before update on public.reports
for each row
execute function public.preserve_report_updated_at_for_attention_read();

-- ============================================================
-- END
-- ============================================================
