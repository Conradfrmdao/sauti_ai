/**
 * Gemini reasoning adapter.
 *
 * OpenRouter's free models take 12-27s on a full SAUTI1 turn, which is fine for
 * a text page and unusable on a live call: Gemini Live holds its tongue until
 * this result arrives, so the caller sits in silence for the whole round trip.
 *
 * Voice already depends on GEMINI_API_KEY for the Live API itself, so realtime
 * turns reuse that key for the reasoning step and keep sub-second-to-2s
 * latency. Text keeps running on OpenRouter.
 */

import { GoogleGenAI } from "@google/genai";

import type { CompletionResult } from "./openrouter";

export function geminiReasoningAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function realtimeGeminiModel() {
  return process.env.GEMINI_REALTIME_MODEL || "gemini-3.5-flash-lite";
}

type JsonSchema = Record<string, unknown>;

/**
 * Converts the JSON Schema used for OpenRouter into the OpenAPI-flavoured
 * subset Gemini accepts: no `additionalProperties`, and a nullable type is
 * expressed with a `nullable` flag rather than a type union.
 */
function toGeminiSchema(schema: JsonSchema): JsonSchema {
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

export async function completeWithGemini(options: {
  system: string;
  prompt: string;
  schema?: JsonSchema;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  validate?: (text: string) => boolean;
}): Promise<CompletionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const model = realtimeGeminiModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 9_000);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: options.prompt,
      config: {
        abortSignal: controller.signal,
        systemInstruction: options.system,
        maxOutputTokens: options.maxOutputTokens ?? 1400,
        temperature: options.temperature ?? 0.4,
        responseMimeType: "application/json",
        ...(options.schema ? { responseSchema: toGeminiSchema(options.schema) } : {}),
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Empty Gemini completion.");
    if (options.validate && !options.validate(text)) {
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
    };
  } finally {
    clearTimeout(timeout);
  }
}
