-- ============================================================
-- SAUTI1 AI
-- Seed MTN Uganda + Assign Test Institution Admin
--
-- Test account:
-- your-second-email@example.com
--
-- This does NOT modify auth.users manually.
-- It only reads the auth user's UUID and assigns that
-- authenticated user to our institution_members table.
-- ============================================================


do $$
declare
  target_user_id uuid;
  target_institution_id uuid;
begin

  -- ==========================================================
  -- 1. FIND THE EXISTING SUPABASE AUTH USER
  -- ==========================================================

  select id
  into target_user_id
  from auth.users
  where lower(email) =
    lower('your-second-email@example.com')
  limit 1;


  if target_user_id is null then
    raise exception
      'Could not find auth user with email: %',
      'your-second-email@example.com';
  end if;


  -- ==========================================================
  -- 2. CREATE MTN UGANDA IF IT DOES NOT ALREADY EXIST
  -- ==========================================================

  insert into public.institutions (
    name,
    slug,
    sector,
    description,
    status,
    verified
  )
  values (
    'MTN Uganda',
    'mtn-uganda',
    'Telecommunications and Mobile Financial Services',
    'Registered SAUTI1 institution for telecommunications and mobile financial service support.',
    'active',
    true
  )
  on conflict (slug)
  do update
  set
    name = excluded.name,
    sector = excluded.sector,
    description = excluded.description,
    status = 'active',
    verified = true,
    updated_at = now();


  -- ==========================================================
  -- 3. GET MTN UGANDA ID
  -- ==========================================================

  select id
  into target_institution_id
  from public.institutions
  where slug = 'mtn-uganda'
  limit 1;


  if target_institution_id is null then
    raise exception
      'MTN Uganda institution could not be created or located.';
  end if;


  -- ==========================================================
  -- 4. ASSIGN USER TO MTN UGANDA
  -- ==========================================================

  insert into public.institution_members (
    institution_id,
    user_id,
    role,
    department,
    active
  )
  values (
    target_institution_id,
    target_user_id,
    'institution_admin',
    'Customer Experience',
    true
  )
  on conflict (
    institution_id,
    user_id
  )
  do update
  set
    role = 'institution_admin',
    department = 'Customer Experience',
    active = true;


  -- ==========================================================
  -- 5. OUTPUT RESULT
  -- ==========================================================

  raise notice
    'SUCCESS: % assigned to MTN Uganda as institution_admin',
    'your-second-email@example.com';

end $$;


-- ============================================================
-- VERIFICATION
-- ============================================================

select
  i.name as institution,
  i.status,
  i.verified,
  p.full_name,
  u.email,
  im.role,
  im.department,
  im.active

from public.institution_members im

join public.institutions i
  on i.id = im.institution_id

join auth.users u
  on u.id = im.user_id

left join public.profiles p
  on p.id = im.user_id

where lower(u.email) =
  lower('your-second-email@example.com');