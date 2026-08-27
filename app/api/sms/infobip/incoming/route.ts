import { NextResponse } from "next/server";

import {
  parseInfobipInboundPayload,
  sendInfobipSms,
  validateInfobipBasicAuth,
} from "@/lib/channels/infobip";
import { publicHttpsUrl } from "@/lib/channels/public-url";
import {
  markProviderWebhookForRetry,
  processChannelTurn,
  recordOutboundMessage,
} from "@/lib/sauti1/channel-conversation";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(request: Request) {
  const username = process.env.INFOBIP_WEBHOOK_USERNAME ?? "";
  const password = process.env.INFOBIP_WEBHOOK_PASSWORD ?? "";
  if (!username || !password) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[SMS] Infobip webhook auth is not configured; accepting development request.");
      return true;
    }
    return null;
  }
  return validateInfobipBasicAuth(request.headers.get("authorization"), username, password);
}

export async function POST(request: Request) {
  const authorized = authorize(request);
  if (authorized === null) {
    return NextResponse.json({ error: "Infobip webhook authentication is not configured." }, { status: 503 });
  }
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let messages;
  try {
    messages = parseInfobipInboundPayload(await request.text());
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Invalid Infobip payload.",
    }, { status: 400 });
  }

  const deliveryReportUrl = publicHttpsUrl(request, "/api/sms/infobip/status");
  let processed = 0;
  let duplicates = 0;
  for (const sms of messages) {
    const eventId = `inbound:${sms.messageId}`;
    const result = await processChannelTurn({
      phoneE164: sms.from,
      channel: "sms",
      provider: "infobip",
      message: sms.cleanText || sms.text,
      providerMessageId: sms.messageId,
      eventId,
      eventType: "sms.inbound",
      rawEvent: sms,
    });
    if (result.duplicate) {
      duplicates += 1;
      continue;
    }
    if (!result.assistantReply || !result.aiMessageId) {
      throw new Error("SMS turn did not produce a persisted reply.");
    }
    let sent: Awaited<ReturnType<typeof sendInfobipSms>>;
    try {
      sent = await sendInfobipSms({
        to: sms.from,
        text: result.assistantReply,
        deliveryReportUrl,
        callbackData: result.conversationId,
        messageId: result.aiMessageId,
      });
    } catch (error) {
      await markProviderWebhookForRetry("infobip", eventId).catch(() => undefined);
      throw error;
    }
    const status = sent.sent
      ? sent.status?.name || sent.status?.groupName || "submitted"
      : "development_not_sent";
    await recordOutboundMessage({
      localMessageId: result.aiMessageId,
      provider: "infobip",
      providerMessageId: sent.sent ? sent.messageId || result.aiMessageId : null,
      status,
    });
    processed += 1;
  }
  return NextResponse.json({ accepted: true, processed, duplicates });
}
