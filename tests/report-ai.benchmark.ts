import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { loadEnvConfig } from "@next/env";

import {
  InstitutionCatalogItem,
  ReportDraft,
  resetGeminiBackoffForTests,
  understandCitizenMessage,
} from "../lib/sauti1/report-ai";

loadEnvConfig(process.cwd());

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
      service("Mobile network and airtime", "telecom_service", ["airtime", "data", "bundle", "sim", "network", "calls"], ["affected_phone_number", "approximate_time"]),
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
      service("Mobile network and airtime", "telecom_service", ["airtime", "data", "bundle", "sim", "network", "calls"], ["affected_phone_number", "approximate_time"]),
    ],
  },
  {
    id: "nwsc",
    name: "National Water and Sewerage Corporation",
    short_name: "NWSC",
    slug: "nwsc-uganda",
    sector: "Water and sanitation",
    description: "Water supply and sewerage services.",
    routing_keywords: ["nwsc", "water", "water meter", "no water"],
    institution_services: [
      service("Water and sewerage service", "water_service", ["water", "water meter", "no water"], ["location", "customer_reference"]),
    ],
  },
  {
    id: "uedcl",
    name: "Uganda Electricity Distribution Company Limited",
    short_name: "UEDCL",
    slug: "uedcl-uganda",
    sector: "Electricity",
    description: "Electricity distribution, Yaka and outage services.",
    routing_keywords: ["uedcl", "electricity", "yaka", "meter", "blackout", "power"],
    institution_services: [
      service("Electricity distribution", "electricity_service", ["electricity", "yaka", "meter", "blackout", "power"], ["location", "account_or_meter_number"]),
    ],
  },
  {
    id: "uneb",
    name: "Uganda National Examinations Board",
    short_name: "UNEB",
    slug: "uneb-uganda",
    sector: "Education and examinations",
    description: "Examination results, pass slips and certificates.",
    routing_keywords: ["uneb", "exam", "examination", "results", "pass slip", "candidate", "senior 4"],
    institution_services: [
      service("Examinations and results", "examination_service", ["exam", "result", "pass slip", "certificate", "candidate", "senior 4"], ["candidate_name", "candidate_index_number", "examination_level", "examination_year", "document_issue"]),
    ],
  },
];

type Scenario = {
  name: string;
  message: string;
  expectedSlug?: string | null;
  expectedCategory?: string;
  replyMustMatch?: RegExp;
  replyMustNotMatch?: RegExp;
  requiredMissing?: string[];
  expectedEvidenceState?: ReportDraft["semanticState"]["evidenceState"];
  previous?: Partial<ReportDraft>;
};

const scenarios: Scenario[] = [
  {
    name: "casual greeting",
    message: "Hello, how are you doing?",
    expectedSlug: null,
    replyMustNotMatch: /which company|public service|which institution/i,
  },
  {
    name: "burglary safety first",
    message: "Thieves broke into my house last night.",
    expectedSlug: "uganda-police-force",
    expectedCategory: "security_incident",
    replyMustMatch: /safe|danger|left|happening/i,
  },
  {
    name: "ambiguous meter",
    message: "My meter was stolen.",
    expectedSlug: null,
    replyMustMatch: /water|electricity|yaka/i,
    replyMustNotMatch: /which company|public service|which institution/i,
  },
  {
    name: "water meter routing",
    message: "It was a water meter.",
    expectedSlug: "nwsc-uganda",
    expectedCategory: "water_service",
  },
  {
    name: "yaka meter routing",
    message: "It was a Yaka meter.",
    expectedSlug: "uedcl-uganda",
    expectedCategory: "electricity_service",
  },
  {
    name: "uneb pass slip",
    message: "There is a mistake in my surname on my Senior 4 pass slip.",
    expectedSlug: "uneb-uganda",
    expectedCategory: "examination_service",
  },
  {
    name: "mtn fraud",
    message: "A person called me claiming to be MTN and asked for my Mobile Money PIN.",
    expectedSlug: "mtn-uganda",
    expectedCategory: "mobile_money",
    requiredMissing: ["information_shared", "financial_loss"],
  },
  {
    name: "airtel blocked wallet",
    message: "My Airtel Money account was blocked and I cannot access it.",
    expectedSlug: "airtel-uganda",
    expectedCategory: "mobile_money",
    requiredMissing: ["affected_phone_number", "approximate_time"],
  },
  {
    name: "mtn data issue",
    message: "My MTN data bundle disappeared.",
    expectedSlug: "mtn-uganda",
    expectedCategory: "telecom_service",
  },
  {
    name: "no evidence",
    message: "I don't have any evidence.",
    previous: {
      intent: "report",
      description: "Thieves broke into my house last night.",
      category: "security_incident",
      institutionSlug: "uganda-police-force",
      institutionName: "Uganda Police",
      intakeData: { evidence_available: "photos of the damaged door" },
      locationText: "Lungujja, Kampala, Uganda",
    },
    expectedSlug: "uganda-police-force",
    expectedEvidenceState: "none",
  },
];

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
}

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evaluate(scenario: Scenario, draft: ReportDraft) {
  const checks = {
    routing: scenario.expectedSlug === undefined || draft.institutionSlug === scenario.expectedSlug,
    category: !scenario.expectedCategory || draft.category === scenario.expectedCategory,
    followUp: !scenario.replyMustMatch || scenario.replyMustMatch.test(draft.assistantReply),
    noBureaucracy: !/which company|public service|which institution|government agency/i.test(draft.assistantReply),
    noForbiddenReply: !scenario.replyMustNotMatch || !scenario.replyMustNotMatch.test(draft.assistantReply),
    requiredMissing: (scenario.requiredMissing ?? []).every((field) => draft.missingFields.includes(field)),
    evidence: !scenario.expectedEvidenceState || draft.semanticState.evidenceState === scenario.expectedEvidenceState,
    contextualState: Boolean(draft.semanticState?.conversationStage && draft.semanticState?.routingState),
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

async function runEffort(thinkingLevel: "low" | "medium") {
  process.env.GEMINI_THINKING_LEVEL = thinkingLevel;
  process.env.GEMINI_TURN_TIMEOUT_MS = "30000";
  resetGeminiBackoffForTests();
  const durations: number[] = [];
  const inputTokens: number[] = [];
  const outputTokens: number[] = [];
  const thoughtTokens: number[] = [];
  const totalTokens: number[] = [];
  let fallbackCount = 0;
  const results = [];

  for (const scenario of scenarios) {
    let startedAt = performance.now();
    let draft: ReportDraft | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await wait(70_000);
        resetGeminiBackoffForTests();
        startedAt = performance.now();
      }
      draft = await understandCitizenMessage(
        [{ role: "user", text: scenario.message }],
        scenario.message,
        catalog,
        [],
        scenario.previous,
        { fullName: "Test Citizen", phone: "0772123456" }
      );
      if (draft.engine === "gemini") break;
    }
    assert.ok(draft);
    const elapsed = Math.round(performance.now() - startedAt);
    const evaluation = evaluate(scenario, draft);
    if (draft.engine === "fallback") fallbackCount += 1;
    else durations.push(elapsed);
    if (draft.modelUsage?.inputTokens) inputTokens.push(draft.modelUsage.inputTokens);
    if (draft.modelUsage?.outputTokens) outputTokens.push(draft.modelUsage.outputTokens);
    if (draft.modelUsage?.thoughtTokens) thoughtTokens.push(draft.modelUsage.thoughtTokens);
    if (draft.modelUsage?.totalTokens) totalTokens.push(draft.modelUsage.totalTokens);

    results.push({
      name: scenario.name,
      engine: draft.engine,
      latencyMs: elapsed,
      passed: evaluation.passed,
      checks: evaluation.checks,
      slug: draft.institutionSlug,
      category: draft.category,
      questionPurpose: draft.semanticState.questionPurpose,
      evidenceState: draft.semanticState.evidenceState,
      usage: draft.modelUsage ?? null,
      assistantReply: draft.assistantReply,
    });
    await wait(25_000);
  }

  const passedCount = results.filter((item) => item.passed).length;
  return {
    thinkingLevel,
    scenarioCount: scenarios.length,
    passedCount,
    qualityScore: Number((passedCount / scenarios.length).toFixed(3)),
    fallbackCount,
    fallbackRate: Number((fallbackCount / scenarios.length).toFixed(3)),
    modelSampleCount: durations.length,
    p50Ms: durations.length ? Math.round(percentile(durations, 0.5)) : null,
    p95Ms: durations.length ? Math.round(percentile(durations, 0.95)) : null,
    tokenUsage: {
      avgInputTokens: Math.round(mean(inputTokens)),
      avgOutputTokens: Math.round(mean(outputTokens)),
      avgThoughtTokens: Math.round(mean(thoughtTokens)),
      avgTotalTokens: Math.round(mean(totalTokens)),
    },
    results,
  };
}

async function run() {
  assert.ok(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is required for live low/medium benchmarking.");
  const low = await runEffort("low");
  const medium = await runEffort("medium");
  console.log(JSON.stringify({ low, medium }, null, 2));
  assert.equal(low.fallbackCount, 0, "Low thinking fell back for one or more benchmark scenarios.");
  assert.equal(medium.fallbackCount, 0, "Medium thinking fell back for one or more benchmark scenarios.");
}

void run();
