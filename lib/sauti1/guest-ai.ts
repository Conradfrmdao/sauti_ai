import { GoogleGenAI, ThinkingLevel } from "@google/genai";

import type { ReportDraft } from "./report-ai";

type GuestTurn = {
  role: "user" | "assistant";
  text: string;
};

export type GuestReply = {
  reply: string;
  engine: "gemini" | "fallback";
  modelUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    thoughtTokens?: number;
    totalTokens?: number;
  };
};

function validGuestReply(value: string | undefined) {
  const reply = value?.trim();
  if (!reply || reply.length > 500) return false;
  if (/\b(?:submitted|created a ticket|ticket (?:number|code)|routed this)\b/i.test(reply)) return false;
  if (/\b(?:full name|phone number|account number|meter number|reference number|password|pin)\b/i.test(reply)) return false;
  return true;
}

function guestThinkingLevel() {
  switch (process.env.GEMINI_GUEST_THINKING_LEVEL?.toLowerCase()) {
    case "minimal":
      return ThinkingLevel.MINIMAL;
    case "medium":
      return ThinkingLevel.MEDIUM;
    case "high":
      return ThinkingLevel.HIGH;
    default:
      return ThinkingLevel.LOW;
  }
}

export async function createGuestConversationReply(
  history: GuestTurn[],
  latestMessage: string,
  draft: ReportDraft
): Promise<GuestReply> {
  const fallback: GuestReply = { reply: draft.assistantReply, engine: "fallback" };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback;

  const timeoutMs = Math.min(
    6_000,
    Math.max(2_000, Number(process.env.GEMINI_GUEST_TIMEOUT_MS) || 4_500)
  );
  const prompt = JSON.stringify({
    recentConversation: history.slice(-4),
    latestCitizenMessage: latestMessage,
    verifiedUnderstanding: {
      intent: draft.intent,
      institution: draft.institutionSlug ? draft.institutionName : null,
      category: draft.category,
      location: draft.locationText,
    },
    baselineReply: draft.assistantReply,
  });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: prompt,
      config: {
        httpOptions: { timeout: timeoutMs },
        maxOutputTokens: 180,
        temperature: 0.35,
        thinkingConfig: {
          thinkingLevel: guestThinkingLevel(),
        },
        systemInstruction: `You are SAUTI1 AI in public guest mode. Reply naturally and concisely in no more than 70 words. Be warm, direct and useful. Use the verified understanding and baseline reply as grounding. Never claim a report was submitted or saved. Do not request names, phone numbers, account identifiers, passwords or other private details. Invite the citizen to describe the public-service issue they need help with when appropriate. Return only the reply text.`,
      },
    });
    const reply = response.text?.trim();
    if (!validGuestReply(reply)) return fallback;

    const usage = response.usageMetadata;
    return {
      reply: reply as string,
      engine: "gemini",
      modelUsage: usage
        ? {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            thoughtTokens: usage.thoughtsTokenCount,
            totalTokens: usage.totalTokenCount,
          }
        : undefined,
    };
  } catch (error) {
    console.warn(
      "Guest Gemini reply unavailable; using deterministic response.",
      error instanceof Error ? error.message : String(error)
    );
    return fallback;
  }
}
