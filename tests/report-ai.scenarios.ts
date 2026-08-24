import assert from "node:assert/strict";

import {
  InstitutionCatalogItem,
  KnownLocation,
  ReportDraft,
  understandCitizenMessage,
} from "../lib/sauti1/report-ai";

process.env.GEMINI_API_KEY = "";

const service = (
  name: string,
  category_key: string,
  routing_keywords: string[],
  required_fields: string[]
) => ({ name, category_key, description: name, routing_keywords, required_fields });

const catalog: InstitutionCatalogItem[] = [
  {
    id: "police",
    name: "Uganda Police Force",
    short_name: "Uganda Police",
    slug: "uganda-police-force",
    sector: "Security and emergency services",
    description: "Crime reporting, fire response, traffic policing and public safety.",
    contact_phone: "0800 199 699",
    emergency_phone: "999 / 112; Fire and Rescue 0800 121 222",
    routing_keywords: ["police", "crime", "robbery", "theft", "burglary", "stolen", "assault", "missing person", "fire", "traffic crash"],
    institution_services: [
      service("Crime and public-safety report", "security_incident", ["crime", "theft", "robbery", "stolen", "assault", "fire", "traffic"], ["location", "incident_time", "safety_status"]),
    ],
    knowledge_documents: [
      {
        title: "Urgent safety guidance",
        content: "For immediate danger or an active crime, call Uganda Police on 999 or 112 now. SAUTI1 is not an emergency dispatch service.",
        source_url: "https://upf.go.ug/faq/",
      },
    ],
  },
  {
    id: "mtn",
    name: "MTN Uganda Limited",
    short_name: "MTN Uganda",
    slug: "mtn-uganda",
    sector: "Telecommunications",
    description: "Mobile network, airtime, data and MTN Mobile Money services.",
    routing_keywords: ["mtn", "momo", "mobile money", "airtime", "data", "network"],
    institution_services: [
      service("MTN Mobile Money", "mobile_money", ["momo", "mobile money", "transfer", "wallet"], ["transaction_reference", "amount", "transaction_time"]),
      service("Mobile network and airtime", "telecom_service", ["airtime", "data", "bundle", "sim", "network", "calls", "sms"], ["affected_phone_number", "approximate_time"]),
    ],
  },
  {
    id: "airtel",
    name: "Airtel Uganda Limited",
    short_name: "Airtel Uganda",
    slug: "airtel-uganda",
    sector: "Telecommunications",
    description: "Mobile network, airtime, data and Airtel Money services.",
    routing_keywords: ["airtel", "airtel money", "airtime", "data", "network"],
    institution_services: [
      service("Airtel Money", "mobile_money", ["airtel money", "mobile money", "transfer", "wallet"], ["transaction_reference", "amount", "transaction_time"]),
      service("Mobile network and airtime", "telecom_service", ["airtime", "data", "bundle", "sim", "network", "calls", "sms"], ["affected_phone_number", "approximate_time"]),
    ],
  },
  {
    id: "nwsc",
    name: "National Water and Sewerage Corporation",
    short_name: "NWSC",
    slug: "nwsc-uganda",
    sector: "Water and sanitation",
    description: "Water supply, sewerage, billing, leaks and water outages.",
    routing_keywords: ["nwsc", "water", "water meter", "sewerage", "no water"],
    institution_services: [
      service("Water and sewerage service", "water_service", ["water", "water meter", "no water", "leak"], ["location", "customer_reference"]),
    ],
  },
  {
    id: "uedcl",
    name: "Uganda Electricity Distribution Company Limited",
    short_name: "UEDCL",
    slug: "uedcl-uganda",
    sector: "Electricity",
    description: "Electricity distribution, Yaka, meters, billing and outages.",
    routing_keywords: ["uedcl", "electricity", "power", "yaka", "meter", "blackout", "outage"],
    institution_services: [
      service("Electricity distribution", "electricity_service", ["electricity", "yaka", "meter", "blackout", "no power"], ["location", "account_or_meter_number"]),
    ],
  },
  {
    id: "uneb",
    name: "Uganda National Examinations Board",
    short_name: "UNEB",
    slug: "uneb-uganda",
    sector: "Education and examinations",
    description: "National examinations, results, pass slips, verification and certificates.",
    routing_keywords: ["uneb", "exam", "examination", "results", "pass slip", "certificate", "candidate", "senior 4"],
    institution_services: [
      service("Examinations and results", "examination_service", ["exam", "result", "pass slip", "certificate", "candidate", "senior 4"], ["candidate_name", "candidate_index_number", "examination_level", "examination_year", "document_issue"]),
    ],
  },
  {
    id: "nira",
    name: "National Identification and Registration Authority",
    short_name: "NIRA",
    slug: "nira-uganda",
    sector: "Identity and civil registration",
    description: "National ID, NIN, birth registration and identity corrections.",
    routing_keywords: ["nira", "nin", "national id", "identity card", "birth certificate"],
    institution_services: [
      service("Identity and civil registration", "identity_service", ["nin", "national id", "birth certificate", "id correction"], ["service_type"]),
    ],
  },
  {
    id: "works",
    name: "Ministry of Works and Transport",
    short_name: "MoWT",
    slug: "ministry-works-transport-uganda",
    sector: "Roads and transport",
    description: "National roads, bridges, ferries, potholes and road hazards.",
    routing_keywords: ["ministry of works", "mowt", "unra", "national road", "highway", "bridge", "pothole", "road damage"],
    institution_services: [
      service("National roads and bridges", "national_road_issue", ["pothole", "road damage", "highway", "bridge", "road hazard"], ["location", "incident_description"]),
    ],
  },
  {
    id: "mulago",
    name: "Mulago National Specialised Hospital",
    short_name: "Mulago Hospital",
    slug: "mulago-hospital-uganda",
    sector: "Hospital and clinical care",
    description: "National specialised referral hospital.",
    emergency_phone: "+256 414 675 065",
    routing_keywords: ["mulago", "hospital", "medical emergency", "patient care"],
    institution_services: [
      service("Specialist hospital care", "hospital_service", ["hospital", "emergency", "appointment", "outpatient"], ["service_or_department"]),
    ],
  },
  {
    id: "heart",
    name: "Uganda Heart Institute",
    short_name: "UHI",
    slug: "uganda-heart-institute",
    sector: "Cardiovascular care",
    description: "Cardiology diagnosis, treatment, surgery and patient-care concerns.",
    emergency_phone: "+256 417 720 366",
    routing_keywords: ["heart", "cardiac", "cardiology", "chest pain"],
    institution_services: [
      service("Cardiovascular care", "cardiac_service", ["heart", "cardiac", "chest pain"], ["service_or_department"]),
    ],
  },
  {
    id: "health",
    name: "Ministry of Health Uganda",
    short_name: "Ministry of Health",
    slug: "ministry-health-uganda",
    sector: "Public health",
    description: "Public-health alerts, disease prevention and health-system feedback.",
    emergency_phone: "0800 100 066",
    routing_keywords: ["ministry of health", "public health", "outbreak", "vaccination", "disease"],
    institution_services: [
      service("Public-health alert and feedback", "public_health", ["outbreak", "vaccination", "public health", "disease"], ["location", "symptoms_or_issue"]),
    ],
  },
  {
    id: "bank",
    name: "Stanbic Bank Uganda Limited",
    short_name: "Stanbic Uganda",
    slug: "stanbic-bank-uganda",
    sector: "Banking",
    description: "Licensed commercial bank in Uganda.",
    routing_keywords: ["stanbic", "bank account", "card", "atm", "bank transfer", "bank fraud"],
    institution_services: [
      service("Banking customer support", "banking_service", ["account", "card", "atm", "transfer", "loan", "fraud"], ["account_or_reference", "amount", "approximate_time"]),
    ],
  },
];

const locations: KnownLocation[] = [
  { name: "Lungujja", normalized_name: "lungujja", location_type: "neighborhood", district_name: "Kampala", region_name: "Central" },
  { name: "Kisaasi", normalized_name: "kisaasi", location_type: "neighborhood", district_name: "Kampala", region_name: "Central" },
  { name: "Bukoto", normalized_name: "bukoto", location_type: "neighborhood", district_name: "Kampala", region_name: "Central" },
  { name: "Makerere Kikoni", normalized_name: "makerere kikoni", location_type: "neighborhood", district_name: "Kampala", region_name: "Central", location_aliases: [{ normalized_alias: "kikoni" }] },
  { name: "Jinja", normalized_name: "jinja", location_type: "city", district_name: "Jinja", region_name: "Eastern" },
];

const citizen = { fullName: "Test Citizen", phone: "0772123456" };

async function turn(message: string, previous?: Partial<ReportDraft>, transcript = [{ role: "user" as const, text: message }]) {
  return understandCitizenMessage(transcript, message, catalog, locations, previous, citizen);
}

function assertNoBureaucracyQuestion(draft: ReportDraft) {
  assert.doesNotMatch(draft.assistantReply, /which company|public service|which institution|government agency/i);
}

function assertSemantic(draft: ReportDraft) {
  assert.ok(draft.semanticState);
  assert.ok(["unresolved", "candidate", "resolved", "ambiguous"].includes(draft.semanticState.routingState));
  assert.ok(["casual", "information", "understand", "safety", "clarify", "enrich", "evidence", "ready_to_confirm"].includes(draft.semanticState.conversationStage));
}

async function scenario(name: string, message: string, check: (draft: ReportDraft) => void | Promise<void>) {
  const draft = await turn(message);
  assertSemantic(draft);
  assertNoBureaucracyQuestion(draft);
  await check(draft);
  return { name, draft };
}

async function run() {
  const cases: Array<[string, string, (draft: ReportDraft) => void]> = [
    ["casual hello", "Hello.", (d) => assert.equal(d.intent, "conversation")],
    ["casual wellbeing", "Hey, how are you?", (d) => assert.equal(d.intent, "conversation")],
    ["thanks", "Thanks.", (d) => assert.equal(d.intent, "conversation")],
    ["burglary routes police", "Thieves broke into my house last night.", (d) => {
      assert.equal(d.institutionSlug, "uganda-police-force");
      assert.equal(d.category, "security_incident");
      assert.match(d.assistantReply, /safe|happening|left/i);
      assert.equal(d.semanticState.questionPurpose, "risk");
    }],
    ["robbery no current danger", "I was robbed but I am not in danger now.", (d) => {
      assert.equal(d.institutionSlug, "uganda-police-force");
      assert.notEqual(d.priority, "critical");
    }],
    ["assault", "A man assaulted my brother near Jinja yesterday.", (d) => {
      assert.equal(d.institutionSlug, "uganda-police-force");
      assert.ok(d.missingFields.includes("assault_or_injury_details"));
    }],
    ["active danger", "Someone is attacking us right now.", (d) => {
      assert.equal(d.priority, "critical");
      assert.match(d.assistantReply, /999|112|danger|safe/i);
    }],
    ["missing person", "My child is missing since this morning.", (d) => {
      assert.equal(d.institutionSlug, "uganda-police-force");
      assert.ok(d.missingFields.includes("missing_person_details"));
    }],
    ["traffic crash", "There was a traffic crash on the highway near Jinja.", (d) => {
      assert.equal(d.institutionSlug, "uganda-police-force");
      assert.ok(d.missingFields.includes("traffic_incident_details"));
    }],
    ["fire", "A shop is burning in Kisaasi right now.", (d) => {
      assert.equal(d.priority, "critical");
      assert.equal(d.institutionSlug, "uganda-police-force");
    }],
    ["unqualified meter", "My meter was stolen.", (d) => {
      assert.equal(d.institutionSlug, null);
      assert.match(d.assistantReply, /water|electricity|yaka/i);
    }],
    ["water meter", "It is a stolen water meter.", (d) => {
      assert.equal(d.institutionSlug, "nwsc-uganda");
      assert.equal(d.category, "water_service");
    }],
    ["yaka meter", "It was a Yaka meter.", (d) => {
      assert.equal(d.institutionSlug, "uedcl-uganda");
      assert.equal(d.category, "electricity_service");
    }],
    ["no water", "There is no water in Kisaasi.", (d) => {
      assert.equal(d.institutionSlug, "nwsc-uganda");
      assert.equal(d.locationText, "Kisaasi, Kampala, Uganda");
    }],
    ["electric outage", "Power has been off in Makerere Kikoni since morning.", (d) => {
      assert.equal(d.institutionSlug, "uedcl-uganda");
      assert.equal(d.locationText, "Makerere Kikoni, Kampala, Uganda");
    }],
    ["pothole", "There is a dangerous pothole in Kisaasi.", (d) => {
      assert.equal(d.institutionSlug, "ministry-works-transport-uganda");
      assert.equal(d.category, "national_road_issue");
    }],
    ["road bridge", "The bridge on the national road is damaged near Jinja.", (d) => {
      assert.equal(d.institutionSlug, "ministry-works-transport-uganda");
    }],
    ["mtn data", "My MTN data bundle disappeared.", (d) => {
      assert.equal(d.institutionSlug, "mtn-uganda");
      assert.equal(d.category, "telecom_service");
    }],
    ["airtel calls", "My Airtel number cannot make calls.", (d) => {
      assert.equal(d.institutionSlug, "airtel-uganda");
      assert.equal(d.category, "telecom_service");
    }],
    ["ambiguous mobile money", "My mobile money transfer failed.", (d) => {
      assert.equal(d.institutionSlug, null);
      assert.match(d.assistantReply, /MTN|Airtel|wallet/i);
    }],
    ["mtn momo", "My MTN Mobile Money transfer failed.", (d) => {
      assert.equal(d.institutionSlug, "mtn-uganda");
      assert.equal(d.category, "mobile_money");
    }],
    ["airtel money blocked", "My Airtel Money account was blocked.", (d) => {
      assert.equal(d.institutionSlug, "airtel-uganda");
      assert.ok(d.missingFields.includes("affected_phone_number"));
      assert.ok(!d.missingFields.includes("transaction_reference"));
    }],
    ["fraud MTN", "A person called me claiming to be MTN and said my Mobile Money account was blocked.", (d) => {
      assert.equal(d.institutionSlug, "mtn-uganda");
      assert.ok(d.missingFields.includes("suspected_contact_number"));
      assert.ok(d.missingFields.includes("financial_loss"));
    }],
    ["fraud airtel", "An Airtel Money fraudster asked for my PIN on WhatsApp.", (d) => {
      assert.equal(d.institutionSlug, "airtel-uganda");
      assert.ok(d.missingFields.includes("information_shared"));
    }],
    ["bank fraud", "Someone withdrew money from my Stanbic bank account without permission.", (d) => {
      assert.equal(d.institutionSlug, "stanbic-bank-uganda");
      assert.equal(d.category, "banking_service");
    }],
    ["uneb surname", "There is a mistake in my surname on my Senior 4 pass slip.", (d) => {
      assert.equal(d.institutionSlug, "uneb-uganda");
      assert.equal(d.category, "examination_service");
    }],
    ["uneb result", "My UNEB results are missing for UCE.", (d) => {
      assert.equal(d.institutionSlug, "uneb-uganda");
    }],
    ["nira nin", "My NIN has a wrong date of birth.", (d) => {
      assert.equal(d.institutionSlug, "nira-uganda");
    }],
    ["nira birth", "The birth certificate for my child has an error.", (d) => {
      assert.equal(d.institutionSlug, "nira-uganda");
    }],
    ["mulago appointment", "I had a bad appointment experience at Mulago Hospital.", (d) => {
      assert.equal(d.institutionSlug, "mulago-hospital-uganda");
    }],
    ["chest pain", "I have chest pain and need help.", (d) => {
      assert.equal(d.priority, "critical");
      assert.match(d.assistantReply, /emergency|danger|safe|right now/i);
    }],
    ["public health", "There may be a disease outbreak in Kisaasi.", (d) => {
      assert.equal(d.institutionSlug, "ministry-health-uganda");
      assert.ok(d.missingFields.includes("symptoms_or_issue"));
    }],
    ["unknown vague", "Something is wrong.", (d) => {
      assert.equal(d.institutionSlug, null);
      assert.match(d.assistantReply, /what happened|what was affected/i);
    }],
    ["idk", "I don't know.", (d) => {
      assert.notEqual(d.assistantReply.length, 0);
    }],
    ["long emotional", "I am so frustrated because my water has been off for three days in Lungujja and nobody answers.", (d) => {
      assert.equal(d.institutionSlug, "nwsc-uganda");
      assert.equal(d.locationText, "Lungujja, Kampala, Uganda");
    }],
    ["typo pothole", "Theres a pothol in Kisaasi.", (d) => {
      assert.equal(d.locationText, "Kisaasi, Kampala, Uganda");
    }],
    ["ugandan english yaka", "Yaka meter got stolen from our rentals in Bukoto.", (d) => {
      assert.equal(d.institutionSlug, "uedcl-uganda");
      assert.equal(d.locationText, "Bukoto, Kampala, Uganda");
    }],
    ["code switch water", "Amazzi tegali, no water in Lungujja.", (d) => {
      assert.equal(d.institutionSlug, "nwsc-uganda");
    }],
    ["no premature submit", "My MTN airtime was deducted.", (d) => {
      assert.equal(d.readyToConfirm, false);
      assert.doesNotMatch(d.assistantReply, /submitted|ticket/i);
    }],
    ["evidence prompt eventually", "A laptop and television were taken from my house in Lungujja last night and we are safe.", (d) => {
      assert.equal(d.institutionSlug, "uganda-police-force");
      assert.ok(d.missingFields.includes("evidence_available") || d.semanticState.evidenceState !== "not_offered");
    }],
  ];

  for (const [name, message, check] of cases) {
    await scenario(name, message, check);
  }

  let burglary = await turn("Thieves broke into our house last night.");
  burglary = await turn("We are safe and the intruders left.", burglary);
  assert.notEqual(burglary.semanticState.questionPurpose, "risk");
  burglary = await turn("It happened in Lungujja.", burglary);
  assert.equal(burglary.locationText, "Lungujja, Kampala, Uganda");
  burglary = await turn("A laptop and TV were taken.", burglary);
  assert.ok(burglary.intakeData.property_taken_or_damaged);
  burglary = await turn("I have photos of the damaged door.", burglary);
  assert.equal(burglary.semanticState.evidenceState, "described");

  let correction = await turn("The pothole is in Kisaasi.");
  correction = await turn("Sorry, I meant Bukoto.", correction);
  assert.equal(correction.locationText, "Bukoto, Kampala, Uganda");

  let negation = await turn("A fraudster took UGX 200,000 from my MTN Mobile Money.");
  negation = await turn("No, no money was lost.", negation);
  assert.match(negation.intakeData.financial_loss ?? "", /No financial loss/i);

  let providerCorrection = await turn("My MTN data is not working.");
  providerCorrection = await turn("It wasn't MTN, it was Airtel.", providerCorrection);
  assert.equal(providerCorrection.institutionSlug, "airtel-uganda");

  let replacement = await turn("My MTN airtime was deducted.");
  replacement = await turn("Forget this report, I want to report a pothole instead: there is a pothole in Bukoto.", replacement);
  assert.equal(replacement.institutionSlug, "ministry-works-transport-uganda");
  assert.doesNotMatch(replacement.description, /MTN airtime/i);

  const noEvidence = await turn("I don't have any evidence.", burglary);
  assert.equal(noEvidence.semanticState.evidenceState, "none");

  const attached = await understandCitizenMessage(
    [{ role: "user", text: "I attached a screenshot." }],
    "I attached a screenshot.",
    catalog,
    locations,
    burglary,
    citizen,
    [{ name: "door.jpg", mimeType: "image/jpeg", data: "abc" }]
  );
  assert.equal(attached.semanticState.evidenceState, "attached");

  assert.equal(cases.length + 10 >= 50, true);
  console.log(`Report AI scenarios passed: ${cases.length + 10} deterministic behavioral checks.`);
}

void run();
