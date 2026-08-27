-- ============================================================
-- SAUTI1 AI
-- Trusted persistence for anonymous SMS and telephone channels
-- ============================================================

-- A phone number is a channel identity, not an authentication account. A
-- contact can optionally be linked to a real account without manufacturing an
-- auth.users row for an anonymous caller or SMS sender.
create table public.external_channel_contacts (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique
    check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  linked_user_id uuid
    references auth.users(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create trigger external_channel_contacts_set_updated_at
before update on public.external_channel_contacts
for each row
execute function public.set_updated_at();

-- Existing authenticated rows retain their owner. Only phone and SMS records
-- may be anonymous, and those conversations must have an external contact.
alter table public.conversations
  alter column user_id drop not null,
  add column external_contact_id uuid
    references public.external_channel_contacts(id)
    on delete restrict,
  add column provider text,
  add column provider_conversation_id text,
  add column provider_status text,
  add column last_provider_event_at timestamptz,
  add constraint conversations_user_or_external_channel_check
    check (
      user_id is not null
      or channel in ('phone', 'sms')
    ),
  add constraint conversations_external_contact_channel_check
    check (
      (channel in ('phone', 'sms') and external_contact_id is not null)
      or (channel in ('text', 'voice') and external_contact_id is null)
    ),
  add constraint conversations_provider_channel_check
    check (
      (channel = 'phone' and provider = 'twilio')
      or (channel = 'sms' and provider = 'infobip')
      or (channel in ('text', 'voice') and provider is null)
    ),
  add constraint conversations_provider_conversation_id_check
    check (
      provider_conversation_id is null
      or (provider is not null and btrim(provider_conversation_id) <> '')
    ),
  add constraint conversations_provider_status_check
    check (
      provider_status is null
      or (provider is not null and btrim(provider_status) <> '')
    ),
  add constraint conversations_last_provider_event_check
    check (
      last_provider_event_at is null
      or provider is not null
    );

-- A contact may have historical conversations, but at most one active
-- conversation per channel. Provider session ids are independently
-- idempotent whenever a provider supplies one.
create unique index conversations_active_external_channel_uidx
on public.conversations (external_contact_id, channel)
where external_contact_id is not null
  and status = 'active';

create unique index conversations_provider_conversation_uidx
on public.conversations (provider, provider_conversation_id)
where provider is not null
  and provider_conversation_id is not null;

create index conversations_external_contact_updated_at_idx
on public.conversations (external_contact_id, channel, updated_at desc)
where external_contact_id is not null;

create index external_channel_contacts_linked_user_idx
on public.external_channel_contacts (linked_user_id)
where linked_user_id is not null;

-- Reports created by trusted channel adapters may omit user_id. Anonymous web
-- drafts remain impossible: an anonymous report must use a low-tech source and
-- point at the channel conversation that owns its state.
alter table public.reports
  alter column user_id drop not null,
  add constraint reports_user_or_external_channel_check
    check (
      user_id is not null
      or (
        source in ('phone', 'sms')
        and conversation_id is not null
      )
    ),
  add constraint reports_channel_conversation_check
    check (
      source not in ('phone', 'sms')
      or conversation_id is not null
    );

-- Provider identifiers and delivery state live beside the canonical transcript
-- message. Internal transcript-only messages may leave these fields null.
alter table public.messages
  add column provider text,
  add column provider_message_id text,
  add column delivery_status text,
  add column delivered_at timestamptz,
  add constraint messages_provider_check
    check (provider is null or provider in ('twilio', 'infobip')),
  add constraint messages_provider_message_id_check
    check (
      provider_message_id is null
      or (provider is not null and btrim(provider_message_id) <> '')
    ),
  add constraint messages_delivery_status_check
    check (
      delivery_status is null
      or (provider is not null and btrim(delivery_status) <> '')
    ),
  add constraint messages_delivered_at_check
    check (
      delivered_at is null
      or (provider is not null and delivery_status is not null)
    );

create unique index messages_provider_message_uidx
on public.messages (provider, provider_message_id)
where provider is not null
  and provider_message_id is not null;

-- Webhooks are claimed before processing. The provider/event key makes
-- retries idempotent, while payload_hash lets the adapter reject an event id
-- that is unexpectedly reused for different content. updated_at supports
-- recovery of stale or failed processing claims.
create table public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('twilio', 'infobip')),
  event_id text not null
    check (btrim(event_id) <> ''),
  event_type text not null
    check (btrim(event_type) <> ''),
  payload_hash text not null
    check (btrim(payload_hash) <> ''),
  outcome text not null default 'processing'
    check (outcome in ('processing', 'processed', 'failed', 'ignored')),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, event_id)
);

create trigger provider_webhook_events_set_updated_at
before update on public.provider_webhook_events
for each row
execute function public.set_updated_at();

create index provider_webhook_events_retry_idx
on public.provider_webhook_events (outcome, updated_at)
where outcome in ('processing', 'failed');

-- Contact identities and raw provider-event bookkeeping are trusted backend
-- data. RLS is deliberately enabled without anon/authenticated policies.
alter table public.external_channel_contacts enable row level security;
alter table public.provider_webhook_events enable row level security;

revoke all on table public.external_channel_contacts
from public, anon, authenticated;

revoke all on table public.provider_webhook_events
from public, anon, authenticated;

grant select, insert, update, delete
on table public.external_channel_contacts
to service_role;

grant select, insert, update, delete
on table public.provider_webhook_events
to service_role;

-- Submit an SMS/phone report from the trusted channel adapter. This is kept
-- separate from submit_report_to_institution(uuid), whose authenticated-user
-- ownership checks and grants remain unchanged.
create or replace function public.submit_channel_report_to_institution(
  target_report_id uuid
)
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
  target_conversation public.conversations;
  target_contact public.external_channel_contacts;
  target_institution public.institutions;
  existing_ticket public.tickets;
  inserted_ticket public.tickets;
begin
  if target_report_id is null then
    raise exception 'A report id is required.';
  end if;

  -- Lock the report before looking for its ticket so concurrent provider
  -- retries serialize and can only create one ticket in this transaction path.
  select report.*
  into target_report
  from public.reports report
  where report.id = target_report_id
  for update of report;

  if target_report.id is null then
    raise exception 'Channel report not found.';
  end if;

  if target_report.source not in ('sms', 'phone') then
    raise exception 'Only SMS or phone reports can use channel submission.';
  end if;

  if target_report.conversation_id is null then
    raise exception 'A channel report must belong to a conversation.';
  end if;

  select conversation.*
  into target_conversation
  from public.conversations conversation
  where conversation.id = target_report.conversation_id;

  if target_conversation.id is null
     or target_conversation.channel is distinct from target_report.source then
    raise exception 'The report is not linked to its matching channel conversation.';
  end if;

  if target_conversation.external_contact_id is null then
    raise exception 'The channel conversation has no external contact.';
  end if;

  if target_report.user_id is distinct from target_conversation.user_id then
    raise exception 'The report and channel conversation have different users.';
  end if;

  select contact.*
  into target_contact
  from public.external_channel_contacts contact
  where contact.id = target_conversation.external_contact_id;

  if target_contact.id is null then
    raise exception 'The channel conversation has no valid external contact.';
  end if;

  if target_conversation.user_id is distinct from target_contact.linked_user_id then
    raise exception 'The channel user does not match the external contact link.';
  end if;

  if (
    target_report.source = 'sms'
    and target_conversation.provider is distinct from 'infobip'
  ) or (
    target_report.source = 'phone'
    and target_conversation.provider is distinct from 'twilio'
  ) then
    raise exception 'The report channel does not match its provider.';
  end if;

  if target_report.institution_id is null then
    raise exception 'The responsible institution must be confirmed before submission.';
  end if;

  select institution.*
  into target_institution
  from public.institutions institution
  where institution.id = target_report.institution_id
    and institution.status = 'active'
    and institution.verified = true;

  if target_institution.id is null then
    raise exception 'The selected institution is not available for routing.';
  end if;

  select ticket.*
  into existing_ticket
  from public.tickets ticket
  where ticket.report_id = target_report.id
  order by ticket.created_at, ticket.id
  limit 1;

  if existing_ticket.id is not null then
    if existing_ticket.institution_id is distinct from target_institution.id then
      raise exception 'The existing ticket is routed to a different institution.';
    end if;

    update public.conversations
    set
      status = 'closed',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
    where id = target_conversation.id
      and (status <> 'closed' or ended_at is null);

    ticket_id := existing_ticket.id;
    ticket_code := existing_ticket.ticket_code;
    ticket_status := existing_ticket.status;
    institution_id := target_institution.id;
    institution_name := coalesce(
      target_institution.short_name,
      target_institution.name
    );
    return next;
    return;
  end if;

  if target_report.status not in ('draft', 'pending_confirmation') then
    raise exception 'The channel report is not awaiting confirmation and has no ticket.';
  end if;

  update public.reports
  set
    status = 'routed',
    confirmed_at = coalesce(confirmed_at, now()),
    updated_at = now()
  where id = target_report.id;

  insert into public.tickets (
    report_id,
    institution_id,
    category,
    priority,
    status
  )
  values (
    target_report.id,
    target_institution.id,
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
    target_report.user_id,
    'routed',
    target_report.status,
    'routed',
    'Citizen confirmed the report. SAUTI1 routed it to '
      || coalesce(target_institution.short_name, target_institution.name)
      || '.',
    jsonb_build_object(
      'source', target_report.source,
      'ai_confidence', target_report.ai_confidence,
      'institution_slug', target_institution.slug,
      'external_contact_id', target_contact.id,
      'provider', target_conversation.provider
    )
  );

  -- Migration 005 also closes a submitted conversation from the report-status
  -- trigger. Keep this explicit fallback so this RPC owns its full contract.
  update public.conversations
  set
    status = 'closed',
    ended_at = coalesce(ended_at, now()),
    updated_at = now()
  where id = target_conversation.id
    and (status <> 'closed' or ended_at is null);

  ticket_id := inserted_ticket.id;
  ticket_code := inserted_ticket.ticket_code;
  ticket_status := inserted_ticket.status;
  institution_id := target_institution.id;
  institution_name := coalesce(
    target_institution.short_name,
    target_institution.name
  );
  return next;
end;
$$;

revoke all
on function public.submit_channel_report_to_institution(uuid)
from public, anon, authenticated;

grant execute
on function public.submit_channel_report_to_institution(uuid)
to service_role;

-- ============================================================
-- END
-- ============================================================
