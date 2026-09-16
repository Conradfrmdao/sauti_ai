/**
 * Reproduces the reported voice trap: SAUTI1 says the report is ready, the
 * citizen confirms, and it asks for another detail instead of finishing.
 * A pass means readiness never goes back to false once offered.
 * Opt-in: uses live model quota.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

const { runAgentTurn } = await import("../lib/sauti1/agent");
import type { InstitutionCatalogItem, ReportDraft } from "../lib/sauti1/report-ai";

const catalog: InstitutionCatalogItem[] = [{
  id: "1", name: "Uganda Police Force", short_name: "Police", slug: "uganda-police-force",
  sector: "Security and public safety", description: "Crime reporting.",
  emergency_phone: "999", contact_phone: "0800199999", head_office_address: null,
  operating_hours: "24/7", jurisdiction: "National",
  routing_keywords: ["crime", "theft", "burglary", "police"],
  institution_services: [{
    name: "Security incident report", category_key: "security_incident",
    description: "Report a crime.", routing_keywords: ["burglary", "theft"],
    required_fields: ["location", "incident_time", "property_taken_or_damaged"],
  }],
  knowledge_documents: [],
}];

const citizen = { fullName: "Conrad Wagaba", phone: "+256770000000" };
const transcript: { role: "user" | "assistant"; text: string }[] = [];
let previous: Partial<ReportDraft> | undefined;

const script = [
  "Thieves broke into my house last night in Ntinda and took my laptop.",
  "Yes everyone is safe.",
  "Confirm",
  "Confirm",
  "Yes, submit it",
];

let readyOffered = false;
let failures = 0;

for (const [index, message] of script.entries()) {
  const { draft } = await runAgentTurn({
    transcript: [...transcript], message, catalog, locations: [], previous, citizen,
    latencyMode: "realtime",
  });

  console.log(`\n--- turn ${index + 1} ---`);
  console.log(`citizen : ${message}`);
  console.log(`SAUTI1  : ${draft.assistantReply}`);
  console.log(`ready   : ${draft.readyToConfirm}   outstanding: ${JSON.stringify(draft.missingFields)}`);

  if (draft.readyToConfirm) readyOffered = true;

  // The trap: readiness was offered, then withdrawn.
  if (readyOffered && !draft.readyToConfirm) {
    console.log("  ^^ FAIL: readiness was withdrawn after being offered");
    failures += 1;
  }
  // The other half of the trap: a question after the citizen said confirm.
  if (index >= 2 && draft.assistantReply.includes("?")) {
    console.log("  ^^ FAIL: asked a question after the citizen confirmed");
    failures += 1;
  }

  transcript.push({ role: "user", text: message }, { role: "assistant", text: draft.assistantReply });
  previous = draft;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures} problems)`}: confirm loop`);
process.exit(failures === 0 ? 0 : 1);
