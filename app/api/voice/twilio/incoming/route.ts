import { NextResponse } from "next/server";

import { normalizeE164PhoneNumber } from "@/lib/channels/phone";
import { publicHttpsUrl, publicWebSocketUrl } from "@/lib/channels/public-url";
import { buildTwilioStreamTwiML, validateTwilioSignature } from "@/lib/channels/twilio";
import { createTwilioStreamToken } from "@/lib/channels/twilio-voice";
import { ensureChannelSession } from "@/lib/sauti1/channel-conversation";

export const runtime = "nodejs";
export const maxDuration = 30;

function xml(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function rejectTwiML(message: string, status: number) {
  const safe = message.replace(/[<>&"']/g, "");
  return xml(`<?xml version="1.0"?><Response><Say>${safe}</Say><Hangup /></Response>`, status);
}

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const webhookUrl = publicHttpsUrl(request, "/api/voice/twilio/incoming", process.env.TWILIO_WEBHOOK_BASE_URL);
  if (!authToken || !webhookUrl) return rejectTwiML("Voice service is not configured.", 503);
  if (!validateTwilioSignature(authToken, request.headers.get("x-twilio-signature"), webhookUrl, form)) {
    return rejectTwiML("Unauthorized.", 403);
  }
  const accountSid = form.get("AccountSid") || "";
  const callSid = form.get("CallSid") || "";
  const from = normalizeE164PhoneNumber(form.get("From") || "");
  if (process.env.TWILIO_ACCOUNT_SID && accountSid !== process.env.TWILIO_ACCOUNT_SID) {
    return rejectTwiML("Unauthorized account.", 403);
  }
  if (!/^CA[a-f0-9]{32}$/i.test(callSid) || !from) {
    return rejectTwiML("Invalid call details.", 400);
  }
  await ensureChannelSession({
    phoneE164: from,
    channel: "phone",
    provider: "twilio",
    providerConversationId: callSid,
    title: "Telephone report",
  });
  const streamUrl = process.env.TWILIO_MEDIA_STREAM_URL ||
    publicWebSocketUrl(request, "/api/voice/twilio/media", process.env.TWILIO_WEBHOOK_BASE_URL);
  const statusUrl = publicHttpsUrl(request, "/api/voice/twilio/status", process.env.TWILIO_WEBHOOK_BASE_URL);
  if (!streamUrl || !statusUrl) return rejectTwiML("Voice stream is not configured.", 503);
  const twiml = buildTwilioStreamTwiML(streamUrl, {
    statusCallbackUrl: statusUrl,
    customParameters: {
      AccountSid: accountSid,
      CallSid: callSid,
      Caller: from,
      SessionToken: createTwilioStreamToken(callSid, from),
    },
  });
  return xml(twiml);
}
