"use client";

import { Loader2, UserRoundCheck } from "lucide-react";
import { useActionState } from "react";

import { assignTicket, type TicketActionState } from "@/app/institution/ticket-actions";

export type AssignmentMember = {
  user_id: string;
  full_name: string | null;
  member_role: string;
  department: string | null;
  active?: boolean;
};

const initialState: TicketActionState = {};

export function TicketAssignment({
  ticketId,
  currentAssignee,
  members,
}: {
  ticketId: string;
  currentAssignee: string | null;
  members: AssignmentMember[];
}) {
  const [state, formAction, pending] = useActionState(assignTicket, initialState);
  return (
    <form action={formAction} className="ticket-assignment-form">
      <input name="ticketId" type="hidden" value={ticketId} />
      <label>
        <span>Assigned team member</span>
        <select defaultValue={currentAssignee || ""} disabled={pending} name="assigneeId" required>
          <option disabled value="">Choose a team member</option>
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.full_name || "Team member"} · {member.department || member.member_role.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <button disabled={pending || members.length === 0} type="submit">
        {pending ? <Loader2 className="is-spinning" size={15} /> : <UserRoundCheck size={15} />}
        Assign ticket
      </button>
      {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
      {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}
    </form>
  );
}
