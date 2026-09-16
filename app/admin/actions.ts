"use server";

import { revalidatePath } from "next/cache";

import { requireAdminWorkspace } from "@/lib/auth/workspace-session";

export type AdminActionState = {
  error?: string;
  success?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set(["pending", "active", "suspended"]);
const onboardingStates = new Set(["catalogued", "invited", "onboarded"]);

export async function rerouteTicket(
  _previousState: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ticketId = formData.get("ticketId");
  const institutionId = formData.get("institutionId");
  const serviceId = formData.get("serviceId");
  const note = formData.get("note");
  if (
    typeof ticketId !== "string" ||
    typeof institutionId !== "string" ||
    !uuidPattern.test(ticketId) ||
    !uuidPattern.test(institutionId) ||
    (typeof serviceId === "string" && serviceId.length > 0 && !uuidPattern.test(serviceId))
  ) {
    return { error: "Choose a valid ticket and destination institution." };
  }

  const { supabase } = await requireAdminWorkspace();
  const { data, error } = await supabase.rpc("reroute_ticket", {
    target_ticket_id: ticketId,
    target_institution_id: institutionId,
    target_service_id: typeof serviceId === "string" && serviceId ? serviceId : null,
    reroute_note: typeof note === "string" ? note.trim().slice(0, 1000) : null,
  });
  if (error) return { error: error.message };
  const result = Array.isArray(data) ? data[0] : data;

  revalidatePath("/admin");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/routing");
  revalidatePath(`/admin/reports/${ticketId}`);
  revalidatePath("/institution");
  revalidatePath("/institution/tickets");
  revalidatePath("/track");
  revalidatePath("/reports");
  return { success: `${result?.ticket_code || "Ticket"} rerouted and recorded in the audit trail.` };
}

export async function approveRoutingDecision(
  _previousState: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const decisionId = formData.get("decisionId");
  const note = formData.get("note");
  if (typeof decisionId !== "string" || !uuidPattern.test(decisionId)) {
    return { error: "That routing decision is not valid." };
  }

  const cleanNote = typeof note === "string" ? note.trim() : "";
  if (cleanNote.length > 1000) return { error: "Review notes must be 1,000 characters or fewer." };

  const { supabase } = await requireAdminWorkspace();
  const { error } = await supabase.rpc("approve_routing_decision", {
    target_decision_id: decisionId,
    review_note: cleanNote || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/routing");
  revalidatePath("/admin/reports");
  revalidatePath("/institution");
  revalidatePath("/institution/tickets");
  revalidatePath("/reports");
  revalidatePath("/track");
  return { success: "Routing reviewed and approved with an auditable decision record." };
}

export async function updateInstitutionState(
  _previousState: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const institutionId = formData.get("institutionId");
  const status = formData.get("status");
  const onboardingState = formData.get("onboardingState");
  const verified = formData.get("verified");
  if (
    typeof institutionId !== "string" ||
    !uuidPattern.test(institutionId) ||
    typeof status !== "string" ||
    !statuses.has(status) ||
    typeof onboardingState !== "string" ||
    !onboardingStates.has(onboardingState) ||
    !["true", "false"].includes(String(verified))
  ) {
    return { error: "That institution state is not valid." };
  }

  const { supabase } = await requireAdminWorkspace();
  const { error } = await supabase.rpc("update_institution_operational_state", {
    target_institution_id: institutionId,
    target_status: status,
    target_onboarding_state: onboardingState,
    target_verified: verified === "true",
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/institutions");
  revalidatePath("/institutions");
  revalidatePath("/explore");
  revalidatePath("/institution");
  return { success: "Institution state updated and recorded in the audit trail." };
}
