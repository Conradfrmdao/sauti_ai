"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { approveRoutingDecision, type AdminActionState } from "@/app/admin/actions";

const initialState: AdminActionState = {};

export function AdminRoutingApproval({ decisionId }: { decisionId: string }) {
  const [state, formAction, pending] = useActionState(approveRoutingDecision, initialState);
  return (
    <form action={formAction} className="ticket-action-form">
      <input name="decisionId" type="hidden" value={decisionId} />
      <label><span>Review note (optional)</span><textarea disabled={pending} maxLength={1000} name="note" /></label>
      <button className="is-primary" disabled={pending} type="submit">
        {pending ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
        Approve current route
      </button>
      {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
      {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}
    </form>
  );
}

