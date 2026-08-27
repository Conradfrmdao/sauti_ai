import { NextResponse } from "next/server";

import { publicHttpsUrl } from "@/lib/channels/public-url";
import { validateTwilioSignature } from "@/lib/channels/twilio";
import {
  claimProviderWebhookEvent,
  finishProviderWebhookEvent,
  updateChannelSessionStatus,
} from "@/lib/sauti1/channel-conversation";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const webhookUrl = publicHttpsUrl(request, "/api/voice/twilio/status", process.env.TWILIO_WEBHOOK_BASE_URL);
  if (!authToken || !webhookUrl) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  if (!validateTwilioSignature(authToken, request.headers.get("x-twilio-signature"), webhookUrl, form)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
  }
  const callSid = form.get("CallSid") || "";
  const streamSid = form.get("StreamSid") || "unknown";
  const streamEvent = form.get("StreamEvent") || "unknown";
  if (!/^CA[a-f0-9]{32}$/i.test(callSid)) return NextResponse.json({ error: "Invalid call." }, { status: 400 });
  const eventId = `stream:${streamSid}:${streamEvent}`;
  const claim = await claimProviderWebhookEvent({
    provider: "twilio",
    eventId,
    eventType: `voice.${streamEvent}`,
    payload: Object.fromEntries(form),
  });
  if (!claim.claimed) return NextResponse.json({ accepted: true, duplicate: true });
  try {
    const failed = streamEvent === "stream-error";
    const close = failed || streamEvent === "stream-stopped";
    await updateChannelSessionStatus({
      provider: "twilio",
      providerConversationId: callSid,
      status: failed ? `error:${form.get("StreamError") || "unknown"}` : streamEvent,
      close,
    });
    await finishProviderWebhookEvent(claim.databaseId, "processed");
    return NextResponse.json({ accepted: true });
  } catch (error) {
    await finishProviderWebhookEvent(claim.databaseId, "failed").catch(() => undefined);
    throw error;
  }
}
