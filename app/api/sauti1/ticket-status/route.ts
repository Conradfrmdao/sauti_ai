import {
  NextResponse,
} from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import {
  createClient,
} from "@/lib/supabase/server";

export async function GET(
  request: Request
) {
  const {
    searchParams,
  } =
    new URL(request.url);

  const ticketId =
    searchParams.get("ticketId");

  if (!ticketId) {
    return NextResponse.json(
      {
        error: "ticketId is required.",
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
      { error: "Sign in to view this ticket." },
      { status: 401 }
    );
  }
  if (!await isCitizenWorkspace(supabase, user.id)) {
    return NextResponse.json({ error: "Citizen ticket tracking is not available in this workspace." }, { status: 403 });
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("tickets")
      .select(
        `
          id,
          ticket_code,
          status,
          acknowledged_at,
          institutions (
            name,
            short_name
          ),
          reports!inner (
            user_id,
            status,
            ai_summary
          ),
          ticket_events (
            event_type,
            note,
            created_at
          )
        `
      )
      .eq("id", ticketId)
      .eq("reports.user_id", user.id)
      .order("created_at", {
        referencedTable: "ticket_events",
        ascending: false,
      })
      .limit(1, {
        referencedTable: "ticket_events",
      })
      .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
      },
      {
        status: 500,
      }
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        error: "Ticket not found.",
      },
      {
        status: 404,
      }
    );
  }

  return NextResponse.json({
    ticket: data,
  });
}
