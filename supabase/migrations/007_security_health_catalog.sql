-- ============================================================
-- SAUTI1 AI
-- Verified security, justice and health catalogue expansion
-- Sources were checked against official institution websites on
-- 2026-08-15. Catalogued does not imply a SAUTI1 staff partnership.
-- ============================================================

alter table public.institutions
  add column if not exists head_office_address text,
  add column if not exists emergency_phone text,
  add column if not exists operating_hours text,
  add column if not exists jurisdiction text,
  add column if not exists information_verified_at timestamptz;

with institution_data(
  name, short_name, slug, sector, description, contact_email, contact_phone,
  emergency_phone, website_url, source_url, head_office_address,
  operating_hours, jurisdiction, routing_keywords
) as (
  values
    ('Uganda Police Force', 'Uganda Police', 'uganda-police-force', 'Security and emergency services',
      'National police service for crime reporting, public safety, traffic policing, fire and emergency response.',
      null, '0800 199 699', '999 / 112; Fire and Rescue 0800 121 222',
      'https://upf.go.ug', 'https://upf.go.ug/faq/', 'Police Headquarters, Naguru, Kampala, Uganda',
      'Emergency lines operate 24/7', 'National',
      array['police','crime','robbery','theft','burglary','assault','violence','kidnap','missing person','traffic crash','fire','emergency','stolen']),
    ('Uganda Prisons Service', 'Uganda Prisons', 'uganda-prisons-service', 'Corrections and rehabilitation',
      'Custodial services, prisoner welfare, rehabilitation, prison administration and correctional service enquiries.',
      'info@ugandaprisons.go.ug', '+256 414 256 751', null,
      'https://www.prisons.go.ug', 'https://www.prisons.go.ug/sites/default/files/LETTER%20FOR%20AUTHORIZATION%20OF%20INTERVIEWS%20OF%20RECRUIT%20WARDERS%20AND%20WARDRESSES_0.pdf',
      'Uganda Prisons Headquarters, P.O. Box 7182, Kampala, Uganda', null, 'National',
      array['prison','prisons','inmate','prisoner','detention','correctional','custody','warder','rehabilitation']),
    ('Directorate of Citizenship and Immigration Control', 'Immigration Uganda', 'immigration-uganda', 'Immigration and citizenship',
      'Passports, visas, permits, passes, residence, citizenship, travel documents and border management.',
      'info@immigration.go.ug', '+256 417 102 600', null,
      'https://www.immigration.go.ug', 'https://www.immigration.go.ug/index.php/about-us',
      'Plot 65/67 Old Port Bell Road, Kampala, Uganda', null, 'National, regional offices and gazetted border points',
      array['immigration','passport','visa','work permit','entry permit','special pass','residence','citizenship','border','travel document']),
    ('Uganda Human Rights Commission', 'UHRC', 'uhrc-uganda', 'Human rights',
      'Human-rights complaints, investigations, detention monitoring, education and regional human-rights services.',
      'uhrc@uhrc.ug', '0414 232 190 / 0414 271 847 / 0800 122 444', null,
      'https://uhrc.ug', 'https://uhrc.ug/page/contact-us',
      'Plot 19 Lumumba Avenue, Rumee Building, Kampala, Uganda', 'Monday-Friday, 8:00-16:00', 'National with regional offices',
      array['human rights','rights violation','torture','unlawful detention','discrimination','abuse by officer','uhrc']),
    ('Ministry of Internal Affairs', 'Internal Affairs', 'internal-affairs-uganda', 'Internal security and public protection',
      'Internal security policy, anti-trafficking, community service, explosives oversight and public-protection coordination.',
      'info@mia.go.ug', '+256 417 346 100', 'Human trafficking 0800 199 003 / 0800 199 004',
      'https://www.mia.go.ug', 'https://www.mia.go.ug/',
      'Jinja Road opposite Meat Packers, Kampala, Uganda', null, 'National',
      array['internal affairs','human trafficking','trafficking','exploitation','community service order','explosives','amnesty']),
    ('Courts of Judicature of Uganda', 'Judiciary Uganda', 'judiciary-uganda', 'Justice and courts',
      'Court administration, case-service enquiries, court-user feedback and complaints about court service delivery.',
      'complaints@judiciary.go.ug', '+256 414 233 420 / +256 414 233 422', null,
      'https://judiciary.go.ug', 'https://judiciary.go.ug/files/downloads/Judiciary%20Client%20Charter.pdf',
      'Kampala High Court Building, Plot 2 The Square, Kampala, Uganda', null, 'Courts nationwide',
      array['judiciary','court','court case','hearing','court complaint','magistrate','judge','court registry','court delay']),
    ('Inspectorate of Government', 'IGG', 'inspectorate-government-uganda', 'Anti-corruption and ombudsman',
      'Corruption, abuse of public office, maladministration, Leadership Code and public-service complaints.',
      'complaints@igg.go.ug', '0414 255 892 / 0414 259 738', '0800 111 777',
      'https://www.igg.go.ug', 'https://www.igg.go.ug/enquiries/',
      'Jubilee Insurance Centre, Plot 14 Parliament Avenue, Kampala, Uganda', null, 'National with 16 regional offices',
      array['igg','corruption','bribery','bribe','abuse of office','maladministration','public officer','whistleblower','leadership code']),
    ('Directorate of Government Analytical Laboratory', 'DGAL', 'government-analytical-laboratory-uganda', 'Forensic and analytical services',
      'Government forensic science, DNA, toxicology and analytical laboratory services under the Ministry of Internal Affairs.',
      'info@mia.go.ug', '+256 417 346 100', null,
      'https://www.mia.go.ug', 'https://www.mia.go.ug/about-us',
      'Ministry of Internal Affairs, Jinja Road, Kampala, Uganda', null, 'National',
      array['dgal','forensic','dna test','toxicology','government laboratory','analytical laboratory','paternity testing']),

    ('Ministry of Health Uganda', 'Ministry of Health', 'ministry-health-uganda', 'Public health',
      'National health policy, public-health alerts, disease prevention, health-programme information and health-system feedback.',
      'info@health.go.ug', '+256 417 712 260', '0800 100 066; health alert SMS 6767',
      'https://health.go.ug', 'https://health.go.ug/',
      'Plot 6 Lourdel Road, Nakasero, Kampala, Uganda', null, 'National',
      array['ministry of health','health ministry','public health','outbreak','epidemic','vaccination','immunisation','health alert','disease']),
    ('Mulago National Specialised Hospital', 'Mulago Hospital', 'mulago-hospital-uganda', 'Hospital and clinical care',
      'National specialised referral hospital providing emergency, inpatient, outpatient, diagnostic and specialist care.',
      'admin@mulagohospital.go.ug', '0800 100 036', '+256 414 675 065',
      'https://www.mulagohospital.go.ug', 'https://www.mulagohospital.go.ug/contact2.html',
      'Mulago Hill, Kampala, Uganda', 'Emergency services operate 24/7', 'National referral hospital',
      array['mulago','mulago hospital','hospital','patient care','medical emergency','referral','appointment','inpatient','outpatient']),
    ('Uganda Cancer Institute', 'UCI', 'uganda-cancer-institute', 'Cancer care',
      'National cancer prevention, screening, diagnosis, treatment, research, education and patient care.',
      'emailus@uci.or.ug', '+256 414 540 410 / 0800 100 800', null,
      'https://uci.or.ug', 'https://uci.or.ug/',
      'Upper Mulago Hill Road, Kampala, Uganda', 'Open Monday-Sunday', 'National cancer referral institute',
      array['cancer institute','uci','cancer','oncology','chemotherapy','radiotherapy','cancer screening','tumour']),
    ('Uganda Heart Institute', 'UHI', 'uganda-heart-institute', 'Cardiovascular care',
      'Specialised cardiovascular prevention, diagnosis, clinical care, surgery, research and training.',
      'info@uhi.go.ug', '+256 417 720 350', '+256 417 720 366',
      'https://www.uhi.go.ug', 'https://www.uhi.go.ug/',
      'Block C Level 2, Mulago National Specialised Hospital, Kampala, Uganda', null, 'National cardiovascular referral institute',
      array['heart institute','uhi','heart','cardiac','cardiology','heart surgery','cardiovascular','chest pain']),
    ('Butabika National Referral Mental Hospital', 'Butabika Hospital', 'butabika-hospital-uganda', 'Mental health care',
      'National psychiatric referral hospital providing mental-health, addiction, counselling, outpatient and inpatient services.',
      null, '+256 414 504 375 / 0800 211 306', '+256 414 504 376 / 0800 211 306',
      'https://www.butabikahospital.go.ug', 'https://www.butabikahospital.go.ug/',
      'Plot 2 Kirombe-Butabika Road, Kampala, Uganda', 'Emergency services operate 24/7/365', 'National mental-health referral hospital',
      array['butabika','mental health','psychiatric','psychiatry','addiction','counselling','suicide','psychosis','substance use']),
    ('National Drug Authority', 'NDA', 'national-drug-authority-uganda', 'Medicines and health-product regulation',
      'Regulation of medicines, healthcare products, pharmacies, drug safety, adverse reactions and suspected counterfeit products.',
      'ndaug@nda.or.ug', '+256 417 788 100', '0800 101 999; pharmacovigilance +256 740 002 070 / 080',
      'https://www.nda.or.ug', 'https://www.nda.or.ug/contact-us/',
      'NDA Tower, Plot 93 Buganda Road, Kampala, Uganda', 'Monday-Friday, 8:00-17:00', 'National with regional offices',
      array['nda','drug authority','medicine','pharmacy','counterfeit medicine','fake medicine','adverse drug reaction','drug safety','licensed pharmacy']),
    ('National Medical Stores', 'NMS', 'national-medical-stores-uganda', 'Public medical supply',
      'Procurement, storage and distribution of essential medicines and medical supplies to public health facilities.',
      'web@nms.go.ug', '+256 417 104 000', '0800 122 221',
      'https://nms.go.ug', 'https://nms.go.ug/contact-us/',
      'Plot 261 Kiwamirembe Road, Kajjansi Town Council, Wakiso District, Uganda', 'Monday-Friday 8:30-17:00; Saturday 8:30-12:30', 'National public health facilities',
      array['nms','national medical stores','medicine stock','medical supplies','drug delivery','government medicine','not for sale medicine']),
    ('Uganda Blood Transfusion Services', 'UBTS', 'uganda-blood-transfusion-services', 'Blood services',
      'National blood collection, testing, processing, storage, distribution and blood-donor services.',
      null, '+256 414 259 195 / +256 414 257 155', null,
      'https://www.ubts.go.ug', 'https://ubts.go.ug/contact_us.html',
      'Plot 69/3 Hill Road, Nakasero, Kampala, Uganda', null, 'National blood service',
      array['ubts','blood transfusion','blood donation','donate blood','blood bank','blood shortage','blood service']),
    ('Uganda Medical and Dental Practitioners Council', 'UMDPC', 'umdpc-uganda', 'Health-professional regulation',
      'Registration and licensing of doctors, dentists and private health facilities, professional standards and malpractice complaints.',
      'registrar@umdpc.go.ug', '+256 200 904 427', '0800 100 262',
      'https://www.umdpc.go.ug', 'https://www.umdpc.go.ug/',
      'Plot 442 Kafeero Zone Road, Mulago, Kampala, Uganda', null, 'National',
      array['umdpc','doctor license','dentist license','medical malpractice','doctor complaint','private clinic license','medical council']),
    ('Kawempe National Referral Hospital', 'Kawempe Hospital', 'kawempe-hospital-uganda', 'Maternal, newborn and child health',
      'National referral services focused on obstetrics, gynaecology, maternal, newborn, paediatric and adolescent care.',
      null, '0414 672 552', null,
      'https://kawempehospital.go.ug', 'https://kawempehospital.go.ug/node/70',
      'Kawempe, Kampala, Uganda', 'Emergency services operate 24/7', 'National referral hospital',
      array['kawempe hospital','maternity','pregnancy','labour','delivery','newborn','neonatal','paediatric','child health','obstetric'])
)
insert into public.institutions (
  name, short_name, slug, sector, description, status, verified,
  contact_email, contact_phone, emergency_phone, website_url, source_url,
  head_office_address, operating_hours, jurisdiction, routing_keywords,
  onboarding_state, information_verified_at
)
select
  name, short_name, slug, sector, description, 'active', true,
  contact_email, contact_phone, emergency_phone, website_url, source_url,
  head_office_address, operating_hours, jurisdiction, routing_keywords,
  'catalogued', '2026-08-15T00:00:00+03:00'::timestamptz
from institution_data
on conflict (slug) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  sector = excluded.sector,
  description = excluded.description,
  status = 'active',
  verified = true,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  emergency_phone = excluded.emergency_phone,
  website_url = excluded.website_url,
  source_url = excluded.source_url,
  head_office_address = excluded.head_office_address,
  operating_hours = excluded.operating_hours,
  jurisdiction = excluded.jurisdiction,
  routing_keywords = excluded.routing_keywords,
  information_verified_at = excluded.information_verified_at,
  onboarding_state = case when public.institutions.onboarding_state = 'onboarded' then 'onboarded' else 'catalogued' end,
  updated_at = now();
with service_data(institution_slug, name, slug, description, category_key, keywords, required_fields, source_url) as (
  values
    ('uganda-police-force', 'Crime and public-safety report', 'crime-public-safety', 'Crime, theft, violence, traffic incidents, missing persons and urgent public-safety matters.', 'security_incident', array['crime','theft','robbery','assault','violence','missing','stolen','traffic','fire'], array['location','incident_time','safety_status'], 'https://upf.go.ug/faq/'),
    ('uganda-prisons-service', 'Prison and prisoner welfare', 'prison-welfare', 'Custody, prisoner welfare, visitation and correctional administration enquiries.', 'corrections_service', array['prison','prisoner','inmate','custody','visitation','warder'], array['facility_name','person_or_reference'], 'https://www.prisons.go.ug'),
    ('immigration-uganda', 'Passport, visa and immigration service', 'immigration-services', 'Passport, visa, permit, residence, citizenship and border-service matters.', 'immigration_service', array['passport','visa','permit','residence','citizenship','border','travel document'], array['service_type','application_reference'], 'https://www.immigration.go.ug/index.php/about-us'),
    ('uhrc-uganda', 'Human-rights complaint', 'human-rights-complaint', 'Human-rights violations, unlawful detention, torture, discrimination and public-authority abuse.', 'human_rights_complaint', array['rights violation','unlawful detention','torture','discrimination','abuse'], array['location','incident_date','responsible_body'], 'https://uhrc.ug/page/contact-us'),
    ('internal-affairs-uganda', 'Human-trafficking and internal-affairs report', 'internal-affairs-report', 'Human trafficking, exploitation, community service and internal-affairs enquiries.', 'internal_security_service', array['trafficking','exploitation','community service','explosives','amnesty'], array['location','incident_description'], 'https://www.mia.go.ug/'),
    ('judiciary-uganda', 'Court service and complaint', 'court-service', 'Court registry, case-service, hearing administration and court-user complaints.', 'court_service', array['court','case','hearing','registry','magistrate','judge','court delay'], array['court_name','case_reference'], 'https://judiciary.go.ug/files/downloads/Judiciary%20Client%20Charter.pdf'),
    ('inspectorate-government-uganda', 'Corruption and maladministration complaint', 'corruption-complaint', 'Corruption, bribery, abuse of public office and maladministration complaints.', 'corruption_complaint', array['corruption','bribe','bribery','abuse of office','maladministration','public officer'], array['public_body','incident_description'], 'https://www.igg.go.ug/enquiries/'),
    ('government-analytical-laboratory-uganda', 'Forensic and DNA laboratory service', 'forensic-laboratory', 'Government forensic, DNA, toxicology and analytical laboratory enquiries.', 'forensic_service', array['forensic','dna','toxicology','paternity','laboratory'], array['service_type','requesting_authority'], 'https://www.mia.go.ug/about-us'),
    ('ministry-health-uganda', 'Public-health alert and feedback', 'public-health-alert', 'Disease alerts, public-health information and national health-system feedback.', 'public_health', array['outbreak','epidemic','vaccination','health alert','public health','disease'], array['location','symptoms_or_issue'], 'https://health.go.ug/'),
    ('mulago-hospital-uganda', 'Specialist hospital care', 'specialist-hospital-care', 'Emergency, referral, inpatient, outpatient, diagnostic and specialist hospital services.', 'hospital_service', array['hospital','emergency','referral','appointment','inpatient','outpatient'], array['service_or_department'], 'https://www.mulagohospital.go.ug/contact2.html'),
    ('uganda-cancer-institute', 'Cancer care', 'cancer-care', 'Cancer screening, diagnosis, oncology treatment, appointments and patient-care concerns.', 'cancer_service', array['cancer','oncology','chemotherapy','radiotherapy','screening','tumour'], array['service_or_department'], 'https://uci.or.ug/'),
    ('uganda-heart-institute', 'Cardiovascular care', 'cardiovascular-care', 'Cardiology diagnosis, treatment, surgery, appointments and patient-care concerns.', 'cardiac_service', array['heart','cardiac','cardiology','heart surgery','cardiovascular','chest pain'], array['service_or_department'], 'https://www.uhi.go.ug/'),
    ('butabika-hospital-uganda', 'Mental-health and addiction care', 'mental-health-care', 'Psychiatric emergencies, mental-health, addiction, counselling and patient-care services.', 'mental_health_service', array['mental health','psychiatric','addiction','counselling','suicide','psychosis'], array['location','immediate_safety_status'], 'https://www.butabikahospital.go.ug/'),
    ('national-drug-authority-uganda', 'Medicine safety and pharmacy complaint', 'medicine-safety', 'Adverse drug reactions, counterfeit products, pharmacy licensing and medicine-quality complaints.', 'medicine_safety', array['medicine','pharmacy','counterfeit','fake medicine','adverse reaction','drug safety'], array['product_name','purchase_location'], 'https://www.nda.or.ug/contact-us/'),
    ('national-medical-stores-uganda', 'Public medicine supply feedback', 'public-medicine-supply', 'Medicine and medical-supply delivery or availability issues involving public health facilities.', 'medical_supply', array['medicine stock','medical supplies','drug delivery','government medicine','not for sale'], array['health_facility','district'], 'https://nms.go.ug/contact-us/'),
    ('uganda-blood-transfusion-services', 'Blood donation and supply', 'blood-services', 'Blood donation, blood-bank and transfusion-supply enquiries.', 'blood_service', array['blood donation','donate blood','blood bank','blood shortage','transfusion'], array['location','service_needed'], 'https://ubts.go.ug/contact_us.html'),
    ('umdpc-uganda', 'Medical practitioner or facility complaint', 'medical-practice-complaint', 'Doctor, dentist, private facility licensing, professional conduct and malpractice complaints.', 'medical_regulation', array['doctor license','dentist license','malpractice','doctor complaint','clinic license'], array['practitioner_or_facility','incident_description'], 'https://www.umdpc.go.ug/'),
    ('kawempe-hospital-uganda', 'Maternal, newborn and child care', 'maternal-child-care', 'Obstetric, maternity, newborn, paediatric and adolescent referral services.', 'maternal_child_health', array['maternity','pregnancy','labour','delivery','newborn','neonatal','paediatric'], array['service_or_department'], 'https://kawempehospital.go.ug/node/70')
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

insert into public.knowledge_documents (
  institution_id, slug, title, document_type, content,
  source_url, status, verified_at, metadata
)
select
  i.id,
  'official-service-guide-2026',
  coalesce(i.short_name, i.name) || ' verified service guide',
  'official_information',
  concat_ws(' ',
    i.description,
    case when i.jurisdiction is not null then 'Jurisdiction: ' || i.jurisdiction || '.' end,
    case when i.head_office_address is not null then 'Head office: ' || i.head_office_address || '.' end,
    case when i.contact_phone is not null then 'Official contact: ' || i.contact_phone || '.' end,
    case when i.emergency_phone is not null then 'Emergency or toll-free contact: ' || i.emergency_phone || '.' end,
    case when i.contact_email is not null then 'Official email: ' || i.contact_email || '.' end,
    case when i.operating_hours is not null then 'Hours: ' || i.operating_hours || '.' end,
    'This entry is verified catalogue information; catalogued status does not claim the institution has an active SAUTI1 staff workspace.'
  ),
  i.source_url,
  'verified',
  '2026-08-15T00:00:00+03:00'::timestamptz,
  jsonb_build_object(
    'checked_on', '2026-08-15',
    'official_source', i.source_url,
    'onboarding_state', i.onboarding_state
  )
from public.institutions i
where i.slug in (
  'uganda-police-force','uganda-prisons-service','immigration-uganda','uhrc-uganda',
  'internal-affairs-uganda','judiciary-uganda','inspectorate-government-uganda','government-analytical-laboratory-uganda',
  'ministry-health-uganda','mulago-hospital-uganda','uganda-cancer-institute','uganda-heart-institute',
  'butabika-hospital-uganda','national-drug-authority-uganda','national-medical-stores-uganda',
  'uganda-blood-transfusion-services','umdpc-uganda','kawempe-hospital-uganda'
)
on conflict (institution_id, slug) do update set
  title = excluded.title,
  content = excluded.content,
  source_url = excluded.source_url,
  status = 'verified',
  verified_at = excluded.verified_at,
  metadata = excluded.metadata,
  updated_at = now();

-- Safety knowledge is intentionally explicit: SAUTI1 routes reports but is
-- not an emergency dispatch or clinical diagnosis service.
insert into public.knowledge_documents (
  institution_id, slug, title, document_type, content,
  source_url, status, verified_at, metadata
)
select i.id, 'urgent-safety-guidance', 'Urgent safety guidance', 'policy',
  case
    when i.slug = 'uganda-police-force' then 'For immediate danger or an active crime, call Uganda Police on 999 or 112 now. SAUTI1 is not an emergency dispatch service. A citizen may still prepare a non-emergency report after they are safe.'
    when i.slug = 'ministry-health-uganda' then 'For urgent public-health guidance call the Ministry of Health toll-free line 0800 100 066. SAUTI1 does not diagnose illness or replace emergency medical care.'
    when i.slug = 'butabika-hospital-uganda' then 'For a mental-health emergency call Butabika Hospital on +256 414 504 376 or 0800 211 306. If there is immediate danger also call 999 or 112. SAUTI1 is not an emergency service.'
  end,
  i.source_url, 'verified', '2026-08-15T00:00:00+03:00'::timestamptz,
  jsonb_build_object('checked_on', '2026-08-15', 'safety_critical', true)
from public.institutions i
where i.slug in ('uganda-police-force','ministry-health-uganda','butabika-hospital-uganda')
on conflict (institution_id, slug) do update set
  content = excluded.content,
  source_url = excluded.source_url,
  status = 'verified',
  verified_at = excluded.verified_at,
  metadata = excluded.metadata,
  updated_at = now();

-- Refresh the compact contact document for every verified institution so
-- information answers include the richer operational fields.
insert into public.knowledge_documents (
  institution_id, slug, title, document_type, content,
  source_url, status, verified_at, metadata
)
select
  i.id,
  'official-contact-and-scope',
  coalesce(i.short_name, i.name) || ' official contact and service scope',
  'contact',
  concat_ws(' ',
    i.description,
    case when i.contact_phone is not null then 'Official phone: ' || i.contact_phone || '.' end,
    case when i.emergency_phone is not null then 'Emergency or toll-free phone: ' || i.emergency_phone || '.' end,
    case when i.contact_email is not null then 'Official email: ' || i.contact_email || '.' end,
    case when i.head_office_address is not null then 'Address: ' || i.head_office_address || '.' end,
    case when i.operating_hours is not null then 'Hours: ' || i.operating_hours || '.' end,
    case when i.website_url is not null then 'Official website: ' || i.website_url || '.' end
  ),
  i.source_url,
  'verified',
  coalesce(i.information_verified_at, now()),
  jsonb_build_object('catalogue_source', i.source_url, 'onboarding_state', i.onboarding_state)
from public.institutions i
where i.status = 'active' and i.verified = true and i.source_url is not null
on conflict (institution_id, slug) do update set
  title = excluded.title,
  content = excluded.content,
  source_url = excluded.source_url,
  status = 'verified',
  verified_at = excluded.verified_at,
  metadata = excluded.metadata,
  updated_at = now();
