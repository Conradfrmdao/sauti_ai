"use client";

import { CheckCircle2, CirclePlay, Loader2, ShieldCheck } from "lucide-react";
import { useActionState } from "react";

import {
  TicketActionState,
  updateTicketStatus,
} from "@/app/institution/ticket-actions";

type TicketStatusActionsProps = {
  status: string;
  ticketId: string;
};

const initialState: TicketActionState = {};

export function TicketStatusActions({ status, ticketId }: TicketStatusActionsProps) {
  const [state, formAction, pending] = useActionState(updateTicketStatus, initialState);
  const canAcknowledge = ["submitted", "routed"].includes(status);
  const canStart = ["acknowledged", "assigned", "reopened"].includes(status);
  const canProposeResolution = ["acknowledged", "assigned", "in_progress", "reopened"].includes(status);

  if (!canAcknowledge && !canStart && !canProposeResolution) return null;

  return (
    <form action={formAction} className="ticket-action-form">
      <input name="ticketId" type="hidden" value={ticketId} />
      <label>
        <span>Update for the citizen</span>
        <textarea
          disabled={pending}
          maxLength={1000}
          name="note"
          placeholder="Explain what changed. A clear resolution note is required before asking the citizen to confirm."
        />
      </label>

      {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
      {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}

      <div className="ticket-action-buttons">
        {canAcknowledge && (
          <button className="is-primary" disabled={pending} name="targetStatus" type="submit" value="acknowledged">
            {pending ? <Loader2 className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
            Acknowledge
          </button>
        )}
        {canStart && (
          <button disabled={pending} name="targetStatus" type="submit" value="in_progress">
            {pending ? <Loader2 className="animate-spin" size={14} /> : <CirclePlay size={14} />}
            Start work
          </button>
        )}
        {canProposeResolution && (
          <button className="is-success" disabled={pending} name="targetStatus" type="submit" value="resolution_proposed">
            {pending ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
            Propose resolution
          </button>
        )}
      </div>
    </form>
  );
}
