/**
 * OpenRouter provider client.
 *
 * SAUTI1 reasoning runs through OpenRouter so the model is a configuration
 * choice, not an architectural commitment. A request walks a model chain: the
 * first model that answers wins, and a model that is rate limited, unavailable
 * or returns unusable output is skipped for a cooling-off period so the next
 * citizen does not pay its latency again.
 */

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  model?: string;
};

export type CompletionResult = {
  text: string;
  model: string;
  usage?: ModelUsage;
};

export class ProviderUnavailableError extends Error {
  readonly attempts: { model: string; reason: string }[];

  constructor(attempts: { model: string; reason: string }[]) {
    super(
      attempts.length
        ? `No OpenRouter model answered. ${attempts.map((item) => `${item.model}: ${item.reason}`).join("; ")}`
        : "No OpenRouter model is configured."
    );
    this.name = "ProviderUnavailableError";
    this.attempts = attempts;
  }
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Extra completion budget reserved for reasoning traces. See callModel. */
const REASONING_TOKEN_HEADROOM = 2_500;

/**
 * Free-tier models that accept a strict JSON schema, ordered by measured
 * round-trip latency rather than raw capability -- a citizen waiting on a chat
 * reply is better served by a good answer in 8s than a better one in 90s.
 * Override with OPENROUTER_MODELS (comma separated) without touching code.
 */
const DEFAULT_MODEL_CHAIN = [
  "dots-studio/dots-3-note-preview:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nex-agi/nex-n2.5-pro:free",
];

/**
 * Short conversational replies do not need a schema, so the guest chain can use
 * any free model and prefer the fastest.
 */
const DEFAULT_FAST_MODEL_CHAIN = [
  "google/gemma-4-31b-it:free",
  "dots-studio/dots-3-note-preview:free",
  "google/gemma-4-26b-a4b-it:free",
];

function parseChain(value: string | undefined, fallback: string[]) {
  const configured = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured?.length ? configured : fallback;
}

export function reasoningModelChain() {
  return parseChain(process.env.OPENROUTER_MODELS, DEFAULT_MODEL_CHAIN);
}

export function fastModelChain() {
  return parseChain(process.env.OPENROUTER_FAST_MODELS, DEFAULT_FAST_MODEL_CHAIN);
}

/** Per-model cooldowns, so one bad model does not slow every later request. */
const modelCooldownUntil = new Map<string, number>();

export function resetProviderCooldownsForTests() {
  modelCooldownUntil.clear();
}

function cooldownMsFor(status: number | undefined, reason: string) {
  // A daily free-tier cap will not clear within a request window.
  if (status === 429 && /daily|per day|free-model/i.test(reason)) return 30 * 60_000;
  if (status === 429) return 60_000;
  if (status === 402) return 30 * 60_000;
  if (status === 404 || status === 400) return 10 * 60_000;
  if (status && status >= 500) return 30_000;
  return 15_000;
}

function markUnavailable(model: string, status: number | undefined, reason: string) {
  modelCooldownUntil.set(model, Date.now() + cooldownMsFor(status, reason));
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

type CompletionOptions = {
  messages: ChatMessage[];
  models?: string[];
  /** A JSON Schema. When set, the model is asked for strict structured output. */
  schema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  temperature?: number;
  /** Per-model timeout. */
  timeoutMs?: number;
  /**
   * Total wall-clock budget across the whole chain. Without this a three-model
   * chain can spend 3x timeoutMs before giving up, which is fine for a page
   * request and far too slow for a live voice turn where the caller is sitting
   * in silence waiting for a reply.
   */
  budgetMs?: number;
  /** Rejects a syntactically valid but useless answer so the chain continues. */
  validate?: (text: string) => boolean;
};

function referer() {
  const configured = process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!configured) return "https://sauti1.app";
  return configured.includes("://") ? configured : `https://${configured}`;
}

async function callModel(
  model: string,
  options: CompletionOptions,
  apiKey: string,
  timeoutMs: number
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter attributes traffic with these; they are not credentials.
        "HTTP-Referer": referer(),
        "X-Title": "SAUTI1",
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        // Reasoning tokens are billed against max_tokens, and the free models
        // spend most of their completion budget there. A cap sized for the
        // visible answer alone truncates the JSON mid-object.
        max_tokens: (options.maxOutputTokens ?? 1200) + REASONING_TOKEN_HEADROOM,
        temperature: options.temperature ?? 0.3,
        // Keep the reasoning short and out of the response: SAUTI1 only ever
        // uses the final answer, and long traces are the main latency cost.
        reasoning: { effort: "low", exclude: true },
        ...(options.schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: options.schema.name,
                  strict: true,
                  schema: options.schema.schema,
                },
              },
            }
          : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw Object.assign(new Error(detail.slice(0, 300) || response.statusText), {
        status: response.status,
      });
    }

    const payload = await response.json() as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
      error?: { message?: string; code?: number };
    };

    // OpenRouter can return a 200 whose body carries a provider-side error.
    if (payload.error) {
      throw Object.assign(new Error(payload.error.message || "Provider error."), {
        status: payload.error.code,
      });
    }

    const choice = payload.choices?.[0];
    // "length" means the model ran out of budget mid-object; "error" means the
    // upstream provider gave up. Either way the JSON is incomplete.
    if (choice?.finish_reason === "length" || choice?.finish_reason === "error") {
      throw new Error(`Truncated completion (${choice.finish_reason}).`);
    }

    const text = choice?.message?.content?.trim();
    if (!text) throw new Error("Empty completion.");
    if (options.validate && !options.validate(text)) {
      throw new Error("Completion failed validation.");
    }

    return {
      text,
      model,
      usage: {
        model,
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens,
        totalTokens: payload.usage?.total_tokens,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Runs the model chain until one answers usefully.
 * Throws ProviderUnavailableError only when every model in the chain failed.
 */
export async function complete(options: CompletionOptions): Promise<CompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new ProviderUnavailableError([]);

  const chain = options.models?.length ? options.models : reasoningModelChain();
  const timeoutMs = options.timeoutMs
    ?? (Number(process.env.OPENROUTER_TIMEOUT_MS) || 28_000);
  const budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;
  const deadline = Date.now() + budgetMs;
  const attempts: { model: string; reason: string }[] = [];

  const ready = chain.filter((model) => !isCoolingDown(model));
  // Every model is cooling down: try the chain anyway rather than fail blind.
  const order = ready.length ? ready : chain;

  for (const model of order) {
    const remaining = deadline - Date.now();
    // Not enough of the budget left to be worth another round trip: stop here
    // so the caller can fall back while the answer is still useful.
    if (remaining < 1_500) {
      attempts.push({ model, reason: "skipped, latency budget exhausted" });
      break;
    }

    const attemptTimeout = Math.min(timeoutMs, remaining);
    try {
      return await callModel(model, options, apiKey, attemptTimeout);
    } catch (error) {
      const status = (error as { status?: number }).status;
      const reason = error instanceof Error
        ? (error.name === "AbortError" ? `timed out after ${attemptTimeout}ms` : error.message)
        : String(error);
      markUnavailable(model, status, reason);
      attempts.push({ model, reason });
    }
  }

  throw new ProviderUnavailableError(attempts);
}

/**
 * Extracts a JSON object from a completion. Models with reasoning traces
 * sometimes wrap the object in prose or a fenced block even under a schema.
 */
export function parseJsonCompletion<T>(text: string): T {
  const direct = text.trim();
  const candidates = [direct];

  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = direct.indexOf("{");
  const lastBrace = direct.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(direct.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next extraction strategy.
    }
  }

  throw new Error("The model did not return parsable JSON.");
}
