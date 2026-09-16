import { NextResponse } from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to start a report." }, { status: 401 });
  if (!await isCitizenWorkspace(supabase, user.id)) {
    return NextResponse.json({ error: "Text reporting is only available in a citizen workspace." }, { status: 403 });
  }

  let reportId: string | undefined;
  let conversationId: string | undefined;
  try {
    const body = await request.json() as { reportId?: unknown; conversationId?: unknown };
    reportId = typeof body.reportId === "string" ? body.reportId : undefined;
    conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if ((reportId && !uuidPattern.test(reportId)) || (conversationId && !uuidPattern.test(conversationId))) {
    return NextResponse.json({ error: "Invalid report or conversation reference." }, { status: 400 });
  }
  if (Boolean(reportId) !== Boolean(conversationId)) {
    return NextResponse.json({ error: "A report and conversation must be resumed together." }, { status: 400 });
  }

  if (reportId && conversationId) {
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .select("id")
      .eq("id", reportId)
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .eq("source", "text")
      .in("status", ["draft", "pending_confirmation"])
      .maybeSingle();
    if (reportError) return NextResponse.json({ error: "The draft could not be prepared." }, { status: 500 });
    if (!report) return NextResponse.json({ error: "This draft is no longer available." }, { status: 404 });

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .update({ status: "active", ended_at: null })
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .eq("channel", "text")
      .select("id")
      .maybeSingle();
    if (conversationError) return NextResponse.json({ error: "The conversation could not be resumed." }, { status: 500 });
    if (!conversation) return NextResponse.json({ error: "The conversation was not found." }, { status: 404 });
  }

  let closeOtherConversations = supabase
    .from("conversations")
    .update({ status: "closed", ended_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("channel", "text")
    .eq("status", "active");
  if (conversationId) closeOtherConversations = closeOtherConversations.neq("id", conversationId);

  const { error: closeError } = await closeOtherConversations;
  if (closeError) return NextResponse.json({ error: "The text workspace could not be prepared." }, { status: 500 });

  if (reportId) {
    await supabase
      .from("reports")
      .update({ attention_read_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("user_id", user.id)
      .is("attention_read_at", null);
  }

  return NextResponse.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
}
