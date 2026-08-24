import { NextResponse } from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to open this draft." }, { status: 401 });
  if (!await isCitizenWorkspace(supabase, user.id)) {
    return NextResponse.json({ error: "Drafts are only available in a citizen workspace." }, { status: 403 });
  }

  let reportId = "";
  try {
    const body = await request.json() as { reportId?: unknown };
    reportId = typeof body.reportId === "string" ? body.reportId : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!uuidPattern.test(reportId)) {
    return NextResponse.json({ error: "A valid draft report is required." }, { status: 400 });
  }

  const { data: report, error } = await supabase
    .from("reports")
    .update({ attention_read_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("user_id", user.id)
    .eq("source", "text")
    .in("status", ["draft", "pending_confirmation"])
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ read: Boolean(report) }, { headers: { "Cache-Control": "no-store" } });
}
