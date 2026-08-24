"use client";

import { CheckCircle2, CirclePlay, CircleX, Loader2, ShieldCheck } from "lucide-react";
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
  const canStart = ["acknowledged", "assigned"].includes(status);
  const canResolve = ["acknowledged", "assigned", "in_progress"].includes(status);
  const canClose = status === "resolved";

  if (!canAcknowledge && !canStart && !canResolve && !canClose) return null;

  return (
    <form action={formAction} className="space-y-3">
      <input name="ticketId" type="hidden" value={ticketId} />
      <label className="block">
        <span className="mb-1.5 block text-[10px] font-bold uppercase text-[#7b879a]">Update for the citizen</span>
        <textarea
          className="min-h-20 w-full resize-y rounded-[8px] border border-[#dce2eb] bg-white px-3 py-2.5 text-[12px] leading-5 outline-none focus:border-[#1d5eff]"
          disabled={pending}
          maxLength={1000}
          name="note"
          placeholder="Add a clear status note (optional)"
        />
      </label>

      {state.error && <p className="text-[11px] font-semibold text-[#b42318]" role="alert">{state.error}</p>}
      {state.success && <p className="text-[11px] font-semibold text-[#087a50]" role="status">{state.success}</p>}

      <div className="flex flex-wrap gap-2">
        {canAcknowledge && (
          <button className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#155dff] px-3 text-[11px] font-bold text-white disabled:opacity-60" disabled={pending} name="targetStatus" type="submit" value="acknowledged">
            {pending ? <Loader2 className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
            Acknowledge
          </button>
        )}
        {canStart && (
          <button className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#cfd8e7] bg-white px-3 text-[11px] font-bold text-[#30415e] disabled:opacity-60" disabled={pending} name="targetStatus" type="submit" value="in_progress">
            {pending ? <Loader2 className="animate-spin" size={14} /> : <CirclePlay size={14} />}
            Start work
          </button>
        )}
        {canResolve && (
          <button className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#087a50] px-3 text-[11px] font-bold text-white disabled:opacity-60" disabled={pending} name="targetStatus" type="submit" value="resolved">
            {pending ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
            Mark as solved
          </button>
        )}
        {canClose && (
          <button className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#17233c] px-3 text-[11px] font-bold text-white disabled:opacity-60" disabled={pending} name="targetStatus" type="submit" value="closed">
            {pending ? <Loader2 className="animate-spin" size={14} /> : <CircleX size={14} />}
            Close ticket
          </button>
        )}
      </div>
    </form>
  );
}
