-- ============================================================
-- SAUTI1 AI
-- Core Database Foundation
--
-- Phase 1:
-- - Profiles
-- - Institutions
-- - Institution members
-- - Conversations
-- - Messages
-- - Reports
-- - Attachments metadata
-- - Tickets
-- - Ticket history
-- - Row Level Security
--
-- IMPORTANT:
-- Run this once on a fresh SAUTI1 Supabase project.
-- ============================================================


-- ============================================================
-- 1. PRIVATE SCHEMA
--
-- Internal helper functions live here instead of the public
-- API-facing schema.
-- ============================================================

create schema if not exists private;


-- ============================================================
-- 2. UPDATED_AT HELPER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- 3. PROFILES
--
-- auth.users handles authentication.
-- public.profiles stores SAUTI1-specific user information.
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,

  full_name text,

  phone text,

  avatar_url text,

  role text not null default 'citizen'
    check (
      role in (
        'citizen',
        'admin'
      )
    ),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


-- ============================================================
-- 4. CREATE PROFILE WHEN USER SIGNS UP
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin

  insert into public.profiles (
    id,
    full_name,
    phone
  )
  values (
    new.id,

    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),

    new.phone
  );

  return new;

end;
$$;


create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();


-- ============================================================
-- 5. INSTITUTIONS
-- ============================================================

create table public.institutions (
  id uuid primary key default gen_random_uuid(),

  name text not null,

  slug text not null unique,

  sector text not null,

  description text,

  logo_url text,

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'active',
        'suspended'
      )
    ),

  verified boolean not null default false,

  created_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create trigger institutions_set_updated_at
before update on public.institutions
for each row
execute function public.set_updated_at();


-- ============================================================
-- 6. INSTITUTION MEMBERS
--
-- Institution staff roles live here.
-- They are separate from platform-wide profile roles.
-- ============================================================

create table public.institution_members (
  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  role text not null default 'agent'
    check (
      role in (
        'agent',
        'supervisor',
        'institution_admin'
      )
    ),

  department text,

  active boolean not null default true,

  created_at timestamptz not null default now(),

  primary key (
    institution_id,
    user_id
  )
);


-- ============================================================
-- 7. CONVERSATIONS
--
-- One conversation may originate from:
-- - text AI
-- - voice AI
-- - normal telephone call
-- - SMS
-- ============================================================

create table public.conversations (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  channel text not null
    check (
      channel in (
        'text',
        'voice',
        'phone',
        'sms'
      )
    ),

  title text,

  status text not null default 'active'
    check (
      status in (
        'active',
        'closed'
      )
    ),

  started_at timestamptz not null default now(),

  ended_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create trigger conversations_set_updated_at
before update on public.conversations
for each row
execute function public.set_updated_at();


-- ============================================================
-- 8. MESSAGES
--
-- Stores conversation transcript/history.
--
-- Actual voice audio is NOT stored here.
-- Audio files later go into object storage.
-- ============================================================

create table public.messages (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
    references public.conversations(id)
    on delete cascade,

  sender_type text not null
    check (
      sender_type in (
        'citizen',
        'ai',
        'institution_agent',
        'system'
      )
    ),

  sender_user_id uuid
    references auth.users(id)
    on delete set null,

  body text not null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);


-- ============================================================
-- 9. REPORTS
--
-- This is what the citizen actually reported.
--
-- Citizens never manually choose category/institution.
-- Those internal fields are filled by SAUTI1 AI.
-- ============================================================

create table public.reports (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  conversation_id uuid
    references public.conversations(id)
    on delete set null,

  institution_id uuid
    references public.institutions(id)
    on delete set null,

  description text not null,

  ai_summary text,

  detected_category text,

  priority text not null default 'normal'
    check (
      priority in (
        'low',
        'normal',
        'high',
        'critical'
      )
    ),

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'pending_confirmation',
        'submitted',
        'routed',
        'acknowledged',
        'in_progress',
        'resolved',
        'closed',
        'rejected'
      )
    ),

  source text not null
    check (
      source in (
        'text',
        'voice',
        'phone',
        'sms'
      )
    ),

  ai_confidence numeric(5,4)
    check (
      ai_confidence is null
      or (
        ai_confidence >= 0
        and ai_confidence <= 1
      )
    ),

  -- Human readable / AI normalized location

  location_text text,

  -- GPS coordinates

  latitude numeric(9,6),

  longitude numeric(9,6),

  location_confidence numeric(5,4)
    check (
      location_confidence is null
      or (
        location_confidence >= 0
        and location_confidence <= 1
      )
    ),

  confirmed_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create trigger reports_set_updated_at
before update on public.reports
for each row
execute function public.set_updated_at();


-- ============================================================
-- 10. REPORT ATTACHMENTS
--
-- Files themselves will later live in Supabase Storage.
-- This table stores their metadata and relationship.
-- ============================================================

create table public.report_attachments (
  id uuid primary key default gen_random_uuid(),

  report_id uuid not null
    references public.reports(id)
    on delete cascade,

  uploaded_by uuid not null
    references auth.users(id)
    on delete cascade,

  storage_path text not null,

  original_name text,

  mime_type text,

  size_bytes bigint,

  attachment_type text
    check (
      attachment_type in (
        'image',
        'video',
        'document',
        'audio',
        'other'
      )
    ),

  ai_analysis jsonb,

  created_at timestamptz not null default now()
);


-- ============================================================
-- 11. TICKET NUMBER SEQUENCE
-- ============================================================

create sequence public.ticket_code_sequence
start with 1
increment by 1;


-- ============================================================
-- 12. TICKETS
--
-- Report = what citizen told SAUTI1.
-- Ticket = actionable case sent to an institution.
-- ============================================================

create table public.tickets (
  id uuid primary key default gen_random_uuid(),

  ticket_code text not null unique,

  report_id uuid not null
    references public.reports(id)
    on delete restrict,

  institution_id uuid not null
    references public.institutions(id)
    on delete restrict,

  assigned_to uuid
    references auth.users(id)
    on delete set null,

  category text,

  priority text not null default 'normal'
    check (
      priority in (
        'low',
        'normal',
        'high',
        'critical'
      )
    ),

  status text not null default 'submitted'
    check (
      status in (
        'submitted',
        'routed',
        'acknowledged',
        'assigned',
        'in_progress',
        'resolved',
        'closed',
        'rejected'
      )
    ),

  acknowledged_at timestamptz,

  resolved_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create trigger tickets_set_updated_at
before update on public.tickets
for each row
execute function public.set_updated_at();


-- ============================================================
-- 13. AUTOMATIC TICKET CODE
--
-- Example:
--
-- SA1-2026-000001
-- SA1-2026-000002
-- ============================================================

create or replace function public.generate_ticket_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  next_number bigint;
begin

  if new.ticket_code is null
     or trim(new.ticket_code) = '' then

    next_number :=
      nextval(
        'public.ticket_code_sequence'
      );

    new.ticket_code :=
      'SA1-'
      ||
      to_char(
        now(),
        'YYYY'
      )
      ||
      '-'
      ||
      lpad(
        next_number::text,
        6,
        '0'
      );

  end if;

  return new;

end;
$$;


create trigger tickets_generate_code
before insert on public.tickets
for each row
execute function public.generate_ticket_code();


-- ============================================================
-- 14. TICKET EVENTS
--
-- Full history:
--
-- submitted
-- routed
-- acknowledged
-- assigned
-- in_progress
-- resolved
-- closed
-- ============================================================

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),

  ticket_id uuid not null
    references public.tickets(id)
    on delete cascade,

  actor_user_id uuid
    references auth.users(id)
    on delete set null,

  event_type text not null,

  from_status text,

  to_status text,

  note text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);


-- ============================================================
-- 15. INDEXES
-- ============================================================

create index institution_members_user_id_idx
on public.institution_members(user_id);


create index conversations_user_id_idx
on public.conversations(user_id);


create index conversations_created_at_idx
on public.conversations(created_at desc);


create index messages_conversation_id_created_at_idx
on public.messages(
  conversation_id,
  created_at
);


create index reports_user_id_created_at_idx
on public.reports(
  user_id,
  created_at desc
);


create index reports_institution_status_idx
on public.reports(
  institution_id,
  status
);


create index reports_status_idx
on public.reports(status);


create index report_attachments_report_id_idx
on public.report_attachments(report_id);


create index tickets_institution_status_idx
on public.tickets(
  institution_id,
  status
);


create index tickets_report_id_idx
on public.tickets(report_id);


create index tickets_created_at_idx
on public.tickets(created_at desc);


create index ticket_events_ticket_id_created_at_idx
on public.ticket_events(
  ticket_id,
  created_at
);


-- ============================================================
-- 16. SECURITY HELPER FUNCTIONS
-- ============================================================


-- ------------------------------------------------------------
-- Is current user a SAUTI1 platform admin?
-- ------------------------------------------------------------

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$

  select exists (

    select 1

    from public.profiles p

    where p.id = (
      select auth.uid()
    )

    and p.role = 'admin'

  );

$$;


-- ------------------------------------------------------------
-- Is current user part of institution?
-- ------------------------------------------------------------

create or replace function private.is_institution_member(
  target_institution_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$

  select exists (

    select 1

    from public.institution_members im

    where im.institution_id =
      target_institution_id

    and im.user_id = (
      select auth.uid()
    )

    and im.active = true

  );

$$;


-- ------------------------------------------------------------
-- Is current user an institution admin?
-- ------------------------------------------------------------

create or replace function private.is_institution_admin(
  target_institution_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$

  select exists (

    select 1

    from public.institution_members im

    where im.institution_id =
      target_institution_id

    and im.user_id = (
      select auth.uid()
    )

    and im.role =
      'institution_admin'

    and im.active = true

  );

$$;


grant usage on schema private
to authenticated;


grant execute
on function private.is_platform_admin()
to authenticated;


grant execute
on function private.is_institution_member(uuid)
to authenticated;


grant execute
on function private.is_institution_admin(uuid)
to authenticated;


-- ============================================================
-- 17. ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles
enable row level security;


alter table public.institutions
enable row level security;


alter table public.institution_members
enable row level security;


alter table public.conversations
enable row level security;


alter table public.messages
enable row level security;


alter table public.reports
enable row level security;


alter table public.report_attachments
enable row level security;


alter table public.tickets
enable row level security;


alter table public.ticket_events
enable row level security;


-- ============================================================
-- 18. PROFILE POLICIES
-- ============================================================

create policy
"Users can read own profile"
on public.profiles
for select
to authenticated
using (
  id = (
    select auth.uid()
  )
  or private.is_platform_admin()
);


create policy
"Users can update own profile"
on public.profiles
for update
to authenticated
using (
  id = (
    select auth.uid()
  )
  or private.is_platform_admin()
)
with check (
  id = (
    select auth.uid()
  )
  or private.is_platform_admin()
);


-- ============================================================
-- 19. INSTITUTION POLICIES
-- ============================================================

create policy
"Authenticated users can view available institutions"
on public.institutions
for select
to authenticated
using (

  (
    status = 'active'
    and verified = true
  )

  or private.is_institution_member(id)

  or private.is_platform_admin()

);


create policy
"Platform admins can create institutions"
on public.institutions
for insert
to authenticated
with check (
  private.is_platform_admin()
);


create policy
"Platform admins can update institutions"
on public.institutions
for update
to authenticated
using (
  private.is_platform_admin()
)
with check (
  private.is_platform_admin()
);


create policy
"Platform admins can delete institutions"
on public.institutions
for delete
to authenticated
using (
  private.is_platform_admin()
);


-- ============================================================
-- 20. INSTITUTION MEMBER POLICIES
-- ============================================================

create policy
"Institution members can view their team"
on public.institution_members
for select
to authenticated
using (

  user_id = (
    select auth.uid()
  )

  or private.is_institution_member(
    institution_id
  )

  or private.is_platform_admin()

);


create policy
"Institution admins can add team members"
on public.institution_members
for insert
to authenticated
with check (

  private.is_institution_admin(
    institution_id
  )

  or private.is_platform_admin()

);


create policy
"Institution admins can update team members"
on public.institution_members
for update
to authenticated
using (

  private.is_institution_admin(
    institution_id
  )

  or private.is_platform_admin()

)
with check (

  private.is_institution_admin(
    institution_id
  )

  or private.is_platform_admin()

);


create policy
"Institution admins can remove team members"
on public.institution_members
for delete
to authenticated
using (

  private.is_institution_admin(
    institution_id
  )

  or private.is_platform_admin()

);


-- ============================================================
-- 21. CONVERSATION POLICIES
-- ============================================================

create policy
"Citizens can read own conversations"
on public.conversations
for select
to authenticated
using (

  user_id = (
    select auth.uid()
  )

  or private.is_platform_admin()

);


create policy
"Citizens can create own conversations"
on public.conversations
for insert
to authenticated
with check (
  user_id = (
    select auth.uid()
  )
);


create policy
"Citizens can update own conversations"
on public.conversations
for update
to authenticated
using (
  user_id = (
    select auth.uid()
  )
)
with check (
  user_id = (
    select auth.uid()
  )
);


-- ============================================================
-- 22. MESSAGE POLICIES
-- ============================================================

create policy
"Citizens can read messages in own conversations"
on public.messages
for select
to authenticated
using (

  exists (

    select 1

    from public.conversations c

    where c.id =
      messages.conversation_id

    and c.user_id = (
      select auth.uid()
    )

  )

  or private.is_platform_admin()

);


create policy
"Citizens can create their own messages"
on public.messages
for insert
to authenticated
with check (

  sender_type = 'citizen'

  and sender_user_id = (
    select auth.uid()
  )

  and exists (

    select 1

    from public.conversations c

    where c.id =
      messages.conversation_id

    and c.user_id = (
      select auth.uid()
    )

  )

);


-- ============================================================
-- 23. REPORT POLICIES
-- ============================================================

create policy
"Citizens can view own reports"
on public.reports
for select
to authenticated
using (

  user_id = (
    select auth.uid()
  )

  or (
    institution_id is not null

    and private.is_institution_member(
      institution_id
    )
  )

  or private.is_platform_admin()

);


create policy
"Citizens can create draft reports"
on public.reports
for insert
to authenticated
with check (

  user_id = (
    select auth.uid()
  )

  and status in (
    'draft',
    'pending_confirmation'
  )

);


create policy
"Citizens can update unsubmitted reports"
on public.reports
for update
to authenticated
using (

  user_id = (
    select auth.uid()
  )

  and status in (
    'draft',
    'pending_confirmation'
  )

)
with check (

  user_id = (
    select auth.uid()
  )

);


-- ============================================================
-- 24. ATTACHMENT POLICIES
-- ============================================================

create policy
"Users can view authorized report attachments"
on public.report_attachments
for select
to authenticated
using (

  exists (

    select 1

    from public.reports r

    where r.id =
      report_attachments.report_id

    and (

      r.user_id = (
        select auth.uid()
      )

      or (
        r.institution_id is not null

        and private.is_institution_member(
          r.institution_id
        )
      )

      or private.is_platform_admin()

    )

  )

);


create policy
"Citizens can create attachments for own draft reports"
on public.report_attachments
for insert
to authenticated
with check (

  uploaded_by = (
    select auth.uid()
  )

  and exists (

    select 1

    from public.reports r

    where r.id =
      report_attachments.report_id

    and r.user_id = (
      select auth.uid()
    )

    and r.status in (
      'draft',
      'pending_confirmation'
    )

  )

);


-- ============================================================
-- 25. TICKET POLICIES
--
-- Authenticated users cannot directly create tickets.
--
-- Ticket creation will happen through the trusted SAUTI1
-- server/AI workflow later.
-- ============================================================

create policy
"Citizens and institutions can view authorized tickets"
on public.tickets
for select
to authenticated
using (

  exists (

    select 1

    from public.reports r

    where r.id =
      tickets.report_id

    and r.user_id = (
      select auth.uid()
    )

  )

  or private.is_institution_member(
    institution_id
  )

  or private.is_platform_admin()

);


create policy
"Institution members can update assigned institution tickets"
on public.tickets
for update
to authenticated
using (

  private.is_institution_member(
    institution_id
  )

  or private.is_platform_admin()

)
with check (

  private.is_institution_member(
    institution_id
  )

  or private.is_platform_admin()

);


-- ============================================================
-- 26. TICKET EVENT POLICIES
-- ============================================================

create policy
"Authorized users can view ticket history"
on public.ticket_events
for select
to authenticated
using (

  exists (

    select 1

    from public.tickets t

    join public.reports r
      on r.id = t.report_id

    where t.id =
      ticket_events.ticket_id

    and (

      r.user_id = (
        select auth.uid()
      )

      or private.is_institution_member(
        t.institution_id
      )

      or private.is_platform_admin()

    )

  )

);


-- ============================================================
-- END OF SAUTI1 CORE SCHEMA
-- ============================================================