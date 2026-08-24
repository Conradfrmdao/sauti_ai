import assert from "node:assert/strict";

import { loadEnvConfig } from "@next/env";

import {
  InstitutionCatalogItem,
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
    description: "Crime reporting and public safety.",
    routing_keywords: ["police", "crime", "robbery", "theft", "burglary", "stolen"],
    institution_services: [
      service("Crime and public-safety report", "security_incident", ["crime", "theft", "robbery", "stolen"], ["location", "incident_time", "safety_status"]),
    ],
  },
  {
    id: "mtn",
    name: "MTN Uganda Limited",
    short_name: "MTN Uganda",
    slug: "mtn-uganda",
    sector: "Telecommunications",
    description: "Mobile and mobile money services.",
    routing_keywords: ["mtn", "mobile money", "airtime", "data", "network"],
    institution_services: [
      service("MTN Mobile Money", "mobile_money", ["mobile money", "transfer", "wallet"], ["transaction_reference", "amount", "transaction_time"]),
    ],
  },
  {
    id: "airtel",
    name: "Airtel Uganda Limited",
    short_name: "Airtel Uganda",
    slug: "airtel-uganda",
    sector: "Telecommunications",
    description: "Mobile and mobile money services.",
    routing_keywords: ["airtel", "mobile money", "airtime", "data", "network"],
    institution_services: [
      service("Airtel Money", "mobile_money", ["mobile money", "transfer", "wallet"], ["transaction_reference", "amount", "transaction_time"]),
    ],
  },
  {
    id: "nwsc",
    name: "National Water and Sewerage Corporation",
    short_name: "NWSC",
    slug: "nwsc-uganda",
    sector: "Water and sanitation",
    description: "Water supply and sewerage services.",
    routing_keywords: ["nwsc", "water", "water meter", "sewerage"],
    institution_services: [
      service("Water and sewerage service", "water_service", ["water", "water meter"], ["location", "customer_reference"]),
    ],
  },
  {
    id: "uedcl",
    name: "Uganda Electricity Distribution Company Limited",
    short_name: "UEDCL",
    slug: "uedcl-uganda",
    sector: "Electricity",
    description: "Electricity distribution services.",
    routing_keywords: ["uedcl", "electricity", "yaka", "meter"],
    institution_services: [
      service("Electricity distribution", "electricity_service", ["electricity", "yaka", "meter"], ["location", "account_or_meter_number"]),
    ],
  },
  {
    id: "nira",
    name: "National Identification and Registration Authority",
    short_name: "NIRA",
    slug: "nira-uganda",
    sector: "Identity and civil registration",
    description: "National ID, NIN, birth registration and identity corrections.",
    routing_keywords: ["nira", "nin", "national id", "identity card", "id card", "lost id"],
    institution_services: [
      service("Identity and civil registration", "identity_service", ["nin", "national id", "id card", "lost id"], ["service_type"]),
    ],
  },
];

async function understand(message: string) {
  return understandCitizenMessage(
    [{ role: "user", text: message }],
    message,
    catalog,
    [],
    undefined,
    { fullName: "Test Citizen", phone: "0772123456" }
  );
}

async function run() {
  assert.ok(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is required for the live AI scenarios.");
  resetGeminiBackoffForTests();

  const greeting = await understand("Hello, how are you doing?");
  assert.equal(greeting.engine, "gemini");
  assert.equal(greeting.intent, "conversation");
  assert.equal(greeting.institutionSlug, null);
  assert.doesNotMatch(greeting.assistantReply, /which company|public service|which institution/i);

  const burglary = await understand("Hello, someone broke into our house.");
  assert.equal(burglary.engine, "gemini");
  assert.equal(burglary.institutionSlug, "uganda-police-force");
  assert.doesNotMatch(burglary.assistantReply, /which company|public service|which institution/i);
  assert.match(burglary.assistantReply, /safe|danger|still happening/i);

  const blockedWallet = await understand("My Airtel Money account was blocked and I cannot access it.");
  assert.equal(blockedWallet.engine, "gemini");
  assert.equal(blockedWallet.institutionSlug, "airtel-uganda");
  assert.ok(!blockedWallet.missingFields.includes("amount"));
  assert.ok(!blockedWallet.missingFields.includes("transaction_reference"));

  const meter = await understand("My meter was stolen.");
  assert.equal(meter.engine, "gemini");
  assert.equal(meter.institutionSlug, null);
  assert.match(meter.assistantReply, /water meter|electricity|yaka/i);

  const lostId = await understand("I lost my ID.");
  assert.equal(lostId.engine, "gemini");
  assert.equal(lostId.institutionSlug, "nira-uganda");
  assert.equal(lostId.category, "identity_service");

  console.log("Live Gemini scenarios passed: greeting, burglary, blocked wallet, meter clarification, and lost-ID routing.");
}

void run();
