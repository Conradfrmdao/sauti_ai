"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type TicketActionState = {
  error?: string;
  success?: string;
};

const allowedStatuses = new Set(["acknowledged", "in_progress", "resolved", "closed"]);

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
    !allowedStatuses.has(targetStatus)
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
      .select("ticket_code, institutions(name, short_name)")
      .eq("id", ticketId)
      .maybeSingle(),
  ]);

  if (!ticket) return { error: "Ticket not found or unavailable to your institution." };

  const institution = relatedRecord(ticket.institutions);
  const staffName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Institution staff";
  const institutionName = institution?.short_name || institution?.name || "the institution";
  const customNote = typeof submittedNote === "string" ? submittedNote.trim().slice(0, 1000) : "";
  const actionLabel = targetStatus === "acknowledged"
    ? "acknowledged"
    : targetStatus === "in_progress"
      ? "started work on"
      : targetStatus === "resolved"
        ? "marked as solved"
        : "closed";
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
    success: targetStatus === "resolved"
      ? `${ticket.ticket_code} is now marked as solved.`
      : `${ticket.ticket_code} is now ${targetStatus.replaceAll("_", " ")}.`,
  };
}
