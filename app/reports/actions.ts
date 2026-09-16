"use server";

import { revalidatePath } from "next/cache";

import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

export type ResolutionConfirmationState = {
  error?: string;
  success?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function confirmTicketResolution(
  _previousState: ResolutionConfirmationState,
  formData: FormData
): Promise<ResolutionConfirmationState> {
  const ticketId = formData.get("ticketId");
  const reportId = formData.get("reportId");
  const issueFixed = formData.get("issueFixed");
  const feedback = formData.get("feedback");

  if (typeof ticketId !== "string" || !uuidPattern.test(ticketId)) {
    return { error: "That ticket is not valid." };
  }
  if (typeof reportId !== "string" || !uuidPattern.test(reportId)) {
    return { error: "That report is not valid." };
  }
  if (issueFixed !== "true" && issueFixed !== "false") {
    return { error: "Choose whether the issue is fixed." };
  }

  const cleanFeedback = typeof feedback === "string" ? feedback.trim() : "";
  if (cleanFeedback.length > 1000) {
    return { error: "Feedback must be 1,000 characters or fewer." };
  }

  const { supabase } = await requireCitizenWorkspace();
  const { data, error } = await supabase.rpc("confirm_ticket_resolution", {
    target_ticket_id: ticketId,
    issue_fixed: issueFixed === "true",
    feedback: cleanFeedback || null,
  });

  if (error) return { error: error.message };
  const result = Array.isArray(data) ? data[0] : data;

  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  revalidatePath("/reports");
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/track");
  revalidatePath(`/track/${ticketId}`);
  revalidatePath("/institution");
  revalidatePath("/institution/tickets");
  revalidatePath("/admin");
  revalidatePath("/admin/reports");

  return issueFixed === "true"
    ? { success: `${result?.ticket_code || "Ticket"} is closed. Thank you for confirming the real outcome.` }
    : { success: `${result?.ticket_code || "Ticket"} is reopened. The institution can now continue working on it.` };
}
