/**
 * Benchmarks Gemini reasoning models on the real SAUTI1 turn, measuring both
 * latency and whether the turn is actually correct. Picks by evidence, not by
 * version number. Opt-in: uses live quota.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}
// Force the Gemini path regardless of provider config.
process.env.OPENROUTER_API_KEY = "";

const { runAgentTurn } = await import("../lib/sauti1/agent");
import type { InstitutionCatalogItem, ReportDraft } from "../lib/sauti1/report-ai";

const catalog: InstitutionCatalogItem[] = [
  {
    id: "1", name: "Uganda Police Force", short_name: "Police", slug: "uganda-police-force",
    sector: "Security and public safety", description: "Crime reporting.",
    emergency_phone: "999", contact_phone: "0800199999", head_office_address: null,
    operating_hours: "24/7", jurisdiction: "National",
    routing_keywords: ["crime", "theft", "burglary", "police"],
    institution_services: [{
      name: "Security incident report", category_key: "security_incident",
      description: "Report a crime.", routing_keywords: ["burglary", "theft"],
      required_fields: ["location", "incident_time"],
    }],
    knowledge_documents: [],
  },
  {
    id: "2", name: "National Water and Sewerage Corporation", short_name: "NWSC", slug: "nwsc",
    sector: "Water and sanitation", description: "Water supply.",
    emergency_phone: null, contact_phone: "0800200977", head_office_address: null,
    operating_hours: "Mon-Fri", jurisdiction: "National",
    routing_keywords: ["water", "tap", "sewer", "water meter"],
    institution_services: [{
      name: "Water supply fault", category_key: "water_supply",
      description: "No water or burst pipe.", routing_keywords: ["no water", "burst"],
      required_fields: ["location"],
    }],
    knowledge_documents: [],
  },
  {
    id: "3", name: "Umeme", short_name: "Umeme", slug: "umeme",
    sector: "Electricity", description: "Power distribution and Yaka meters.",
    emergency_phone: null, contact_phone: "0800185185", head_office_address: null,
    operating_hours: "24/7", jurisdiction: "National",
    routing_keywords: ["power", "electricity", "yaka", "blackout", "electricity meter"],
    institution_services: [{
      name: "Power fault", category_key: "power_fault",
      description: "Outage or meter fault.", routing_keywords: ["blackout", "yaka", "power"],
      required_fields: ["location"],
    }],
    knowledge_documents: [],
  },
];

const citizen = { fullName: "Conrad Wagaba", phone: "+256770000000" };

type Case = {
  name: string;
  message: string;
  previous?: Partial<ReportDraft>;
  transcript?: { role: "user" | "assistant"; text: string }[];
  check: (draft: ReportDraft) => string | null;
};

const cases: Case[] = [
  {
    name: "routes burglary, no redundant questions",
    message: "Thieves broke into my house last night in Ntinda and took my laptop.",
    check: (d) => {
      if (d.institutionSlug !== "uganda-police-force") return `routed to ${d.institutionSlug}`;
      const r = d.assistantReply.toLowerCase();
      if (/where (did|do)|which area|what time|when did/.test(r)) return "re-asked a known fact";
      if (!d.intakeData.location) return "lost the location";
      return null;
    },
  },
  {
    name: "asks about the thing, not the company",
    message: "My meter was stolen.",
    check: (d) => {
      const r = d.assistantReply.toLowerCase();
      if (/which (institution|company|agency|provider|body)/.test(r)) return "asked which company";
      if (!/water|yaka|electric/.test(r)) return "did not disambiguate the meter";
      return null;
    },
  },
  {
    name: "keeps the case on a short follow-up",
    message: "Yes we are all safe.",
    transcript: [
      { role: "user", text: "Thieves broke into my house last night in Ntinda." },
      { role: "assistant", text: "I am sorry. Is everyone safe?" },
    ],
    previous: {
      intent: "report", institutionSlug: "uganda-police-force", institutionName: "Police",
      category: "security_incident", description: "Burglary in Ntinda last night.",
      locationText: "Ntinda", intakeData: { location: "Ntinda", time: "last night" },
    },
    check: (d) => {
      if (d.intent !== "report") return `intent became ${d.intent}`;
      if (d.institutionSlug !== "uganda-police-force") return "lost the routing";
      return null;
    },
  },
];

const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

for (const model of models) {
  process.env.GEMINI_REALTIME_MODEL = model;
  const timings: number[] = [];
  const problems: string[] = [];

  for (const testCase of cases) {
    const started = Date.now();
    try {
      const { draft } = await runAgentTurn({
        transcript: testCase.transcript ?? [],
        message: testCase.message,
        catalog, locations: [], previous: testCase.previous, citizen,
        latencyMode: "realtime",
      });
      timings.push(Date.now() - started);
      const failure = testCase.check(draft);
      if (failure) problems.push(`${testCase.name}: ${failure}`);
    } catch (error) {
      timings.push(Date.now() - started);
      problems.push(`${testCase.name}: THREW ${error instanceof Error ? error.message.slice(0, 80) : error}`);
    }
  }

  const avg = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
  const worst = Math.max(...timings);
  console.log(`\n${model}`);
  console.log(`  avg ${avg}ms   worst ${worst}ms   passed ${cases.length - problems.length}/${cases.length}`);
  for (const problem of problems) console.log(`  x ${problem}`);
}
