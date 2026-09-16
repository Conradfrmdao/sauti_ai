import {
  NextResponse,
} from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import {
  createClient,
} from "@/lib/supabase/server";
import { getMissingReportFields } from "@/lib/sauti1/report-ai";

type ConfirmRequest = {
  reportId?: string;
};

export async function POST(
  request: Request
) {
  const {
    reportId,
  } =
    (await request.json()) as ConfirmRequest;

  if (!reportId) {
    return NextResponse.json(
      {
        error: "Report id is required.",
      },
      {
        status: 400,
      }
    );
  }

  const supabase =
    await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in to submit a report." },
      { status: 401 }
    );
  }
  if (!await isCitizenWorkspace(supabase, user.id)) {
    return NextResponse.json({ error: "Report submission is only available in a citizen workspace." }, { status: 403 });
  }

  const { data: ownedReport } = await supabase
    .from("reports")
    .select(`
      id, conversation_id, description, detected_category, location_text, intake_data,
      institutions(institution_services(name, category_key, description, routing_keywords, required_fields))
    `)
    .eq("id", reportId)
    .eq("user_id", user.id)
    .in("status", ["draft", "pending_confirmation"])
    .maybeSingle();

  if (!ownedReport) {
    return NextResponse.json(
      { error: "Report not found, already submitted, or not owned by this account." },
      { status: 404 }
    );
  }

  const institution = Array.isArray(ownedReport.institutions)
    ? ownedReport.institutions[0]
    : ownedReport.institutions;
  const service = institution?.institution_services?.find(
    (item) => item.category_key === ownedReport.detected_category
  );
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  const missingFields = getMissingReportFields(
    service,
    (ownedReport.intake_data ?? {}) as Record<string, string>,
    ownedReport.location_text,
    ownedReport.description,
    { fullName: profile?.full_name, phone: profile?.phone }
  );
  if (!institution || missingFields.length > 0) {
    return NextResponse.json(
      {
        error: "Complete the report details before submitting.",
        missingFields,
      },
      { status: 409 }
    );
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "submit_report_to_institution",
      {
        target_report_id:
          reportId,
      }
    );

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
      },
      {
        status: 409,
      }
    );
  }

  const ticket =
    Array.isArray(data)
      ? data[0]
      : data;

  if (!ticket) {
    return NextResponse.json(
      { error: "No ticket was created." },
      { status: 500 }
    );
  }

  if (ownedReport.conversation_id) {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({ status: "closed", ended_at: new Date().toISOString() })
      .eq("id", ownedReport.conversation_id)
      .eq("user_id", user.id);

    if (conversationError) {
      console.error("Ticket was submitted but the conversation could not be closed", conversationError);
    }
  }

  return NextResponse.json({
    ticket,
  });
}
