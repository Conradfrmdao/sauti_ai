export const ticketStatuses = [
  "submitted",
  "routed",
  "needs_review",
  "acknowledged",
  "assigned",
  "in_progress",
  "resolution_proposed",
  "resolved_confirmed",
  "reopened",
  "closed",
  "cancelled",
] as const;

export type TicketStatus = (typeof ticketStatuses)[number];

export const institutionTransitionTargets = [
  "acknowledged",
  "in_progress",
  "resolution_proposed",
] as const satisfies readonly TicketStatus[];

export type InstitutionTransitionTarget = (typeof institutionTransitionTargets)[number];

const institutionTransitions: Readonly<Record<InstitutionTransitionTarget, readonly TicketStatus[]>> = {
  acknowledged: ["submitted", "routed"],
  in_progress: ["acknowledged", "assigned", "reopened"],
  resolution_proposed: ["acknowledged", "assigned", "in_progress", "reopened"],
};

export function isTicketStatus(value: string): value is TicketStatus {
  return (ticketStatuses as readonly string[]).includes(value);
}

export function isInstitutionTransitionTarget(value: string): value is InstitutionTransitionTarget {
  return (institutionTransitionTargets as readonly string[]).includes(value);
}

export function canInstitutionTransition(from: string, to: string) {
  return isTicketStatus(from)
    && isInstitutionTransitionTarget(to)
    && institutionTransitions[to].includes(from);
}

export function isOpenTicketStatus(status: string) {
  return !["closed", "cancelled"].includes(status);
}

export function awaitsCitizenResolution(status: string) {
  return status === "resolution_proposed";
}

