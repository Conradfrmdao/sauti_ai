import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { drainAttachmentCleanupQueue } from "@/lib/sauti1/storage-cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET ?? "";
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configuredSecret || !suppliedSecret) return false;
  const configured = Buffer.from(configuredSecret);
  const supplied = Buffer.from(suppliedSecret);
  return configured.length === supplied.length && timingSafeEqual(configured, supplied);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Cleanup authorization is not configured." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await drainAttachmentCleanupQueue();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Attachment cleanup queue failed.", error);
    return NextResponse.json({ error: "Attachment cleanup could not be completed." }, { status: 503 });
  }
}
