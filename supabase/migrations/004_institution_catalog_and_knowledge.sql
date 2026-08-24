-- ============================================================
-- SAUTI1 AI
-- Institution catalogue, verified knowledge and Uganda places
-- ============================================================

alter table public.institutions
  add column if not exists short_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists website_url text,
  add column if not exists source_url text,
  add column if not exists routing_keywords text[] not null default '{}',
  add column if not exists onboarding_state text not null default 'catalogued';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'institutions_onboarding_state_check'
  ) then
    alter table public.institutions
      add constraint institutions_onboarding_state_check
      check (onboarding_state in ('catalogued', 'invited', 'onboarded'));
  end if;
end;
$$;

create table if not exists public.institution_services (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null,
  category_key text not null,
  routing_keywords text[] not null default '{}',
  required_fields text[] not null default '{}',
  source_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, slug)
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  slug text not null,
  title text not null,
  document_type text not null default 'official_information'
    check (document_type in ('contact', 'service_scope', 'faq', 'process', 'fraud_warning', 'policy', 'official_information')),
  content text not null,
  source_url text not null,
  status text not null default 'verified'
    check (status in ('draft', 'verified', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, slug)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.locations(id) on delete set null,
  name text not null,
  normalized_name text not null,
  location_type text not null
    check (location_type in ('country', 'region', 'sub_region', 'district', 'city', 'municipality', 'division', 'subcounty', 'parish', 'village', 'neighborhood', 'landmark')),
  region_name text,
  district_name text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  source_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists locations_identity_idx
on public.locations (location_type, normalized_name, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.location_aliases (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'common'
    check (alias_type in ('common', 'abbreviation', 'transcription', 'former_name')),
  created_at timestamptz not null default now(),
  unique (location_id, normalized_alias)
);

create index if not exists institution_services_routing_idx
on public.institution_services using gin (routing_keywords);

create index if not exists institutions_routing_idx
on public.institutions using gin (routing_keywords);

create index if not exists locations_normalized_name_idx
on public.locations (normalized_name);

create index if not exists location_aliases_normalized_idx
on public.location_aliases (normalized_alias);

drop trigger if exists institution_services_set_updated_at on public.institution_services;
create trigger institution_services_set_updated_at
before update on public.institution_services
for each row execute function public.set_updated_at();

drop trigger if exists knowledge_documents_set_updated_at on public.knowledge_documents;
create trigger knowledge_documents_set_updated_at
before update on public.knowledge_documents
for each row execute function public.set_updated_at();

drop trigger if exists locations_set_updated_at on public.locations;
create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

alter table public.institution_services enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.locations enable row level security;
alter table public.location_aliases enable row level security;

drop policy if exists "Authenticated users can read active institution services" on public.institution_services;
create policy "Authenticated users can read active institution services"
on public.institution_services for select to authenticated
using (active or private.is_institution_member(institution_id) or private.is_platform_admin());

drop policy if exists "Institution admins can manage services" on public.institution_services;
create policy "Institution admins can manage services"
on public.institution_services for all to authenticated
using (private.is_institution_admin(institution_id) or private.is_platform_admin())
with check (private.is_institution_admin(institution_id) or private.is_platform_admin());

drop policy if exists "Authenticated users can read verified knowledge" on public.knowledge_documents;
create policy "Authenticated users can read verified knowledge"
on public.knowledge_documents for select to authenticated
using (status = 'verified' or private.is_institution_member(institution_id) or private.is_platform_admin());

drop policy if exists "Institution admins can manage knowledge" on public.knowledge_documents;
create policy "Institution admins can manage knowledge"
on public.knowledge_documents for all to authenticated
using (private.is_institution_admin(institution_id) or private.is_platform_admin())
with check (private.is_institution_admin(institution_id) or private.is_platform_admin());

drop policy if exists "Authenticated users can read Uganda locations" on public.locations;
create policy "Authenticated users can read Uganda locations"
on public.locations for select to authenticated using (active);

drop policy if exists "Platform admins can manage locations" on public.locations;
create policy "Platform admins can manage locations"
on public.locations for all to authenticated
using (private.is_platform_admin()) with check (private.is_platform_admin());

drop policy if exists "Authenticated users can read location aliases" on public.location_aliases;
create policy "Authenticated users can read location aliases"
on public.location_aliases for select to authenticated using (true);

drop policy if exists "Platform admins can manage location aliases" on public.location_aliases;
create policy "Platform admins can manage location aliases"
on public.location_aliases for all to authenticated
using (private.is_platform_admin()) with check (private.is_platform_admin());

-- Catalogue entries are verified from official institution or regulator sources.
-- 'catalogued' means routable in SAUTI1; it does not claim a staff partnership.
insert into public.institutions (
  name, short_name, slug, sector, description, status, verified,
  contact_email, contact_phone, website_url, source_url, routing_keywords,
  onboarding_state
)
values
  ('MTN Uganda Limited', 'MTN Uganda', 'mtn-uganda', 'Telecommunications', 'Mobile network, internet, airtime, data and MTN Mobile Money services.', 'active', true, 'customerservice.ug@mtn.com', '100 / +256 771 001 000', 'https://www.mtn.co.ug', 'https://www.mtn.co.ug/about-mtn/contact-us/', array['mtn','momo','mobile money','airtime','data bundle','sim card','network','internet'], 'onboarded'),
  ('Airtel Uganda Limited', 'Airtel Uganda', 'airtel-uganda', 'Telecommunications', 'Mobile network, internet, airtime, data and Airtel Money services.', 'active', true, 'customercare@ug.airtel.com', '100 / +256 200 202 003', 'https://www.airtel.co.ug', 'https://www.airtel.co.ug/ugneedmoreofyou/contact-us', array['airtel','airtel money','airtime','data bundle','sim card','network','internet'], 'catalogued'),
  ('National Water and Sewerage Corporation', 'NWSC', 'nwsc-uganda', 'Water and sanitation', 'Public water supply, sewerage, billing, leaks and service interruption support.', 'active', true, 'info@nwsc.co.ug', '0800 200 977 / 0800 300 977', 'https://www.nwsc.co.ug', 'https://www.nwsc.co.ug/contact-us/', array['nwsc','water','sewerage','water bill','water outage','no water','pipe burst','leak'], 'catalogued'),
  ('Uganda Electricity Distribution Company Limited', 'UEDCL', 'uedcl-uganda', 'Electricity', 'National electricity distribution, connections, meters, billing and outage response.', 'active', true, 'contact@uedcl.co.ug', '0800 203 088 / +256 312 330 300', 'https://www.uedcl.co.ug', 'https://www.uedcl.co.ug/contact-us/', array['uedcl','electricity','power','yaka','meter','transformer','blackout','outage','no power','connection'], 'catalogued'),
  ('National Environment Management Authority', 'NEMA', 'nema-uganda', 'Environment', 'Environmental regulation, pollution, waste, wetlands and environmental incident reporting.', 'active', true, 'info@nema.go.ug', '0800 144 444 / +256 414 251 064', 'https://www.nema.go.ug', 'https://www.nema.go.ug/en/contact-us-3/', array['nema','environment','pollution','waste','wetland','noise','toxic','environmental incident'], 'catalogued'),
  ('National Forestry Authority', 'NFA', 'nfa-uganda', 'Forestry', 'Management and protection of Uganda central forest reserves and forestry resources.', 'active', true, 'info@nfa.org.ug', '0800 264 036 / +256 312 264 035', 'https://www.nfa.go.ug', 'https://nfa.go.ug/contact/', array['nfa','forest','forestry','tree cutting','deforestation','logging','forest reserve','timber'], 'catalogued'),
  ('National Identification and Registration Authority', 'NIRA', 'nira-uganda', 'Identity and civil registration', 'National identification, NIN, national ID cards and birth and death registration.', 'active', true, 'info@nira.go.ug', '0800 211 700 / +256 312 119 600', 'https://www.nira.go.ug', 'https://www.nira.go.ug/contact-us', array['nira','nin','national id','identity card','birth certificate','death registration','id renewal','id replacement'], 'catalogued'),
  ('Uganda Revenue Authority', 'URA', 'ura-uganda', 'Tax and customs', 'Tax registration, TIN, returns, payments, customs, motor vehicle tax services and whistleblowing.', 'active', true, 'services@ura.go.ug', '0800 117 000 / 0800 217 000', 'https://ura.go.ug', 'https://ura.go.ug/en/contact-us/', array['ura','tax','tin','customs','efris','tax return','stamp duty','tax payment','motor vehicle tax'], 'catalogued'),
  ('Uganda Bureau of Statistics', 'UBOS', 'ubos-uganda', 'Official statistics', 'Official national statistics, surveys, census data and statistical information.', 'active', true, 'ubos@ubos.org', '+256 414 706 000 / WhatsApp +256 750 747 176', 'https://www.ubos.org', 'https://www.ubos.org/contact-us-2/', array['ubos','statistics','census','survey','population','official data'], 'catalogued'),
  ('Uganda National Examinations Board', 'UNEB', 'uneb-uganda', 'Education and examinations', 'National examinations, results, verification, equating and examination-centre services.', 'active', true, 'uneb@uneb.ac.ug', '0800 211 077 / 0800 111 427', 'https://uneb.ac.ug', 'https://eservices.uneb.ac.ug/es/lvr/g/contacts', array['uneb','exam','examination','results','certificate','verification','equating','candidate','school centre'], 'catalogued'),
  ('Ministry of Works and Transport', 'MoWT', 'ministry-works-transport-uganda', 'Roads and transport', 'National roads, bridges, ferries, road safety and transport regulation, including former UNRA functions.', 'active', true, 'mowt@works.go.ug', '+256 414 259 139', 'https://works.go.ug', 'https://works.go.ug/contact-us/', array['ministry of works','mowt','unra','national road','highway','bridge','ferry','pothole','road damage','road safety'], 'catalogued'),
  ('Bank of Uganda', 'BoU', 'bank-of-uganda', 'Financial regulation', 'Central bank and regulator for licensed banks and supervised financial institutions.', 'active', true, 'info@bou.or.ug', '0800 144 044 / +256 414 258 441', 'https://bou.or.ug', 'https://bou.or.ug/supervision', array['bank of uganda','bou','bank regulator','licensed bank','financial institution complaint'], 'catalogued'),
  ('Absa Bank Uganda Limited', 'Absa Uganda', 'absa-bank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, 'absa.uganda@absa.africa', '0800 222 333', 'https://www.absa.co.ug', 'https://bou.or.ug/supervision', array['absa','barclays','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Bank of Africa Uganda Limited', 'Bank of Africa Uganda', 'bank-of-africa-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, 'feedback@boauganda.com', '0800 100 140 / +256 414 302 001', 'https://boauganda.com', 'https://bou.or.ug/supervision', array['bank of africa','boa','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Bank of Baroda Uganda Limited', 'Bank of Baroda Uganda', 'bank-of-baroda-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, 'md.uganda@bankofbaroda.com', '+256 414 232 783', 'https://www.bankofbaroda.ug', 'https://bou.or.ug/supervision', array['bank of baroda','baroda','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Cairo Bank Uganda Limited', 'Cairo Bank Uganda', 'cairo-bank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, null, null, 'https://cbu.co.ug', 'https://bou.or.ug/Govt_Schemes', array['cairo bank','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Centenary Rural Development Bank Limited', 'Centenary Bank', 'centenary-bank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, null, null, 'https://www.centenarybank.co.ug', 'https://bou.or.ug/Govt_Schemes', array['centenary','centenary bank','cern','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('DFCU Bank Limited', 'DFCU Bank', 'dfcu-bank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, null, null, 'https://www.dfcugroup.com', 'https://bou.or.ug/Govt_Schemes', array['dfcu','dfcu bank','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Diamond Trust Bank Uganda Limited', 'DTB Uganda', 'dtb-bank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, null, null, 'https://dtbu.dtbafrica.com', 'https://bou.or.ug/Govt_Schemes', array['dtb','diamond trust','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Ecobank Uganda Limited', 'Ecobank Uganda', 'ecobank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, null, null, 'https://www.ecobank.com/ug', 'https://bou.or.ug/Govt_Schemes', array['ecobank','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Equity Bank Uganda Limited', 'Equity Bank Uganda', 'equity-bank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, null, null, 'https://equitygroupholdings.com/ug', 'https://bou.or.ug/Govt_Schemes', array['equity bank','equity','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Exim Bank Uganda Limited', 'Exim Bank Uganda', 'exim-bank-uganda', 'Banking', 'Licensed Tier I commercial bank in Uganda.', 'active', true, null, null, 'https://www.eximbank-ug.com', 'https://bou.or.ug/Govt_Schemes', array['exim bank','exim','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('KCB Bank Uganda Limited', 'KCB Uganda', 'kcb-bank-uganda', 'Banking', 'Licensed commercial bank in Uganda.', 'active', true, null, null, 'https://ug.kcbgroup.com', 'https://bou.or.ug/uploads/ACF_Progress_Report_December_2025_c21a20ff87.pdf', array['kcb','kcb bank','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Stanbic Bank Uganda Limited', 'Stanbic Uganda', 'stanbic-bank-uganda', 'Banking', 'Licensed commercial bank in Uganda.', 'active', true, null, null, 'https://www.stanbicbank.co.ug', 'https://bou.or.ug/uploads/ACF_Progress_Report_December_2025_c21a20ff87.pdf', array['stanbic','stanbic bank','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued'),
  ('Standard Chartered Bank Uganda Limited', 'Standard Chartered Uganda', 'standard-chartered-uganda', 'Banking', 'Licensed commercial bank in Uganda.', 'active', true, null, null, 'https://www.sc.com/ug', 'https://bou.or.ug/uploads/ACF_Progress_Report_December_2025_c21a20ff87.pdf', array['standard chartered','stanchart','bank account','card','atm','bank transfer','loan','bank fraud'], 'catalogued')
on conflict (slug) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  sector = excluded.sector,
  description = excluded.description,
  status = excluded.status,
  verified = excluded.verified,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  website_url = excluded.website_url,
  source_url = excluded.source_url,
  routing_keywords = excluded.routing_keywords,
  onboarding_state = case
    when public.institutions.onboarding_state = 'onboarded' then 'onboarded'
    else excluded.onboarding_state
  end,
  updated_at = now();

with service_data(institution_slug, name, slug, description, category_key, keywords, required_fields, source_url) as (
  values
    ('mtn-uganda', 'Mobile network and airtime', 'mobile-network-airtime', 'Airtime, data bundle, SIM, coverage and mobile network complaints.', 'telecom_service', array['airtime','data','bundle','sim','network','coverage','calls','sms'], array['affected_phone_number','approximate_time'], 'https://www.mtn.co.ug/about-mtn/contact-us/'),
    ('mtn-uganda', 'MTN Mobile Money', 'mobile-money', 'Transfers, cash-in, cash-out, reversals, fraud and wallet complaints.', 'mobile_money', array['momo','mobile money','transfer','withdrawal','deposit','reversal','merchant'], array['transaction_reference','amount','transaction_time'], 'https://www.mtn.co.ug/momo/customer/'),
    ('airtel-uganda', 'Mobile network and airtime', 'mobile-network-airtime', 'Airtime, data bundle, SIM, coverage and mobile network complaints.', 'telecom_service', array['airtime','data','bundle','sim','network','coverage','calls','sms'], array['affected_phone_number','approximate_time'], 'https://www.airtel.co.ug/ugneedmoreofyou/contact-us'),
    ('airtel-uganda', 'Airtel Money', 'airtel-money', 'Transfers, cash-in, cash-out, reversals, fraud and wallet complaints.', 'mobile_money', array['airtel money','mobile money','transfer','withdrawal','deposit','reversal','merchant'], array['transaction_reference','amount','transaction_time'], 'https://www.airtel.co.ug/termCondition'),
    ('nwsc-uganda', 'Water and sewerage service', 'water-sewerage', 'Water outages, low pressure, leaks, pipe bursts, billing and sewerage.', 'water_service', array['no water','water outage','leak','pipe burst','low pressure','sewer','water bill'], array['location','customer_reference'], 'https://www.nwsc.co.ug/contact-us/'),
    ('uedcl-uganda', 'Electricity distribution', 'electricity-distribution', 'Outages, Yaka, meters, transformers, connections and electricity bills.', 'electricity_service', array['blackout','no power','outage','yaka','meter','transformer','pole','electricity bill'], array['location','account_or_meter_number'], 'https://www.uedcl.co.ug/mandate/'),
    ('nema-uganda', 'Environmental incident', 'environmental-incident', 'Pollution, waste, wetlands and environmental compliance incidents.', 'environmental_incident', array['pollution','waste','wetland','toxic','noise','environment damage'], array['location','incident_description'], 'https://eservices.nema.go.ug/quick-access'),
    ('nfa-uganda', 'Forestry incident', 'forestry-incident', 'Illegal logging, forest reserve encroachment and forestry resource concerns.', 'forestry_incident', array['forest','tree cutting','logging','deforestation','forest reserve','timber'], array['location','incident_description'], 'https://nfa.go.ug/'),
    ('nira-uganda', 'Identity and civil registration', 'identity-registration', 'National ID, NIN, birth/death registration, replacement and correction.', 'identity_service', array['national id','nin','id card','birth','death','replacement','renewal','correction'], array['service_type'], 'https://www.nira.go.ug/contact-us'),
    ('ura-uganda', 'Tax and customs', 'tax-customs', 'TIN, returns, EFRIS, tax payments, customs and tax-service complaints.', 'tax_service', array['tax','tin','efris','return','customs','duty','tax payment'], array['service_type'], 'https://ura.go.ug/en/contact-us/'),
    ('ubos-uganda', 'Official statistics', 'official-statistics', 'Census, survey, population and official statistics enquiries.', 'statistics_information', array['census','population','statistics','survey','data'], array['information_requested'], 'https://www.ubos.org/nphc-2024-census-page/'),
    ('uneb-uganda', 'Examinations and results', 'examinations-results', 'Exam results, verification, equating, certificates and centre services.', 'examination_service', array['exam','results','candidate','verification','equating','certificate','centre'], array['examination_year','candidate_or_school_details'], 'https://eservices.uneb.ac.ug/es/lvr/g/contacts'),
    ('ministry-works-transport-uganda', 'National roads and bridges', 'national-roads', 'Damage or hazards on national roads, bridges and ferries, including former UNRA functions.', 'national_road_issue', array['pothole','road damage','highway','national road','bridge','ferry','road hazard'], array['location','road_name'], 'https://works.go.ug/faqs/')
)
insert into public.institution_services (
  institution_id, name, slug, description, category_key,
  routing_keywords, required_fields, source_url, active
)
select i.id, s.name, s.slug, s.description, s.category_key,
  s.keywords, s.required_fields, s.source_url, true
from service_data s
join public.institutions i on i.slug = s.institution_slug
on conflict (institution_id, slug) do update set
  name = excluded.name,
  description = excluded.description,
  category_key = excluded.category_key,
  routing_keywords = excluded.routing_keywords,
  required_fields = excluded.required_fields,
  source_url = excluded.source_url,
  active = true,
  updated_at = now();

-- Every bank receives the same high-level complaint service. Institution-name
-- keywords on the catalogue entry decide which bank owns the case.
insert into public.institution_services (
  institution_id, name, slug, description, category_key,
  routing_keywords, required_fields, source_url, active
)
select
  id,
  'Banking customer support',
  'banking-customer-support',
  'Account, card, ATM, transfer, mobile banking, loan and suspected fraud complaints.',
  'banking_service',
  array['account','card','atm','transfer','mobile banking','loan','fee','fraud','scam'],
  array['account_or_reference','amount','approximate_time'],
  source_url,
  true
from public.institutions
where sector = 'Banking'
on conflict (institution_id, slug) do update set
  description = excluded.description,
  routing_keywords = excluded.routing_keywords,
  required_fields = excluded.required_fields,
  source_url = excluded.source_url,
  active = true,
  updated_at = now();

insert into public.knowledge_documents (
  institution_id, slug, title, document_type, content,
  source_url, status, verified_at, metadata
)
select
  i.id,
  'official-contact-and-scope',
  i.short_name || ' official contact and service scope',
  'contact',
  concat_ws(' ',
    i.description,
    case when i.contact_phone is not null then 'Official phone: ' || i.contact_phone || '.' end,
    case when i.contact_email is not null then 'Official email: ' || i.contact_email || '.' end,
    case when i.website_url is not null then 'Official website: ' || i.website_url || '.' end,
    case when i.onboarding_state = 'catalogued' then 'This institution is catalogued for routing; a SAUTI1 staff workspace has not yet been provisioned.' end
  ),
  i.source_url,
  'verified',
  now(),
  jsonb_build_object('catalogue_source', i.source_url, 'onboarding_state', i.onboarding_state)
from public.institutions i
where i.status = 'active' and i.verified = true and i.source_url is not null
on conflict (institution_id, slug) do update set
  title = excluded.title,
  content = excluded.content,
  source_url = excluded.source_url,
  status = 'verified',
  verified_at = now(),
  metadata = excluded.metadata,
  updated_at = now();

-- Uganda location foundation. The hierarchy is intentionally extendable to
-- all districts, subcounties, parishes, villages and landmarks.
with uganda as (
  insert into public.locations (name, normalized_name, location_type, source_url)
  values ('Uganda', 'uganda', 'country', 'https://www.ubos.org/nphc-2024-census-page/')
  on conflict do nothing
  returning id
), country as (
  select id from uganda
  union all
  select id from public.locations where location_type = 'country' and normalized_name = 'uganda' limit 1
), place_data(name, normalized_name, location_type, region_name, district_name, latitude, longitude) as (
  values
    ('Kampala', 'kampala', 'city', 'Central', 'Kampala', 0.347596, 32.582520),
    ('Jinja', 'jinja', 'city', 'Eastern', 'Jinja', 0.447857, 33.202612),
    ('Mbale', 'mbale', 'city', 'Eastern', 'Mbale', 1.080556, 34.175000),
    ('Soroti', 'soroti', 'city', 'Eastern', 'Soroti', 1.714642, 33.611084),
    ('Arua', 'arua', 'city', 'Northern', 'Arua', 3.020130, 30.911050),
    ('Gulu', 'gulu', 'city', 'Northern', 'Gulu', 2.774570, 32.298990),
    ('Lira', 'lira', 'city', 'Northern', 'Lira', 2.249900, 32.899850),
    ('Mbarara', 'mbarara', 'city', 'Western', 'Mbarara', -0.607160, 30.654500),
    ('Fort Portal', 'fort portal', 'city', 'Western', 'Kabarole', 0.671000, 30.275000),
    ('Masaka', 'masaka', 'city', 'Central', 'Masaka', -0.333790, 31.734090),
    ('Hoima', 'hoima', 'city', 'Western', 'Hoima', 1.435600, 31.343600),
    ('Entebbe', 'entebbe', 'municipality', 'Central', 'Wakiso', 0.050000, 32.460000),
    ('Wakiso', 'wakiso', 'district', 'Central', 'Wakiso', 0.404440, 32.459440),
    ('Mukono', 'mukono', 'municipality', 'Central', 'Mukono', 0.353330, 32.755280),
    ('Kabale', 'kabale', 'municipality', 'Western', 'Kabale', -1.248570, 29.989930),
    ('Kasese', 'kasese', 'municipality', 'Western', 'Kasese', 0.183330, 30.083330),
    ('Tororo', 'tororo', 'municipality', 'Eastern', 'Tororo', 0.692990, 34.180850),
    ('Busia', 'busia', 'municipality', 'Eastern', 'Busia', 0.465880, 34.092210),
    ('Moroto', 'moroto', 'municipality', 'Northern', 'Moroto', 2.534530, 34.666590),
    ('Kampala Central', 'kampala central', 'division', 'Central', 'Kampala', 0.315200, 32.581600),
    ('Kawempe', 'kawempe', 'division', 'Central', 'Kampala', 0.379700, 32.557400),
    ('Makindye', 'makindye', 'division', 'Central', 'Kampala', 0.274900, 32.585100),
    ('Nakawa', 'nakawa', 'division', 'Central', 'Kampala', 0.347500, 32.630000),
    ('Rubaga', 'rubaga', 'division', 'Central', 'Kampala', 0.303000, 32.552000),
    ('Wandegeya', 'wandegeya', 'neighborhood', 'Central', 'Kampala', 0.330400, 32.575400),
    ('Ntinda', 'ntinda', 'neighborhood', 'Central', 'Kampala', 0.354100, 32.616700),
    ('Kabalagala', 'kabalagala', 'neighborhood', 'Central', 'Kampala', 0.298000, 32.602000),
    ('Kamwokya', 'kamwokya', 'neighborhood', 'Central', 'Kampala', 0.347900, 32.596300),
    ('Nakasero', 'nakasero', 'neighborhood', 'Central', 'Kampala', 0.326700, 32.581100),
    ('Kololo', 'kololo', 'neighborhood', 'Central', 'Kampala', 0.337800, 32.590100),
    ('Bweyogerere', 'bweyogerere', 'neighborhood', 'Central', 'Wakiso', 0.357700, 32.667600),
    ('Kira', 'kira', 'municipality', 'Central', 'Wakiso', 0.397200, 32.638900),
    ('Nansana', 'nansana', 'municipality', 'Central', 'Wakiso', 0.363900, 32.528600)
)
insert into public.locations (
  parent_id, name, normalized_name, location_type, region_name,
  district_name, latitude, longitude, source_url
)
select country.id, p.name, p.normalized_name, p.location_type, p.region_name,
  p.district_name, p.latitude, p.longitude,
  'https://www.ubos.org/wp-content/uploads/publications/National-Population-and-Housing-Census-2024-Final-Report-Volume-1-Main.pdf'
from place_data p cross join country
on conflict do nothing;

with alias_data(location_name, alias, normalized_alias, alias_type) as (
  values
    ('Kampala', 'KLA', 'kla', 'abbreviation'),
    ('Fort Portal', 'Fortportal', 'fortportal', 'common'),
    ('Wandegeya', 'Wandegaya', 'wandegaya', 'transcription'),
    ('Wandegeya', 'Wandigiri', 'wandigiri', 'transcription'),
    ('Wandegeya', 'Wandegeya', 'wandegeya', 'common'),
    ('Kawempe', 'Kawempe Division', 'kawempe division', 'common'),
    ('Rubaga', 'Lubaga', 'lubaga', 'common'),
    ('Ministry of Works and Transport', 'UNRA', 'unra', 'former_name')
)
insert into public.location_aliases (location_id, alias, normalized_alias, alias_type)
select l.id, a.alias, a.normalized_alias, a.alias_type
from alias_data a
join public.locations l on l.name = a.location_name
on conflict (location_id, normalized_alias) do update set
  alias = excluded.alias,
  alias_type = excluded.alias_type;

-- Replace the MVP MTN fallback. A report can only be submitted after the
-- server has validated a real active institution selected on the draft.
drop function if exists public.submit_report_to_institution(uuid);

create function public.submit_report_to_institution(target_report_id uuid)
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
  target_institution public.institutions;
  existing_ticket public.tickets;
  inserted_ticket public.tickets;
begin
  select * into target_report
  from public.reports r
  where r.id = target_report_id
    and r.user_id = (select auth.uid())
    and r.status in ('draft', 'pending_confirmation');

  if target_report.id is null then
    raise exception 'Report not found, already submitted, or not owned by current user.';
  end if;

  if target_report.institution_id is null then
    raise exception 'The responsible institution must be confirmed before submission.';
  end if;

  select * into target_institution
  from public.institutions i
  where i.id = target_report.institution_id
    and i.status = 'active'
    and i.verified = true;

  if target_institution.id is null then
    raise exception 'The selected institution is not available for routing.';
  end if;

  select * into existing_ticket
  from public.tickets t where t.report_id = target_report.id limit 1;

  if existing_ticket.id is not null then
    ticket_id := existing_ticket.id;
    ticket_code := existing_ticket.ticket_code;
    ticket_status := existing_ticket.status;
    institution_id := target_institution.id;
    institution_name := coalesce(target_institution.short_name, target_institution.name);
    return next;
    return;
  end if;

  update public.reports
  set status = 'routed', confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
  where id = target_report.id;

  insert into public.tickets (report_id, institution_id, category, priority, status)
  values (target_report.id, target_institution.id, target_report.detected_category, target_report.priority, 'routed')
  returning * into inserted_ticket;

  insert into public.ticket_events (
    ticket_id, actor_user_id, event_type, from_status, to_status, note, metadata
  ) values (
    inserted_ticket.id,
    (select auth.uid()),
    'routed',
    'pending_confirmation',
    'routed',
    'Citizen confirmed the report. SAUTI1 routed it to ' || coalesce(target_institution.short_name, target_institution.name) || '.',
    jsonb_build_object('source', target_report.source, 'ai_confidence', target_report.ai_confidence, 'institution_slug', target_institution.slug)
  );

  ticket_id := inserted_ticket.id;
  ticket_code := inserted_ticket.ticket_code;
  ticket_status := inserted_ticket.status;
  institution_id := target_institution.id;
  institution_name := coalesce(target_institution.short_name, target_institution.name);
  return next;
end;
$$;

grant execute on function public.submit_report_to_institution(uuid) to authenticated;

-- Keep catalogue data available to the server workflow while normal table
-- access remains governed by RLS.
grant select on public.institution_services to authenticated;
grant select on public.knowledge_documents to authenticated;
grant select on public.locations to authenticated;
grant select on public.location_aliases to authenticated;

-- ============================================================
-- END
-- ============================================================
