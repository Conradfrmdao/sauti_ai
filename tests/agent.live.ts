/**
 * Probes the new agent against the exact failure the user reported:
 * redundant questions, and asking the citizen to identify the institution.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

import { runAgentTurn } from "../lib/sauti1/agent";
import type { InstitutionCatalogItem, ReportDraft } from "../lib/sauti1/report-ai";

const catalog: InstitutionCatalogItem[] = [
  {
    id: "1", name: "Uganda Police Force", short_name: "Police", slug: "uganda-police-force",
    sector: "Security and public safety", description: "Crime reporting and public safety.",
    emergency_phone: "999", contact_phone: "0800199999", head_office_address: null,
    operating_hours: "24/7", jurisdiction: "National",
    routing_keywords: ["crime", "theft", "burglary", "assault", "robbery", "police"],
    institution_services: [{
      name: "Security incident report", category_key: "security_incident",
      description: "Report a crime or security incident.",
      routing_keywords: ["burglary", "theft", "break in", "assault"],
      required_fields: ["location", "incident_time", "property_taken_or_damaged"],
    }],
    knowledge_documents: [],
  },
  {
    id: "2", name: "National Water and Sewerage Corporation", short_name: "NWSC", slug: "nwsc",
    sector: "Water and sanitation", description: "Water supply and sewerage.",
    emergency_phone: null, contact_phone: "0800200977", head_office_address: null,
    operating_hours: "Mon-Fri 8-5", jurisdiction: "National",
    routing_keywords: ["water", "tap", "sewer", "burst pipe", "water meter"],
    institution_services: [{
      name: "Water supply fault", category_key: "water_supply",
      description: "No water, burst pipe, or sewage overflow.",
      routing_keywords: ["no water", "burst", "sewage", "dry tap"],
      required_fields: ["location", "account_or_meter_number"],
    }],
    knowledge_documents: [],
  },
  {
    id: "3", name: "Kampala Capital City Authority", short_name: "KCCA", slug: "kcca",
    sector: "Roads and transport", description: "City roads, drainage and waste.",
    emergency_phone: null, contact_phone: "0204660000", head_office_address: null,
    operating_hours: "Mon-Fri 8-5", jurisdiction: "Kampala",
    routing_keywords: ["pothole", "road", "drainage", "garbage", "street light"],
    institution_services: [{
      name: "Road defect report", category_key: "road_defect",
      description: "Potholes, damaged roads, blocked drainage.",
      routing_keywords: ["pothole", "road damage", "drainage"],
      required_fields: ["location", "road_name"],
    }],
    knowledge_documents: [],
  },
  {
    id: "4", name: "MTN Uganda", short_name: "MTN", slug: "mtn-uganda",
    sector: "Telecommunications", description: "Mobile network and mobile money.",
    emergency_phone: null, contact_phone: "100", head_office_address: null,
    operating_hours: "24/7", jurisdiction: "National",
    routing_keywords: ["mtn", "mobile money", "momo", "airtime", "network"],
    institution_services: [{
      name: "Mobile money dispute", category_key: "mobile_money",
      description: "Failed or misdirected mobile money transfer.",
      routing_keywords: ["mobile money", "momo", "sent money", "transaction"],
      required_fields: ["transaction_reference", "amount", "affected_phone_number"],
    }],
    knowledge_documents: [],
  },
];

const citizen = { fullName: "Conrad Wagaba", phone: "+256770000000" };

async function turn(
  label: string,
  transcript: { role: "user" | "assistant"; text: string }[],
  message: string,
  previous?: Partial<ReportDraft>
) {
  const started = Date.now();
  const { draft, usage } = await runAgentTurn({
    transcript, message, catalog, locations: [], previous, citizen,
  });
  console.log(`\n=== ${label} ===`);
  console.log(`citizen : ${message}`);
  console.log(`SAUTI1  : ${draft.assistantReply}`);
  console.log(`routed  : ${draft.institutionSlug ?? "(none)"} / ${draft.category}  conf=${draft.confidence}`);
  console.log(`known   : ${JSON.stringify(draft.intakeData)}`);
  console.log(`missing : ${JSON.stringify(draft.missingFields)}  ready=${draft.readyToConfirm}`);
  console.log(`meta    : ${usage?.model}  in=${usage?.inputTokens} out=${usage?.outputTokens}  ${Date.now() - started}ms`);
  return draft;
}

async function main() {
  // The scenario the user called out: everything needed is in one sentence.
  const first = await turn(
    "T1 rich first message",
    [],
    "Thieves broke into my house last night in Ntinda and took my laptop and two phones."
  );

  // Second turn must NOT re-ask location, time, or what was taken.
  const second = await turn(
    "T2 follow-up (must not repeat itself)",
    [
      { role: "user", text: "Thieves broke into my house last night in Ntinda and took my laptop and two phones." },
      { role: "assistant", text: first.assistantReply },
    ],
    "Yes we are all safe, they left before we woke up.",
    first
  );

  console.log("\n\n### REDUNDANCY CHECK ###");
  const reply = second.assistantReply.toLowerCase();
  const checks: [string, boolean][] = [
    ["does not re-ask location", !/where (did|do)|which (area|place|district)|location\?/.test(reply)],
    ["does not re-ask when", !/what time|when did (this|it)/.test(reply)],
    ["does not re-ask what was taken", !/what (was|were) (taken|stolen)/.test(reply)],
    ["does not ask which institution", !/which (institution|company|agency|body)/.test(reply)],
    ["does not ask for name/phone", !/your (full )?name|phone number/.test(reply)],
    ["routed to police", second.institutionSlug === "uganda-police-force"],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);

  // Ambiguity: must ask about the real-world thing, not the company.
  await turn("T3 genuine ambiguity", [], "My meter was stolen.");
}

main().catch((error) => { console.error("PROBE FAILED:", error); process.exit(1); });
