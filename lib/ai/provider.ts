/**
 * Reasoning provider selection.
 *
 * SAUTI1 runs on Gemini by default. It is the fastest correct option measured
 * on a real turn (1.6s vs 12-27s for the free OpenRouter models), and voice
 * cannot tolerate more: Gemini Live holds its reply until the turn returns, so
 * every second here is silence on the call.
 *
 * OpenRouter stays wired up as an opt-in alternative -- flip REASONING_PROVIDER
 * to "openrouter", or set OPENROUTER_ENABLED=true to keep it as a backstop
 * behind Gemini. Nothing in the agent knows or cares which one answered.
 */

import {
  completeWithGemini,
  geminiAvailable,
  GeminiUnavailableError,
  type GeminiRequest,
} from "./gemini";
import {
  complete as completeWithOpenRouter,
  ProviderUnavailableError,
  type ChatMessage,
  type CompletionResult,
} from "./openrouter";

export type ProviderName = "gemini" | "openrouter";

export class NoProviderAvailableError extends Error {
  constructor(public readonly attempts: { provider: ProviderName; reason: string }[]) {
    super(
      attempts.length
        ? `No reasoning provider answered. ${attempts.map((a) => `${a.provider}: ${a.reason}`).join(" | ")}`
        : "No reasoning provider is configured."
    );
    this.name = "NoProviderAvailableError";
  }
}

function truthy(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * OpenRouter is off unless explicitly enabled, so a stray key cannot silently
 * put slow models on the voice path.
 */
export function openRouterEnabled() {
  if (!process.env.OPENROUTER_API_KEY) return false;
  if (process.env.REASONING_PROVIDER === "openrouter") return true;
  return truthy(process.env.OPENROUTER_ENABLED);
}

export function providerOrder(): ProviderName[] {
  const preferred = process.env.REASONING_PROVIDER === "openrouter" ? "openrouter" : "gemini";
  const order: ProviderName[] = preferred === "openrouter"
    ? ["openrouter", "gemini"]
    : ["gemini", "openrouter"];

  return order.filter((provider) => provider === "gemini" ? geminiAvailable() : openRouterEnabled());
}

export type ReasoningRequest = {
  messages: ChatMessage[];
  schema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  temperature?: number;
  /** Per-model timeout within a provider's chain. */
  timeoutMs?: number;
  /** Wall-clock budget for the whole attempt, across providers. */
  budgetMs?: number;
  validate?: (text: string) => boolean;
};

export type ReasoningResult = CompletionResult & { provider: ProviderName };

/**
 * Tries each configured provider in order, sharing one latency budget so a
 * fallback can never push a live turn past its deadline.
 */
export async function runReasoning(request: ReasoningRequest): Promise<ReasoningResult> {
  const order = providerOrder();
  if (!order.length) throw new NoProviderAvailableError([]);

  const deadline = Date.now() + (request.budgetMs ?? Number.POSITIVE_INFINITY);
  const attempts: { provider: ProviderName; reason: string }[] = [];

  for (const provider of order) {
    const remaining = deadline - Date.now();
    if (remaining < 1_200) {
      attempts.push({ provider, reason: "skipped, latency budget exhausted" });
      break;
    }

    try {
      if (provider === "gemini") {
        const geminiRequest: GeminiRequest = {
          messages: request.messages,
          schema: request.schema?.schema,
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
          timeoutMs: request.timeoutMs,
          budgetMs: Number.isFinite(remaining) ? remaining : undefined,
          validate: request.validate,
        };
        const result = await completeWithGemini(geminiRequest);
        return { ...result, provider };
      }

      const result = await completeWithOpenRouter({
        messages: request.messages,
        schema: request.schema,
        maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature,
        timeoutMs: request.timeoutMs,
        budgetMs: Number.isFinite(remaining) ? remaining : undefined,
        validate: request.validate,
      });
      return { ...result, provider };
    } catch (error) {
      const reason = error instanceof GeminiUnavailableError || error instanceof ProviderUnavailableError
        ? error.message
        : error instanceof Error ? error.message : String(error);
      attempts.push({ provider, reason: reason.slice(0, 300) });
    }
  }

  throw new NoProviderAvailableError(attempts);
}
