/**
 * Gemini reasoning provider.
 *
 * This is SAUTI1's primary reasoning path. It is fast enough for a live call --
 * Gemini Live stays silent until the turn result arrives, so latency here is
 * heard as dead air by the caller.
 *
 * Gemini models return 503 "high demand" often enough that a single model is
 * not a plan, so requests walk a chain with per-model cooldowns, the same shape
 * as the OpenRouter provider.
 */

import { GoogleGenAI } from "@google/genai";

import type { ChatMessage, CompletionResult } from "./openrouter";

export class GeminiUnavailableError extends Error {
  readonly attempts: { model: string; reason: string }[];

  constructor(attempts: { model: string; reason: string }[]) {
    super(
      attempts.length
        ? `No Gemini model answered. ${attempts.map((item) => `${item.model}: ${item.reason}`).join("; ")}`
        : "GEMINI_API_KEY is not configured."
    );
    this.name = "GeminiUnavailableError";
    this.attempts = attempts;
  }
}

/**
 * Ordered by measured behaviour on tests/quality.live.ts, not by version
 * number or size. Against that suite:
 *
 *   gemini-3.5-flash-lite     2.2s   0 failures
 *   gemini-flash-lite-latest  2.0s   0 failures
 *   gemini-3.6-flash          6.9s   7 failures
 *   gemini-3-flash-preview    4.9s   8 failures
 *   gemini-3.5 / 2.5 / 3.7-flash     503, no capacity on this key
 *
 * The larger models are not merely slower here: they re-ask for facts the
 * citizen has already given ("where is the electricity pole?" after the
 * citizen said Kireka), which is the exact behaviour this product exists to
 * avoid. Reach for a bigger model only with a suite run to back it up.
 */
const DEFAULT_GEMINI_CHAIN = [
  "gemini-3.5-flash-lite",
  // Alias, routed separately, so it often has capacity when the pinned
  // version is shedding load. Also scores 0 failures.
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiModelChain() {
  const configured = process.env.GEMINI_MODELS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_GEMINI_CHAIN;
}

const modelCooldownUntil = new Map<string, number>();

export function resetGeminiCooldownsForTests() {
  modelCooldownUntil.clear();
}

function cooldownMsFor(status: number | undefined) {
  if (status === 429) return 60_000;          // quota
  if (status === 503) return 20_000;          // "high demand", usually brief
  if (status === 404 || status === 400) return 10 * 60_000; // wrong model id
  if (status && status >= 500) return 30_000;
  return 10_000;
}

function isCoolingDown(model: string) {
  const until = modelCooldownUntil.get(model);
  if (!until) return false;
  if (until <= Date.now()) {
    modelCooldownUntil.delete(model);
    return false;
  }
  return true;
}

function statusOf(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/"code"\s*:\s*(\d{3})/) ?? message.match(/\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

type JsonSchema = Record<string, unknown>;

/**
 * Converts the JSON Schema used for OpenRouter into the OpenAPI-flavoured
 * subset Gemini accepts: no `additionalProperties`, and a nullable type is
 * expressed with a `nullable` flag rather than a type union.
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const converted: JsonSchema = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;

    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((item) => item !== "null");
      converted.type = types[0] ?? "string";
      if (types.length !== value.length) converted.nullable = true;
      continue;
    }

    if (key === "properties" && value && typeof value === "object") {
      converted.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>)
          .map(([name, child]) => [name, toGeminiSchema(child)])
      );
      continue;
    }

    if (key === "items" && value && typeof value === "object") {
      converted.items = toGeminiSchema(value as JsonSchema);
      continue;
    }

    converted[key] = value;
  }

  // Gemini cannot express a free-form string map (an object with no declared
  // properties). Degrading it to a plain string is worse than useless -- the
  // caller then iterates it and gets one entry per character -- so express it
  // as an array of key/value pairs, which both providers understand.
  if (converted.type === "object" && !converted.properties) {
    return {
      type: "array",
      description: schema.description,
      items: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"],
      },
    };
  }

  return converted;
}

export type GeminiRequest = {
  messages: ChatMessage[];
  schema?: JsonSchema;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  budgetMs?: number;
  models?: string[];
  validate?: (text: string) => boolean;
};

function splitMessages(messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const prompt = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
  return { system, prompt };
}

async function callModel(model: string, request: GeminiRequest, apiKey: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { system, prompt } = splitMessages(request.messages);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        abortSignal: controller.signal,
        systemInstruction: system || undefined,
        maxOutputTokens: request.maxOutputTokens ?? 1400,
        temperature: request.temperature ?? 0.4,
        // Only constrain the output when a schema was asked for. Guest replies
        // are plain prose, and forcing JSON on them returns a quoted string.
        ...(request.schema
          ? {
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(request.schema),
            }
          : {}),
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Empty Gemini completion.");
    if (request.validate && !request.validate(text)) {
      throw new Error("Gemini completion failed validation.");
    }

    const usage = response.usageMetadata;
    return {
      text,
      model,
      usage: {
        model,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        reasoningTokens: usage?.thoughtsTokenCount,
        totalTokens: usage?.totalTokenCount,
      },
    } satisfies CompletionResult;
  } finally {
    clearTimeout(timeout);
  }
}

/** Runs the Gemini chain until a model answers usefully. */
export async function completeWithGemini(request: GeminiRequest): Promise<CompletionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiUnavailableError([]);

  const chain = request.models?.length ? request.models : geminiModelChain();
  const timeoutMs = request.timeoutMs ?? 12_000;
  const deadline = Date.now() + (request.budgetMs ?? Number.POSITIVE_INFINITY);
  const attempts: { model: string; reason: string }[] = [];

  const ready = chain.filter((model) => !isCoolingDown(model));
  const order = ready.length ? ready : chain;

  for (const model of order) {
    const remaining = deadline - Date.now();
    if (remaining < 1_200) {
      attempts.push({ model, reason: "skipped, latency budget exhausted" });
      break;
    }

    const attemptTimeout = Math.min(timeoutMs, remaining);
    try {
      return await callModel(model, request, apiKey, attemptTimeout);
    } catch (error) {
      const reason = error instanceof Error
        ? (error.name === "AbortError" ? `timed out after ${attemptTimeout}ms` : error.message.slice(0, 200))
        : String(error);
      // A rejected-by-validation answer is the model's fault, not an outage;
      // do not cool the model down for it.
      if (!/failed validation/i.test(reason)) {
        modelCooldownUntil.set(model, Date.now() + cooldownMsFor(statusOf(error)));
      }
      attempts.push({ model, reason });
    }
  }

  throw new GeminiUnavailableError(attempts);
}
