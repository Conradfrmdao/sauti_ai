"use client";

import { Loader2, Route } from "lucide-react";
import { useActionState } from "react";
import { useState } from "react";

import { rerouteTicket, type AdminActionState } from "@/app/admin/actions";

const initialState: AdminActionState = {};

export function AdminRerouteForm({
  ticketId,
  currentInstitutionId,
  institutions,
}: {
  ticketId: string;
  currentInstitutionId: string;
  institutions: Array<{
    id: string;
    name: string;
    short_name: string | null;
    institution_services?: Array<{ id: string; name: string; category_key: string }> | null;
  }>;
}) {
  const [state, action, pending] = useActionState(rerouteTicket, initialState);
  const [institutionId, setInstitutionId] = useState("");
  const options = institutions;
  const selectedInstitution = options.find((institution) => institution.id === institutionId);
  return (
    <form action={action} className="ticket-action-form">
      <input name="ticketId" type="hidden" value={ticketId} />
      <label><span>Destination institution</span><select disabled={pending} name="institutionId" onChange={(event) => setInstitutionId(event.target.value)} required value={institutionId}><option disabled value="">Choose institution</option>{options.map((institution) => <option key={institution.id} value={institution.id}>{institution.short_name || institution.name}{institution.id === currentInstitutionId ? " (current)" : ""}</option>)}</select></label>
      <label><span>Destination service (optional)</span><select defaultValue="" disabled={pending || !selectedInstitution} name="serviceId"><option value="">Keep the current category</option>{(selectedInstitution?.institution_services ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <label><span>Internal correction reason</span><textarea disabled={pending} maxLength={1000} name="note" placeholder="Explain the routing correction for the audit record." /></label>
      <div className="ticket-action-buttons"><button className="is-primary" disabled={pending || options.length === 0} type="submit">{pending ? <Loader2 className="is-spinning" size={15} /> : <Route size={15} />} Reroute ticket</button></div>
      {state.error && <p className="ticket-action-message is-error" role="alert">{state.error}</p>}
      {state.success && <p className="ticket-action-message is-success" role="status">{state.success}</p>}
    </form>
  );
}
