"use client";

import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useActionState } from "react";

import {
  confirmTicketResolution,
  type ResolutionConfirmationState,
} from "@/app/reports/actions";

const initialState: ResolutionConfirmationState = {};

export function CitizenResolutionConfirmation({
  ticketId,
  reportId,
  institutionName,
  resolutionNote,
}: {
  ticketId: string;
  reportId: string;
  institutionName: string;
  resolutionNote?: string | null;
}) {
  const [state, formAction, pending] = useActionState(confirmTicketResolution, initialState);

  return (
    <section className="detail-section border-2 border-[#bdd8ca] bg-[#f3fbf7]">
      <h2>Is the issue actually fixed?</h2>
      <p className="mt-2 text-[12px] leading-5 text-[#405a4d]">
        {institutionName} proposed a resolution. Your answer controls whether this ticket closes or returns to active work.
      </p>
      {resolutionNote && (
        <blockquote className="mt-3 rounded-[8px] border border-[#d7e8df] bg-white p-3 text-[11px] leading-5 text-[#405249]">
          {resolutionNote}
        </blockquote>
      )}
      <form action={formAction} className="mt-4 space-y-3">
        <input name="ticketId" type="hidden" value={ticketId} />
        <input name="reportId" type="hidden" value={reportId} />
        <label className="block">
          <span className="text-[10px] font-bold text-[#50635a]">Optional feedback</span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-[8px] border border-[#cbdad2] bg-white p-3 text-[12px] outline-none focus:border-[#29845b]"
            disabled={pending}
            maxLength={1000}
            name="feedback"
            placeholder="Tell the institution what was fixed or what still needs attention."
          />
        </label>
        {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
        {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="detail-action" disabled={pending} name="issueFixed" type="submit" value="true">
            {pending ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
            Yes, it is fixed
          </button>
          <button className="detail-action secondary" disabled={pending} name="issueFixed" type="submit" value="false">
            {pending ? <Loader2 className="animate-spin" size={15} /> : <RotateCcw size={15} />}
            No, reopen it
          </button>
        </div>
      </form>
    </section>
  );
}
