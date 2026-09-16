"use client";

import { Loader2, MessageSquarePlus, Route } from "lucide-react";
import { useActionState } from "react";

import {
  addTicketComment,
  requestTicketTransfer,
  type TicketActionState,
} from "@/app/institution/ticket-actions";

const initialState: TicketActionState = {};

export function TicketCommentComposer({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState(addTicketComment, initialState);
  return (
    <form action={formAction} className="ticket-action-form">
      <input name="ticketId" type="hidden" value={ticketId} />
      <label>
        <span>Who can see this?</span>
        <select defaultValue="internal" disabled={pending} name="visibility">
          <option value="internal">Institution team only</option>
          <option value="citizen">Citizen-visible update</option>
        </select>
      </label>
      <label>
        <span>Note or update</span>
        <textarea disabled={pending} maxLength={2000} minLength={2} name="body" required />
      </label>
      <button disabled={pending} type="submit">
        {pending ? <Loader2 className="animate-spin" size={14} /> : <MessageSquarePlus size={14} />}
        Add note
      </button>
      {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
      {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}
    </form>
  );
}

export type TransferInstitution = {
  id: string;
  name: string;
  short_name: string | null;
};

export function TicketTransferRequest({
  ticketId,
  institutions,
}: {
  ticketId: string;
  institutions: TransferInstitution[];
}) {
  const [state, formAction, pending] = useActionState(requestTicketTransfer, initialState);
  return (
    <form action={formAction} className="ticket-action-form">
      <input name="ticketId" type="hidden" value={ticketId} />
      <label>
        <span>Suggested institution (optional)</span>
        <select defaultValue="" disabled={pending} name="suggestedInstitutionId">
          <option value="">Let SAUTI1 operations decide</option>
          {institutions.map((institution) => (
            <option key={institution.id} value={institution.id}>
              {institution.short_name || institution.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Why is this outside your mandate?</span>
        <textarea disabled={pending} maxLength={1000} minLength={12} name="reason" required />
      </label>
      <button disabled={pending} type="submit">
        {pending ? <Loader2 className="animate-spin" size={14} /> : <Route size={14} />}
        Request routing review
      </button>
      {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
      {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}
    </form>
  );
}
