/**
 * Measures how fast each candidate model returns a valid SAUTI1 turn decision.
 * Voice is only usable if some model answers inside the realtime budget.
 * Opt-in: costs one free-tier request per model.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

const { complete, parseJsonCompletion } = await import("../lib/ai/openrouter");

const schema = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["report", "information", "conversation"] },
    reply: { type: "string" },
    routing: {
      type: "object",
      properties: {
        institutionSlug: { type: ["string", "null"] },
        confidence: { type: "number" },
      },
      required: ["institutionSlug", "confidence"],
      additionalProperties: false,
    },
    knownFacts: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["intent", "reply", "routing", "knownFacts"],
  additionalProperties: false,
};

const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "dots-studio/dots-3-note-preview:free",
    ];

const prompt = `## Institution index (slug | name | sector)
uganda-police-force | Police | Security and public safety
nwsc | NWSC | Water and sanitation
kcca | KCCA | Roads and transport
mtn-uganda | MTN | Telecommunications

## The citizen just said
Thieves broke into my house last night in Ntinda and took my laptop.`;

for (const model of candidates) {
  const started = Date.now();
  try {
    const result = await complete({
      messages: [
        { role: "system", content: "You are SAUTI1, Uganda's civic reporting assistant. Route the citizen and reply in one or two sentences. Return only the JSON object." },
        { role: "user", content: prompt },
      ],
      models: [model],
      schema: { name: "t", schema },
      maxOutputTokens: 700,
      timeoutMs: 30_000,
    });
    const elapsed = Date.now() - started;
    const decision = parseJsonCompletion<{ reply: string; routing: { institutionSlug: string | null } }>(result.text);
    console.log(
      `${String(elapsed).padStart(6)}ms  ${model.padEnd(42)} -> ${decision.routing.institutionSlug ?? "(null)"}  out=${result.usage?.outputTokens}`
    );
    console.log(`         reply: ${decision.reply.slice(0, 110)}`);
  } catch (error) {
    console.log(`${String(Date.now() - started).padStart(6)}ms  ${model.padEnd(42)} -> FAILED: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
  }
}
