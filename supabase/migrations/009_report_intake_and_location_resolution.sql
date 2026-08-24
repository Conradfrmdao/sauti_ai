-- ============================================================
-- SAUTI1 AI
-- Structured report intake and expanded Uganda place knowledge
-- ============================================================

alter table public.reports
  add column if not exists intake_data jsonb not null default '{}'::jsonb;

comment on column public.reports.intake_data is
  'Structured case details collected conversationally before submission.';

-- A commonly reported Kampala locality that was absent from the initial
-- foundation list. Online geocoding remains the fallback for other places.
insert into public.locations (
  parent_id,
  name,
  normalized_name,
  location_type,
  region_name,
  district_name,
  latitude,
  longitude,
  source_url
)
select
  uganda.id,
  'Makerere Kikoni',
  'makerere kikoni',
  'neighborhood',
  'Central',
  'Kampala',
  0.346060,
  32.562810,
  'https://www.nema.go.ug/new_site/wp-content/uploads/2024/02/LIST-FOR-EATORS-AND-ENVIRONMENTAL-AUDITS-FOR-THE-MONTH-OF-DECEMBER.pdf'
from public.locations uganda
where uganda.location_type = 'country'
  and uganda.normalized_name = 'uganda'
on conflict do nothing;

with makerere_kikoni as (
  select id
  from public.locations
  where normalized_name = 'makerere kikoni'
    and location_type = 'neighborhood'
  limit 1
), alias_data(alias, normalized_alias, alias_type) as (
  values
    ('Kikoni', 'kikoni', 'common'),
    ('Makerere-Kikoni', 'makerere kikoni', 'common'),
    ('Makerere Kikoni Zone', 'makerere kikoni zone', 'common')
)
insert into public.location_aliases (location_id, alias, normalized_alias, alias_type)
select makerere_kikoni.id, alias_data.alias, alias_data.normalized_alias, alias_data.alias_type
from makerere_kikoni cross join alias_data
on conflict (location_id, normalized_alias) do update set
  alias = excluded.alias,
  alias_type = excluded.alias_type;

-- UNEB cases need enough detail for staff to locate the candidate record and
-- understand the document problem without another round of basic triage.
update public.institution_services service
set
  required_fields = array[
    'candidate_name',
    'candidate_index_number',
    'examination_level',
    'examination_year',
    'document_issue'
  ],
  updated_at = now()
from public.institutions institution
where service.institution_id = institution.id
  and institution.slug = 'uneb-uganda'
  and service.slug = 'examinations-results';

-- A precise place description is sufficient for a road hazard report; a
-- citizen should not be blocked merely because they do not know a road name.
update public.institution_services service
set
  required_fields = array['location', 'incident_description'],
  updated_at = now()
from public.institutions institution
where service.institution_id = institution.id
  and institution.slug = 'ministry-works-transport-uganda'
  and service.slug = 'national-roads';

-- ============================================================
-- END
-- ============================================================
