/**
 * SAUTI1 conversation quality suite.
 *
 * Realistic Ugandan civic scenarios with assertions about what a good turn
 * looks like: correct routing, no question the citizen has already answered,
 * no asking who is responsible, and questions a neighbour would actually ask.
 *
 * Run against any model:  npx jiti tests/quality.live.ts gemini-3.5-flash
 * Opt-in; uses live quota.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}
process.env.OPENROUTER_ENABLED = "false";

const { runAgentTurn } = await import("../lib/sauti1/agent");
import type { InstitutionCatalogItem, ReportDraft } from "../lib/sauti1/report-ai";

function institution(
  slug: string, name: string, short: string, sector: string,
  keywords: string[], services: { key: string; name: string; keywords: string[]; fields: string[] }[],
  emergency?: string
): InstitutionCatalogItem {
  return {
    id: slug, name, short_name: short, slug, sector,
    description: `${name} handles ${sector.toLowerCase()}.`,
    emergency_phone: emergency ?? null, contact_phone: "0800000000",
    head_office_address: null, operating_hours: "Mon-Fri 8-5", jurisdiction: "National",
    routing_keywords: keywords,
    institution_services: services.map((s) => ({
      name: s.name, category_key: s.key,
      description: s.name, routing_keywords: s.keywords, required_fields: s.fields,
    })),
    knowledge_documents: [],
  };
}

const catalog: InstitutionCatalogItem[] = [
  institution("uganda-police-force", "Uganda Police Force", "Police", "Security and public safety",
    ["crime", "theft", "burglary", "assault", "police"],
    [{ key: "security_incident", name: "Security incident", keywords: ["burglary", "theft", "assault"], fields: ["location", "incident_time"] }],
    "999"),
  institution("nwsc", "National Water and Sewerage Corporation", "NWSC", "Water and sanitation",
    ["water", "tap", "sewer", "burst pipe", "water meter"],
    [{ key: "water_supply", name: "Water supply fault", keywords: ["no water", "burst", "sewage"], fields: ["location", "account_or_meter_number"] }]),
  institution("umeme", "Umeme Limited", "Umeme", "Electricity",
    ["power", "electricity", "yaka", "blackout", "transformer", "electricity pole", "power line"],
    [{ key: "power_fault", name: "Power fault", keywords: ["blackout", "no power", "yaka", "pole", "transformer", "power line"], fields: ["location"] }],
    "0800185185"),
  institution("kcca", "Kampala Capital City Authority", "KCCA", "Roads and transport",
    ["pothole", "road", "drainage", "garbage", "street light"],
    [{ key: "road_defect", name: "Road defect", keywords: ["pothole", "road", "drainage"], fields: ["location"] }]),
  institution("mtn-uganda", "MTN Uganda", "MTN", "Telecommunications",
    ["mtn", "mobile money", "momo", "airtime"],
    [{ key: "mobile_money", name: "Mobile money dispute", keywords: ["mobile money", "momo", "sent money"], fields: ["transaction_reference", "amount"] }]),
];

const citizen = { fullName: "Conrad Wagaba", phone: "+256770000000" };

type Turn = { say: string; expect: (draft: ReportDraft) => string | null };
type Scenario = { name: string; turns: Turn[] };

const asked = (d: ReportDraft) => d.assistantReply.toLowerCase();

/** Questions that mean SAUTI1 failed to do its own job. */
function bureaucracyQuestion(reply: string) {
  return /which (institution|company|agency|government body|public body|provider|utility)/.test(reply);
}

const scenarios: Scenario[] = [
  {
    name: "electricity pole down (the reported complaint)",
    turns: [
      {
        say: "There is an electricity pole that fell down near our home in Kireka and the wires are on the road.",
        expect: (d) => {
          if (d.institutionSlug !== "umeme") return `routed to ${d.institutionSlug ?? "nobody"}, expected umeme`;
          const r = asked(d);
          if (bureaucracyQuestion(r)) return "asked which company";
          // It already said Kireka. Asking "where is the pole" again is the bug.
          if (/where (is|are|was) the (pole|electricity pole)/.test(r)) return "re-asked where the pole is";
          if (!d.intakeData.location) return "did not capture Kireka as the location";
          if (d.priority === "low" || d.priority === "normal") return `live wires on a road rated ${d.priority}`;
          return null;
        },
      },
      {
        say: "Yes the wires are sparking and children pass there.",
        expect: (d) => {
          const r = asked(d);
          if (/where|which area|what place/.test(r)) return "re-asked location after it was given";
          if (d.priority !== "critical" && d.priority !== "high") return `sparking wires near children rated ${d.priority}`;
          return null;
        },
      },
    ],
  },
  {
    name: "blackout, whole area",
    turns: [{
      say: "We have had no power in Ntinda since yesterday evening.",
      expect: (d) => {
        if (d.institutionSlug !== "umeme") return `routed to ${d.institutionSlug ?? "nobody"}`;
        if (bureaucracyQuestion(asked(d))) return "asked which company";
        if (!d.intakeData.location) return "lost the location";
        if (/when|since when|what time/.test(asked(d))) return "re-asked when it started";
        return null;
      },
    }],
  },
  {
    name: "ambiguous meter asks about the thing, not the company",
    turns: [{
      say: "My meter was stolen.",
      expect: (d) => {
        const r = asked(d);
        if (bureaucracyQuestion(r)) return "asked which company";
        if (!/water|yaka|electric/.test(r)) return "did not ask which kind of meter";
        return null;
      },
    }],
  },
  {
    name: "burglary infers everything from one sentence",
    turns: [{
      say: "Thieves broke into my shop in Ntinda last night and took two laptops.",
      expect: (d) => {
        if (d.institutionSlug !== "uganda-police-force") return `routed to ${d.institutionSlug ?? "nobody"}`;
        const r = asked(d);
        if (/where (did|do)|which area|what time|when did/.test(r)) return "re-asked a fact already given";
        if (!d.intakeData.location) return "lost the location";
        return null;
      },
    }],
  },
  {
    name: "mobile money",
    turns: [{
      say: "I sent 200,000 on MTN mobile money yesterday but it never reached.",
      expect: (d) => {
        if (d.institutionSlug !== "mtn-uganda") return `routed to ${d.institutionSlug ?? "nobody"}`;
        if (bureaucracyQuestion(asked(d))) return "asked which network after MTN was named";
        return null;
      },
    }],
  },
  {
    name: "small talk stays small talk",
    turns: [{
      say: "Hello, how are you?",
      expect: (d) => {
        if (d.intent === "report") return "treated a greeting as a report";
        if (d.assistantReply.length > 260) return "over-answered a greeting";
        return null;
      },
    }],
  },
  {
    name: "does not ask for name or phone, they are on file",
    turns: [{
      say: "The road to our school floods every time it rains, in Bweyogerere.",
      expect: (d) => {
        const r = asked(d);
        if (/your (full )?name|phone number|contact number/.test(r)) return "asked for details already on file";
        if (d.institutionSlug !== "kcca") return `routed to ${d.institutionSlug ?? "nobody"}`;
        return null;
      },
    }],
  },
];

const model = process.argv[2];
if (model) process.env.GEMINI_MODELS = model;

let failures = 0;
let totalMs = 0;
let turns = 0;

for (const scenario of scenarios) {
  const transcript: { role: "user" | "assistant"; text: string }[] = [];
  let previous: Partial<ReportDraft> | undefined;
  console.log(`\n== ${scenario.name}`);

  for (const turn of scenario.turns) {
    const started = Date.now();
    let draft: ReportDraft;
    try {
      ({ draft } = await runAgentTurn({
        transcript: [...transcript], message: turn.say, catalog, locations: [],
        previous, citizen, latencyMode: "realtime",
      }));
    } catch (error) {
      console.log(`  citizen: ${turn.say}`);
      console.log(`  THREW: ${error instanceof Error ? error.message.slice(0, 140) : error}`);
      failures += 1;
      continue;
    }
    const elapsed = Date.now() - started;
    totalMs += elapsed; turns += 1;

    const problem = turn.expect(draft);
    console.log(`  citizen: ${turn.say}`);
    console.log(`  SAUTI1 : ${draft.assistantReply}`);
    console.log(`  route=${draft.institutionSlug ?? "-"} priority=${draft.priority} ready=${draft.readyToConfirm} ${elapsed}ms`);
    if (problem) { console.log(`  FAIL   ${problem}`); failures += 1; }

    transcript.push({ role: "user", text: turn.say }, { role: "assistant", text: draft.assistantReply });
    previous = draft;
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`model: ${model ?? "(default chain)"}`);
console.log(`turns: ${turns}   avg ${Math.round(totalMs / Math.max(1, turns))}ms   failures: ${failures}`);
process.exitCode = failures ? 1 : 0;
