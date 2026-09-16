import { complete, fastModelChain } from "../ai/openrouter";

import type { ReportDraft } from "./report-ai";

type GuestTurn = {
  role: "user" | "assistant";
  text: string;
};

export type GuestReply = {
  reply: string;
  engine: "openrouter" | "fallback";
  modelUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    thoughtTokens?: number;
    totalTokens?: number;
  };
};

/**
 * Guest mode is public and unauthenticated, so the reply must never solicit
 * personal data or imply that anything was stored.
 */
function validGuestReply(value: string | undefined) {
  const reply = value?.trim();
  if (!reply || reply.length > 500) return false;
  if (/\b(?:submitted|created a ticket|ticket (?:number|code)|routed this)\b/i.test(reply)) return false;
  if (/\b(?:full name|phone number|account number|meter number|reference number|password|pin)\b/i.test(reply)) return false;
  return true;
}

const GUEST_SYSTEM_PROMPT = `You are SAUTI1 in public preview mode, helping a
visitor who has not signed in.

Reply in at most 60 words, warm and direct, the way a knowledgeable neighbour
would. Build on what the visitor already said rather than restarting. Use the
verified understanding below as grounding for which service area this belongs to
- work that out yourself and never ask the visitor which institution, company or
agency is responsible.

Never claim anything was submitted, saved or filed: signing in is what makes a
real report. Never ask for a name, phone number, account number, reference
number, password or PIN.

Return only the reply text, with no quotes, labels or formatting.`;

export async function createGuestConversationReply(
  history: GuestTurn[],
  latestMessage: string,
  draft: ReportDraft
): Promise<GuestReply> {
  const fallback: GuestReply = { reply: draft.assistantReply, engine: "fallback" };

  const prompt = [
    history.length
      ? `Recent conversation:\n${history.slice(-4).map((turn) => `${turn.role === "user" ? "Visitor" : "SAUTI1"}: ${turn.text}`).join("\n")}`
      : "",
    `Visitor just said:\n${latestMessage}`,
    `Verified understanding:\n${JSON.stringify({
      intent: draft.intent,
      serviceArea: draft.institutionSlug ? draft.institutionName : null,
      category: draft.category,
      location: draft.locationText,
    })}`,
  ].filter(Boolean).join("\n\n");

  try {
    const result = await complete({
      messages: [
        { role: "system", content: GUEST_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      models: fastModelChain(),
      maxOutputTokens: 220,
      temperature: 0.5,
      timeoutMs: Math.min(9_000, Math.max(3_000, Number(process.env.GUEST_TIMEOUT_MS) || 7_000)),
      validate: validGuestReply,
    });

    return {
      reply: result.text.trim(),
      engine: "openrouter",
      modelUsage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        thoughtTokens: result.usage?.reasoningTokens,
        totalTokens: result.usage?.totalTokens,
      },
    };
  } catch (error) {
    console.warn(
      "Guest reply unavailable; using deterministic response.",
      error instanceof Error ? error.message : String(error)
    );
    return fallback;
  }
}
