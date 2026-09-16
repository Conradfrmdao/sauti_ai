"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isInstitutionTransitionTarget } from "@/lib/sauti1/ticket-lifecycle";

export type TicketActionState = {
  error?: string;
  success?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function updateTicketStatus(
  _previousState: TicketActionState,
  formData: FormData
): Promise<TicketActionState> {
  const ticketId = formData.get("ticketId");
  const targetStatus = formData.get("targetStatus");
  const submittedNote = formData.get("note");

  if (
    typeof ticketId !== "string" ||
    typeof targetStatus !== "string" ||
    !ticketId ||
    !isInstitutionTransitionTarget(targetStatus)
  ) {
    return { error: "That ticket action is not valid." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const [{ data: profile }, { data: ticket }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("tickets")
      .select("ticket_code, institutions!tickets_institution_id_fkey(name, short_name)")
      .eq("id", ticketId)
      .maybeSingle(),
  ]);

  if (!ticket) return { error: "Ticket not found or unavailable to your institution." };

  const institution = relatedRecord(ticket.institutions);
  const staffName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Institution staff";
  const institutionName = institution?.short_name || institution?.name || "the institution";
  const customNote = typeof submittedNote === "string" ? submittedNote.trim().slice(0, 1000) : "";
  if (targetStatus === "resolution_proposed" && customNote.length < 12) {
    return { error: "Add a clear resolution note (at least 12 characters) before proposing resolution." };
  }
  const actionLabel = targetStatus === "acknowledged"
    ? "acknowledged"
    : targetStatus === "in_progress"
      ? "started work on"
      : "proposed a resolution for";
  const note = customNote || `${staffName} ${actionLabel} this ticket for ${institutionName}.`;

  const { error } = await supabase.rpc("update_ticket_status", {
    target_ticket_id: ticketId,
    target_status: targetStatus,
    status_note: note,
  });

  if (error) return { error: error.message };

  revalidatePath("/institution");
  revalidatePath("/institution/tickets");
  revalidatePath(`/institution/tickets/${ticketId}`);
  revalidatePath("/reports");
  revalidatePath("/track");
  revalidatePath("/chat");
  revalidatePath("/voice");

  return {
    success: targetStatus === "resolution_proposed"
      ? `${ticket.ticket_code} now awaits the citizen's confirmation.`
      : `${ticket.ticket_code} is now ${targetStatus.replaceAll("_", " ")}.`,
  };
}

export async function assignTicket(
  _previousState: TicketActionState,
  formData: FormData
): Promise<TicketActionState> {
  const ticketId = formData.get("ticketId");
  const assigneeId = formData.get("assigneeId");
  if (
    typeof ticketId !== "string" ||
    typeof assigneeId !== "string" ||
    !uuidPattern.test(ticketId) ||
    !uuidPattern.test(assigneeId)
  ) {
    return { error: "Choose a valid institution team member." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const { data, error } = await supabase.rpc("assign_ticket", {
    target_ticket_id: ticketId,
    target_assignee_id: assigneeId,
  });
  if (error) return { error: error.message };

  revalidatePath("/institution");
  revalidatePath("/institution/tickets");
  revalidatePath(`/institution/tickets/${ticketId}`);
  revalidatePath("/track");
  revalidatePath("/reports");
  const result = Array.isArray(data) ? data[0] : data;
  return { success: `${result?.ticket_code || "Ticket"} assigned successfully.` };
}

export async function addTicketComment(
  _previousState: TicketActionState,
  formData: FormData
): Promise<TicketActionState> {
  const ticketId = formData.get("ticketId");
  const visibility = formData.get("visibility");
  const body = formData.get("body");
  if (
    typeof ticketId !== "string" ||
    !uuidPattern.test(ticketId) ||
    (visibility !== "internal" && visibility !== "citizen") ||
    typeof body !== "string" ||
    body.trim().length < 2 ||
    body.trim().length > 2000
  ) {
    return { error: "Add a valid note between 2 and 2,000 characters." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const { error } = await supabase.rpc("add_ticket_comment", {
    target_ticket_id: ticketId,
    target_visibility: visibility,
    comment_body: body.trim(),
  });
  if (error) return { error: error.message };

  revalidatePath("/institution");
  revalidatePath("/institution/tickets");
  revalidatePath(`/institution/tickets/${ticketId}`);
  revalidatePath("/notifications");
  revalidatePath("/reports");
  revalidatePath("/track");
  revalidatePath("/admin/reports");
  return {
    success: visibility === "internal"
      ? "Private team note added. Citizens cannot see it."
      : "Citizen-visible update published and added to the audit timeline.",
  };
}

export async function requestTicketTransfer(
  _previousState: TicketActionState,
  formData: FormData
): Promise<TicketActionState> {
  const ticketId = formData.get("ticketId");
  const reason = formData.get("reason");
  const suggestedInstitutionId = formData.get("suggestedInstitutionId");
  if (
    typeof ticketId !== "string" ||
    !uuidPattern.test(ticketId) ||
    typeof reason !== "string" ||
    reason.trim().length < 12 ||
    reason.trim().length > 1000 ||
    (
      typeof suggestedInstitutionId === "string" &&
      suggestedInstitutionId.length > 0 &&
      !uuidPattern.test(suggestedInstitutionId)
    )
  ) {
    return { error: "Explain the mandate issue in 12 to 1,000 characters." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const { data, error } = await supabase.rpc("request_ticket_transfer", {
    target_ticket_id: ticketId,
    transfer_reason: reason.trim(),
    target_suggested_institution_id: typeof suggestedInstitutionId === "string" && suggestedInstitutionId
      ? suggestedInstitutionId
      : null,
  });
  if (error) return { error: error.message };
  const result = Array.isArray(data) ? data[0] : data;

  revalidatePath("/institution");
  revalidatePath("/institution/tickets");
  revalidatePath(`/institution/tickets/${ticketId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/reports");
  revalidatePath("/reports");
  revalidatePath("/track");
  return { success: `${result?.ticket_code || "Ticket"} is now in SAUTI1 routing review.` };
}
