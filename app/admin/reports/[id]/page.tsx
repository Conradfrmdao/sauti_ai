import { ArrowLeft, Clock3, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminRerouteForm } from "@/components/admin-reroute-form";
import { PriorityMarker, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { TicketLifecycle } from "@/components/ticket-lifecycle";
import { requireAdminWorkspace } from "@/lib/auth/workspace-session";
import { intakeFieldLabel } from "@/lib/sauti1/intake-fields";
import { visibleIntakeData } from "@/lib/sauti1/report-ai";

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function AdminReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdminWorkspace();
  const [
    { data: ticket, error: ticketError },
    { data: institutions, error: institutionsError },
    { data: routingDecision, error: routingError },
  ] = await Promise.all([
    supabase.from("tickets").select(`
      id, report_id, institution_id, ticket_code, status, priority, category,
      assigned_to, created_at, updated_at, acknowledged_at, resolved_at,
      transfer_reason, transfer_requested_at, suggested_institution_id,
      institutions(name, short_name),
      reports(id, description, ai_summary, detected_category, source, location_text, intake_data, confirmed_at),
      ticket_events(id, event_type, from_status, to_status, note, created_at)
    `).eq("id", id).order("created_at", { referencedTable: "ticket_events", ascending: false }).maybeSingle(),
    supabase.from("institutions").select("id, name, short_name, institution_services(id, name, category_key)").eq("status", "active").eq("verified", true).eq("institution_services.active", true).order("name"),
    supabase.from("routing_decisions").select("id, engine, model_name, prompt_version, rules_version, confidence, decision_source, final_decision_source, corrected, correction_reason, review_required, review_reasons, reviewed_at, latency_ms, routing_evidence, created_at").eq("ticket_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (ticketError || institutionsError || routingError) throw new Error("The platform case record could not be loaded.");
  if (!ticket) notFound();
  const institution = relatedRecord(ticket.institutions);
  const report = relatedRecord(ticket.reports);
  if (!report) notFound();
  const intakeData = visibleIntakeData(report.intake_data);

  return (
    <main className="operations-page">
      <header className="operations-page-header"><div><Link className="back-link" href="/admin/reports"><ArrowLeft size={15} /> Reports & tickets</Link><p className="eyebrow">{ticket.ticket_code}</p><h1>{titleCase(ticket.category || report.detected_category, "Citizen service issue")}</h1><p>{institution?.short_name || institution?.name || "No institution assigned"}</p></div><div className="detail-header-status"><StatusBadge status={ticket.status} /><SourceBadge source={report.source} /></div></header>

      <section className="operations-panel lifecycle-panel"><header><div><h2>Case lifecycle</h2><p>Created {dateLabel(ticket.created_at)} · Updated {dateLabel(ticket.updated_at)}</p></div><PriorityMarker priority={ticket.priority} /></header><div><TicketLifecycle status={ticket.status} /></div></section>

      <div className="operations-grid">
        <div className="admin-case-record">
          <section className="operations-panel record-section"><header><div><h2>Citizen report</h2><p>Original submitted account of the issue.</p></div></header><div><p className="record-description">{report.description}</p>{report.ai_summary && <div className="record-summary"><span>SAUTI1 summary</span><p>{report.ai_summary}</p></div>}<dl className="record-facts"><div><dt>Location</dt><dd><MapPin size={13} /> {report.location_text || "Not provided"}</dd></div><div><dt>Confirmed</dt><dd>{dateLabel(report.confirmed_at)}</dd></div>{Object.entries(intakeData).filter(([key]) => !["incident_description", "document_issue", "location_verification", "location_source_url"].includes(key)).map(([key, value]) => <div key={key}><dt>{intakeFieldLabel(key)}</dt><dd>{String(value)}</dd></div>)}</dl></div></section>

          <section className="operations-panel record-section"><header><div><h2>Audit history</h2><p>Complete authorized ticket events in reverse chronological order.</p></div></header><ol className="admin-event-list">{(ticket.ticket_events ?? []).map((event) => <li key={event.id}><span><Clock3 size={14} /></span><div><strong>{titleCase(event.event_type)}</strong><p>{event.note || `${titleCase(event.from_status)} to ${titleCase(event.to_status)}`}</p><time>{dateLabel(event.created_at)}</time></div></li>)}</ol></section>
        </div>

        <aside className="operations-aside">
          <section className="operations-panel record-section"><header><div><h2>Routing evidence</h2><p>Model confidence is not measured accuracy.</p></div></header><div><dl className="record-facts"><div><dt>Decision source</dt><dd>{titleCase(routingDecision?.decision_source)}</dd></div><div><dt>Confidence</dt><dd>{routingDecision?.confidence == null ? "Not scored" : `${Math.round(Number(routingDecision.confidence) * 100)}%`}</dd></div><div><dt>Engine</dt><dd>{routingDecision?.engine || "Pre-audit route"}</dd></div><div><dt>Review reasons</dt><dd>{routingDecision?.review_reasons?.length ? routingDecision.review_reasons.map((reason: string) => titleCase(reason)).join(", ") : "None"}</dd></div><div><dt>Corrected</dt><dd>{routingDecision?.corrected ? "Yes" : "No"}</dd></div></dl>{ticket.transfer_reason && <div className="record-summary"><span>Institution transfer reason</span><p>{ticket.transfer_reason}</p></div>}</div></section>
          <section className="operations-panel reroute-panel"><header><div><h2>Routing correction</h2><p>Available only while a ticket is open.</p></div></header><div>{["closed", "cancelled"].includes(ticket.status) ? <p className="panel-message">Closed and cancelled tickets cannot be rerouted.</p> : <AdminRerouteForm currentInstitutionId={ticket.institution_id} institutions={institutions ?? []} ticketId={ticket.id} />}</div></section>
          <section className="operations-note"><strong>Audited operation</strong><p>Rerouting changes both the ticket and report, clears assignment, creates a citizen-visible event, and records a platform audit entry.</p></section>
        </aside>
      </div>
    </main>
  );
}
