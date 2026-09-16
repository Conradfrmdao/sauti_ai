"use client";

import { Loader2, Save } from "lucide-react";
import { useActionState } from "react";

import { updateInstitutionState, type AdminActionState } from "@/app/admin/actions";

const initialState: AdminActionState = {};

export function InstitutionStateForm({
  institution,
}: {
  institution: {
    id: string;
    status: string;
    onboarding_state: string;
    verified: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateInstitutionState, initialState);
  return (
    <form action={action} className="institution-state-form">
      <input name="institutionId" type="hidden" value={institution.id} />
      <label><span>Status</span><select defaultValue={institution.status} disabled={pending} name="status"><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
      <label><span>Onboarding</span><select defaultValue={institution.onboarding_state} disabled={pending} name="onboardingState"><option value="catalogued">Catalogued</option><option value="invited">Invited</option><option value="onboarded">Onboarded</option></select></label>
      <label className="verification-check"><input defaultChecked={institution.verified} disabled={pending} name="verified" type="checkbox" value="true" /><span>Verified</span></label>
      {!institution.verified && <input name="verified" type="hidden" value="false" />}
      <button disabled={pending} type="submit">{pending ? <Loader2 className="is-spinning" size={15} /> : <Save size={15} />} Save</button>
      {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
      {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}
    </form>
  );
}
