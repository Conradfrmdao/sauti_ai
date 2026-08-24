import { NextResponse } from "next/server";

import { createGuestConversationReply } from "@/lib/sauti1/guest-ai";
import { guestInstitutionCatalog, guestKnownLocations } from "@/lib/sauti1/guest-catalog";
import { ReportDraft, understandCitizenMessageDeterministically } from "@/lib/sauti1/report-ai";

type GuestTurn = {
  role: "user" | "assistant";
  text: string;
};

type GuestRequest = {
  message?: unknown;
  history?: unknown;
  context?: unknown;
};

type GuestContext = Pick<
  ReportDraft,
  | "description"
  | "summary"
  | "category"
  | "institutionSlug"
  | "institutionName"
  | "priority"
  | "confidence"
  | "locationText"
  | "intakeData"
>;

const guestWindowMs = 10 * 60 * 1000;
const guestRequestLimit = 12;
const guestBuckets = new Map<string, { count: number; resetAt: number }>();

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return process.env.NODE_ENV !== "production";

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(bytes).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withinGuestLimit(request: Request) {
  const now = Date.now();
  const key = await requestFingerprint(request);
  const existing = guestBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    guestBuckets.set(key, { count: 1, resetAt: now + guestWindowMs });
    return true;
  }

  if (existing.count >= guestRequestLimit) return false;
  existing.count += 1;
  return true;
}

function cleanHistory(value: unknown): GuestTurn[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-10)
    .filter((item): item is { role: string; text: string } => Boolean(
      item &&
      typeof item === "object" &&
      "role" in item &&
      "text" in item &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.text === "string"
    ))
    .map((item) => ({ role: item.role as GuestTurn["role"], text: item.text.trim().slice(0, 1200) }))
    .filter((item) => item.text.length > 0);
}

function cleanContext(value: unknown): Partial<GuestContext> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const priorities = new Set(["low", "normal", "high", "critical"]);
  const intakeData = input.intakeData && typeof input.intakeData === "object"
    ? Object.fromEntries(
        Object.entries(input.intakeData as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .slice(0, 24)
          .map(([key, entry]) => [key.slice(0, 80), entry.trim().slice(0, 300)])
      )
    : {};

  return {
    description: typeof input.description === "string" ? input.description.slice(0, 2500) : undefined,
    summary: typeof input.summary === "string" ? input.summary.slice(0, 1200) : undefined,
    category: typeof input.category === "string" ? input.category.slice(0, 120) : undefined,
    institutionSlug: typeof input.institutionSlug === "string" ? input.institutionSlug.slice(0, 120) : null,
    institutionName: typeof input.institutionName === "string" ? input.institutionName.slice(0, 160) : undefined,
    priority: typeof input.priority === "string" && priorities.has(input.priority)
      ? input.priority as ReportDraft["priority"]
      : undefined,
    confidence: typeof input.confidence === "number" ? Math.min(1, Math.max(0, input.confidence)) : undefined,
    locationText: typeof input.locationText === "string" ? input.locationText.slice(0, 300) : null,
    intakeData,
  };
}

function guestContext(draft: ReportDraft): GuestContext {
  return {
    description: draft.description,
    summary: draft.summary,
    category: draft.category,
    institutionSlug: draft.institutionSlug,
    institutionName: draft.institutionName,
    priority: draft.priority,
    confidence: draft.confidence,
    locationText: draft.locationText,
    intakeData: draft.intakeData,
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This guest conversation must start on SAUTI1." }, { status: 403 });
  }
  if (!await withinGuestLimit(request)) {
    return NextResponse.json(
      { error: "You have reached the guest conversation limit. Sign in to continue with SAUTI1." },
      { status: 429 }
    );
  }

  let body: GuestRequest;
  try {
    body = await request.json() as GuestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });
  if (message.length > 1200) {
    return NextResponse.json({ error: "Keep a guest message below 1,200 characters." }, { status: 400 });
  }

  const history = cleanHistory(body.history);
  const historyLength = history.reduce((total, turn) => total + turn.text.length, 0);
  if (historyLength > 8000) {
    return NextResponse.json({ error: "Start a new guest conversation to continue." }, { status: 400 });
  }

  const draft = understandCitizenMessageDeterministically(
    message,
    guestInstitutionCatalog,
    guestKnownLocations,
    cleanContext(body.context)
  );
  const nextQuestionField = draft.semanticState.nextQuestionField || "";
  const accountOnlyQuestion = /(?:name|phone|account|meter|reference|candidate|application|case|person)/i
    .test(nextQuestionField);
  const requiresAccount = draft.readyToConfirm || Boolean(draft.institutionSlug && accountOnlyQuestion);
  const generatedReply = draft.intent === "conversation" && !requiresAccount
    ? await createGuestConversationReply(history, message, draft)
    : { reply: draft.assistantReply, engine: "fallback" as const };
  const assistantReply = requiresAccount
    ? `I understand the issue and can prepare it for ${draft.institutionName}. Sign in to continue securely, submit the report and track its progress.`
    : generatedReply.reply;

  return NextResponse.json({
    reply: assistantReply,
    intent: draft.intent,
    institutionName: draft.institutionSlug ? draft.institutionName : null,
    engine: draft.intent === "conversation" ? generatedReply.engine : "catalog",
    context: guestContext(draft),
  }, { headers: { "Cache-Control": "no-store" } });
}
