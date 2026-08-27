import { NextResponse } from "next/server";

import {
  parseInfobipStatusPayload,
  validateInfobipBasicAuth,
} from "@/lib/channels/infobip";
import {
  claimProviderWebhookEvent,
  finishProviderWebhookEvent,
  updateOutboundDeliveryStatus,
} from "@/lib/sauti1/channel-conversation";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorize(request: Request) {
  const username = process.env.INFOBIP_WEBHOOK_USERNAME ?? "";
  const password = process.env.INFOBIP_WEBHOOK_PASSWORD ?? "";
  if (!username || !password) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[SMS] Infobip status auth is not configured; accepting development request.");
      return true;
    }
    return null;
  }
  return validateInfobipBasicAuth(request.headers.get("authorization"), username, password);
}

export async function POST(request: Request) {
  const authorized = authorize(request);
  if (authorized === null) return NextResponse.json({ error: "Webhook auth is not configured." }, { status: 503 });
  if (!authorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let reports;
  try {
    reports = parseInfobipStatusPayload(await request.text());
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Invalid status payload.",
    }, { status: 400 });
  }
  let processed = 0;
  let duplicates = 0;
  for (const report of reports) {
    const status = report.status.name || report.status.groupName || "unknown";
    const eventId = ["status", report.messageId, status, report.doneAt || report.sentAt || "unknown"].join(":");
    const claim = await claimProviderWebhookEvent({
      provider: "infobip", eventId, eventType: "sms.delivery", payload: report,
    });
    if (!claim.claimed) {
      duplicates += 1;
      continue;
    }
    try {
      const delivered = /delivered/i.test(`${report.status.groupName || ""} ${status}`);
      await updateOutboundDeliveryStatus({
        provider: "infobip",
        providerMessageId: report.messageId,
        status,
        delivered,
      });
      await finishProviderWebhookEvent(claim.databaseId, "processed");
      processed += 1;
    } catch (error) {
      await finishProviderWebhookEvent(claim.databaseId, "failed").catch(() => undefined);
      throw error;
    }
  }
  return NextResponse.json({ accepted: true, processed, duplicates });
}
