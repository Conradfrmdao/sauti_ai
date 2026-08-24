import { NextResponse } from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";

type CancelTextRequest = {
  conversationId?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: CancelTextRequest;
  try {
    body = await request.json() as CancelTextRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.conversationId || !uuidPattern.test(body.conversationId)) {
    return NextResponse.json({ error: "A valid text conversation is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to discard this draft." }, { status: 401 });
  if (!await isCitizenWorkspace(supabase, user.id)) {
    return NextResponse.json({ error: "Text Sauti1 is only available in a citizen workspace." }, { status: 403 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", body.conversationId)
    .eq("user_id", user.id)
    .eq("channel", "text")
    .maybeSingle();
  if (!conversation) return NextResponse.json({ cancelled: true, deletedReportCount: 0 });

  const { data: reports, error: reportsError } = await supabase
    .from("reports")
    .select("id, status")
    .eq("conversation_id", conversation.id)
    .eq("user_id", user.id);
  if (reportsError) return NextResponse.json({ error: reportsError.message }, { status: 500 });
  if ((reports ?? []).some((report) => !["draft", "pending_confirmation"].includes(report.status))) {
    return NextResponse.json({ error: "A submitted report cannot be discarded." }, { status: 409 });
  }

  const reportIds = (reports ?? []).map((report) => report.id);
  const attachmentPaths: string[] = [];
  if (reportIds.length) {
    const { data: attachments, error: attachmentsError } = await supabase
      .from("report_attachments")
      .select("storage_path")
      .eq("uploaded_by", user.id)
      .in("report_id", reportIds);
    if (attachmentsError) return NextResponse.json({ error: attachmentsError.message }, { status: 500 });

    attachmentPaths.push(...(attachments ?? []).map((attachment) => attachment.storage_path).filter(Boolean));
  }

  const { data, error } = await supabase.rpc("cancel_text_conversation", {
    target_conversation_id: conversation.id,
  });
  if (error) {
    console.error("Text draft cancellation failed.", error.message);
    return NextResponse.json(
      { error: "This draft could not be discarded right now. Try again shortly." },
      { status: 503 }
    );
  }

  if (attachmentPaths.length) {
    const { error: storageError } = await supabase.storage.from("report-attachments").remove(attachmentPaths);
    if (storageError) console.warn("Discarded text draft but could not remove its storage objects.", storageError.message);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    cancelled: Boolean(result?.cancelled),
    deletedReportCount: Number(result?.deleted_report_count ?? 0),
  });
}
