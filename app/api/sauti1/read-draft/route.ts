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
  let markAll = false;
  try {
    const body = await request.json() as { reportId?: unknown; all?: unknown };
    reportId = typeof body.reportId === "string" ? body.reportId : "";
    markAll = body.all === true;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!markAll && !uuidPattern.test(reportId)) {
    return NextResponse.json({ error: "A valid draft report is required." }, { status: 400 });
  }

  let update = supabase
    .from("reports")
    .update({ attention_read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("source", "text")
    .in("status", ["draft", "pending_confirmation"])
    .is("attention_read_at", null);

  if (!markAll) update = update.eq("id", reportId);
  const { data: reports, error } = await update.select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { read: (reports ?? []).length > 0, count: reports?.length ?? 0 },
    { headers: { "Cache-Control": "no-store" } }
  );
}
