-- ============================================================
-- SAUTI1
-- Routing decision audit, review queue and correction history
-- ============================================================

begin;

create table if not exists public.platform_settings (
  key text primary key check (btrim(key) <> ''),
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value)
values ('routing_review_threshold', '0.6'::jsonb)
on conflict (key) do nothing;

create table if not exists public.routing_decisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  engine text not null,
  model_name text,
  prompt_version text,
  rules_version text,
  predicted_institution_id uuid references public.institutions(id) on delete set null,
  predicted_service_id uuid references public.institution_services(id) on delete set null,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  alternative_candidates jsonb not null default '[]'::jsonb,
  routing_evidence jsonb not null default '{}'::jsonb,
  final_institution_id uuid references public.institutions(id) on delete set null,
  final_service_id uuid references public.institution_services(id) on delete set null,
  decision_source text not null
    check (decision_source in ('ai', 'deterministic', 'admin', 'institution_transfer', 'fallback')),
  final_decision_source text
    check (final_decision_source is null or final_decision_source in ('ai', 'deterministic', 'admin', 'institution_transfer', 'fallback')),
  corrected boolean not null default false,
  corrected_by uuid references auth.users(id) on delete set null,
  correction_reason text,
  review_required boolean not null default false,
  review_reasons text[] not null default '{}',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists routing_decisions_ticket_created_idx
  on public.routing_decisions (ticket_id, created_at desc);
create index if not exists routing_decisions_report_created_idx
  on public.routing_decisions (report_id, created_at desc);
create index if not exists routing_decisions_review_queue_idx
  on public.routing_decisions (created_at)
  where review_required = true and reviewed_at is null;
create index if not exists routing_decisions_accuracy_idx
  on public.routing_decisions (decision_source, corrected, created_at desc);

alter table public.platform_settings enable row level security;
alter table public.routing_decisions enable row level security;

drop policy if exists "Platform admins can read platform settings" on public.platform_settings;
create policy "Platform admins can read platform settings"
on public.platform_settings for select to authenticated
using (private.is_platform_admin());

drop policy if exists "Platform admins can read routing decisions" on public.routing_decisions;
create policy "Platform admins can read routing decisions"
on public.routing_decisions for select to authenticated
using (private.is_platform_admin());

revoke all on public.platform_settings from anon;
revoke all on public.routing_decisions from anon;
revoke insert, update, delete on public.platform_settings from authenticated;
revoke insert, update, delete on public.routing_decisions from authenticated;
grant select on public.platform_settings, public.routing_decisions to authenticated;
grant select, insert, update, delete on public.platform_settings, public.routing_decisions to service_role;

create or replace function public.capture_initial_routing_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports;
  target_service_id uuid;
  threshold numeric := 0.6;
  reasons text[] := '{}';
begin
  select * into target_report from public.reports report where report.id = new.report_id;
  select service.id into target_service_id
  from public.institution_services service
  where service.institution_id = new.institution_id
    and service.active = true
    and service.category_key = target_report.detected_category
  order by service.created_at
  limit 1;

  select coalesce((setting.value #>> '{}')::numeric, 0.6) into threshold
  from public.platform_settings setting
  where setting.key = 'routing_review_threshold';
  threshold := coalesce(threshold, 0.6);

  if target_report.ai_confidence is null then reasons := array_append(reasons, 'missing_confidence'); end if;
  if target_report.ai_confidence is not null and target_report.ai_confidence < threshold then reasons := array_append(reasons, 'low_confidence'); end if;
  if target_service_id is null then reasons := array_append(reasons, 'unknown_service'); end if;

  insert into public.routing_decisions (
    report_id, ticket_id, engine, model_name, prompt_version, rules_version,
    predicted_institution_id, predicted_service_id, confidence,
    final_institution_id, final_service_id, decision_source, final_decision_source,
    review_required, review_reasons, routing_evidence
  ) values (
    new.report_id,
    new.id,
    case when target_report.ai_confidence is null then 'deterministic_fallback' else 'sauti1_shared_router' end,
    case when target_report.ai_confidence is null then null else coalesce(current_setting('app.settings.gemini_model', true), 'gemini') end,
    'report-ai-v1',
    'catalog-routing-v1',
    new.institution_id,
    target_service_id,
    target_report.ai_confidence,
    new.institution_id,
    target_service_id,
    case when target_report.ai_confidence is null then 'fallback' else 'ai' end,
    case when target_report.ai_confidence is null then 'fallback' else 'ai' end,
    cardinality(reasons) > 0,
    reasons,
    jsonb_build_object(
      'category', target_report.detected_category,
      'location_text', target_report.location_text,
      'source', target_report.source
    )
  );

  return new;
end;
$$;

drop trigger if exists tickets_capture_routing_decision on public.tickets;
create trigger tickets_capture_routing_decision
after insert on public.tickets
for each row execute function public.capture_initial_routing_decision();

insert into public.routing_decisions (
  report_id, ticket_id, engine, model_name, prompt_version, rules_version,
  predicted_institution_id, predicted_service_id, confidence,
  final_institution_id, final_service_id, decision_source, final_decision_source,
  review_required, review_reasons, routing_evidence, created_at
)
select
  report.id,
  ticket.id,
  case when report.ai_confidence is null then 'legacy_fallback' else 'legacy_ai_router' end,
  case when report.ai_confidence is null then null else 'gemini' end,
  'pre-audit',
  'pre-audit',
  ticket.institution_id,
  service.id,
  report.ai_confidence,
  ticket.institution_id,
  service.id,
  case when report.ai_confidence is null then 'fallback' else 'ai' end,
  case when report.ai_confidence is null then 'fallback' else 'ai' end,
  report.ai_confidence is null or report.ai_confidence < 0.6 or service.id is null,
  array_remove(array[
    case when report.ai_confidence is null then 'missing_confidence' end,
    case when report.ai_confidence is not null and report.ai_confidence < 0.6 then 'low_confidence' end,
    case when service.id is null then 'unknown_service' end
  ], null),
  jsonb_build_object('category', report.detected_category, 'location_text', report.location_text, 'source', report.source),
  ticket.created_at
from public.tickets ticket
join public.reports report on report.id = ticket.report_id
left join lateral (
  select candidate.id
  from public.institution_services candidate
  where candidate.institution_id = ticket.institution_id
    and candidate.active = true
    and candidate.category_key = report.detected_category
  order by candidate.created_at
  limit 1
) service on true
where not exists (
  select 1 from public.routing_decisions decision where decision.ticket_id = ticket.id
);

create or replace function public.mark_routing_review_needed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'needs_review' and old.status is distinct from new.status then
    update public.routing_decisions decision
    set review_required = true,
        review_reasons = case
          when not ('institution_transfer' = any(decision.review_reasons))
            then array_append(decision.review_reasons, 'institution_transfer')
          else decision.review_reasons
        end,
        final_decision_source = 'institution_transfer'
    where decision.id = (
      select latest.id from public.routing_decisions latest
      where latest.ticket_id = new.id
      order by latest.created_at desc
      limit 1
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_mark_routing_review on public.tickets;
create trigger tickets_mark_routing_review
after update of status on public.tickets
for each row execute function public.mark_routing_review_needed();

create or replace function public.reroute_ticket(
  target_ticket_id uuid,
  target_institution_id uuid,
  target_service_id uuid,
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
  next_service public.institution_services;
  previous_institution_id uuid;
  previous_status text;
  clean_note text;
  automated_decision_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Only a platform administrator can reroute tickets.';
  end if;
  if length(coalesce(reroute_note, '')) > 1000 then
    raise exception 'Reroute notes must be 1,000 characters or fewer.';
  end if;

  select * into target_ticket from public.tickets ticket
  where ticket.id = target_ticket_id for update;
  if target_ticket.id is null then raise exception 'Ticket not found.'; end if;
  if target_ticket.status in ('closed', 'cancelled') then
    raise exception 'A closed or cancelled ticket cannot be rerouted.';
  end if;

  select * into next_institution from public.institutions institution
  where institution.id = target_institution_id
    and institution.status = 'active' and institution.verified = true;
  if next_institution.id is null then
    raise exception 'The destination institution is not active and verified.';
  end if;

  if target_service_id is not null then
    select * into next_service from public.institution_services service
    where service.id = target_service_id
      and service.institution_id = next_institution.id
      and service.active = true;
    if next_service.id is null then
      raise exception 'The selected service does not belong to the destination institution.';
    end if;
  end if;

  previous_institution_id := target_ticket.institution_id;
  previous_status := target_ticket.status;
  clean_note := coalesce(nullif(btrim(reroute_note), ''), 'SAUTI1 operations corrected the routing decision.');

  select decision.id into automated_decision_id
  from public.routing_decisions decision
  where decision.ticket_id = target_ticket.id
    and decision.decision_source in ('ai', 'deterministic', 'fallback', 'institution_transfer')
  order by decision.created_at desc
  limit 1 for update;

  if automated_decision_id is not null then
    update public.routing_decisions
    set final_institution_id = next_institution.id,
        final_service_id = next_service.id,
        final_decision_source = 'admin',
        corrected = predicted_institution_id is distinct from next_institution.id
          or predicted_service_id is distinct from next_service.id,
        corrected_by = (select auth.uid()),
        correction_reason = clean_note,
        review_required = false,
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where id = automated_decision_id;
  end if;

  update public.tickets
  set institution_id = next_institution.id,
      category = coalesce(next_service.category_key, category),
      assigned_to = null, assigned_by = null, assigned_at = null,
      status = 'routed', acknowledged_at = null,
      resolution_note = null, resolution_proposed_at = null,
      citizen_resolution_confirmed_at = null, citizen_feedback = null,
      reopen_reason = null, resolved_at = null, closed_at = null,
      transfer_requested_at = null, transfer_requested_by = null,
      transfer_reason = null, suggested_institution_id = null,
      state_version = state_version + 1,
      updated_at = now()
  where id = target_ticket.id returning * into target_ticket;

  update public.reports
  set institution_id = next_institution.id,
      detected_category = coalesce(next_service.category_key, detected_category),
      status = 'routed', updated_at = now()
  where id = target_ticket.report_id;

  insert into public.routing_decisions (
    report_id, ticket_id, engine, rules_version,
    predicted_institution_id, predicted_service_id,
    final_institution_id, final_service_id,
    decision_source, final_decision_source,
    corrected, corrected_by, correction_reason, reviewed_by, reviewed_at
  ) values (
    target_ticket.report_id, target_ticket.id, 'human_review', 'admin-review-v1',
    next_institution.id, next_service.id, next_institution.id, next_service.id,
    'admin', 'admin', false, (select auth.uid()), clean_note, (select auth.uid()), now()
  );

  insert into public.ticket_events (
    ticket_id, actor_user_id, actor_type, event_type,
    from_status, to_status, note, visibility, metadata
  ) values
  (
    target_ticket.id, (select auth.uid()), 'admin', 'rerouted',
    previous_status, 'routed',
    'SAUTI1 operations routed this ticket to ' || coalesce(next_institution.short_name, next_institution.name) || '.',
    'citizen', jsonb_build_object('source', 'admin_workspace')
  ),
  (
    target_ticket.id, (select auth.uid()), 'admin', 'routing_correction_detail',
    previous_status, 'routed', clean_note, 'admin',
    jsonb_build_object(
      'from_institution_id', previous_institution_id,
      'to_institution_id', next_institution.id,
      'service_id', next_service.id,
      'source', 'admin_workspace'
    )
  );

  insert into public.platform_audit_events (actor_user_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'ticket_rerouted', 'ticket', target_ticket.id,
    jsonb_build_object('from_institution_id', previous_institution_id, 'to_institution_id', next_institution.id, 'service_id', next_service.id));

  ticket_id := target_ticket.id;
  ticket_code := target_ticket.ticket_code;
  ticket_status := target_ticket.status;
  institution_id := target_ticket.institution_id;
  return next;
end;
$$;

revoke all on function public.reroute_ticket(uuid, uuid, uuid, text) from public;
grant execute on function public.reroute_ticket(uuid, uuid, uuid, text) to authenticated;

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
language sql
security definer
set search_path = ''
as $$
  select * from public.reroute_ticket(target_ticket_id, target_institution_id, null, reroute_note);
$$;

revoke all on function public.reroute_ticket(uuid, uuid, text) from public;
grant execute on function public.reroute_ticket(uuid, uuid, text) to authenticated;

create or replace function public.approve_routing_decision(
  target_decision_id uuid,
  review_note text default null
)
returns table (decision_id uuid, ticket_id uuid, ticket_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.routing_decisions;
  target_ticket public.tickets;
  clean_note text;
  previous_status text;
begin
  if not private.is_platform_admin() then
    raise exception 'Only a platform administrator can approve routing.';
  end if;
  if length(coalesce(review_note, '')) > 1000 then
    raise exception 'Review notes must be 1,000 characters or fewer.';
  end if;

  select * into decision from public.routing_decisions item
  where item.id = target_decision_id for update;
  if decision.id is null then raise exception 'Routing decision not found.'; end if;

  select * into target_ticket from public.tickets ticket
  where ticket.id = decision.ticket_id for update;
  if target_ticket.status in ('closed', 'cancelled') then
    raise exception 'A closed or cancelled ticket cannot be reviewed.';
  end if;

  clean_note := coalesce(nullif(btrim(review_note), ''), 'SAUTI1 operations approved the routing decision.');
  previous_status := target_ticket.status;
  update public.routing_decisions
  set final_institution_id = target_ticket.institution_id,
      final_decision_source = 'admin',
      review_required = false,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      correction_reason = clean_note
  where id = decision.id;

  if target_ticket.status = 'needs_review' then
    update public.tickets
    set status = 'routed',
        transfer_requested_at = null, transfer_requested_by = null,
        transfer_reason = null, suggested_institution_id = null,
        state_version = state_version + 1, updated_at = now()
    where id = target_ticket.id returning * into target_ticket;
    update public.reports set status = 'routed', updated_at = now()
    where id = target_ticket.report_id;
  end if;

  insert into public.ticket_events (
    ticket_id, actor_user_id, actor_type, event_type,
    from_status, to_status, note, visibility, metadata
  ) values (
    target_ticket.id, (select auth.uid()), 'admin', 'routing_approved',
    previous_status, target_ticket.status,
    'SAUTI1 operations reviewed and approved the current route.',
    'citizen', jsonb_build_object('source', 'admin_workspace', 'decision_id', decision.id)
  );

  insert into public.platform_audit_events (actor_user_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'routing_approved', 'routing_decision', decision.id,
    jsonb_build_object('ticket_id', target_ticket.id));

  decision_id := decision.id;
  ticket_id := target_ticket.id;
  ticket_status := target_ticket.status;
  return next;
end;
$$;

revoke all on function public.approve_routing_decision(uuid, text) from public;
grant execute on function public.approve_routing_decision(uuid, text) to authenticated;

commit;

-- ============================================================
-- END
-- ============================================================
