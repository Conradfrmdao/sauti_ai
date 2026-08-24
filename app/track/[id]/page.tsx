import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";
import { intakeFieldLabel } from "@/lib/sauti1/intake-fields";
import { visibleIntakeData } from "@/lib/sauti1/report-ai";

const stages = ["routed", "acknowledged", "in_progress", "resolved"];

function label(value: string | null | undefined) {
  return (value || "Not available").replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireCitizenWorkspace();
  const { data: ticket } = await supabase
    .from("tickets")
    .select(`
      id, report_id, ticket_code, status, priority, category, created_at, updated_at, acknowledged_at, resolved_at,
      institutions (name, short_name, sector, contact_phone, contact_email, website_url),
      reports!inner (id, user_id, description, ai_summary, detected_category, location_text, intake_data, source, ai_confidence, confirmed_at),
      ticket_events (id, event_type, from_status, to_status, note, created_at)
    `)
    .eq("id", id)
    .eq("reports.user_id", user.id)
    .order("created_at", { referencedTable: "ticket_events", ascending: true })
    .maybeSingle();

  if (!ticket) notFound();
  const institution = Array.isArray(ticket.institutions) ? ticket.institutions[0] : ticket.institutions;
  const report = Array.isArray(ticket.reports) ? ticket.reports[0] : ticket.reports;
  const intakeData = visibleIntakeData(report?.intake_data);
  const currentIndex = stages.indexOf(ticket.status);

  return (
    <AppShell>
      <div className="simple-page detail-page">
        <Link className="back-link" href="/track"><ArrowLeft size={16} /> Track a ticket</Link>
        <header className="detail-header"><div><span className="detail-eyebrow">{ticket.ticket_code}</span><h1>{label(ticket.category || report?.detected_category)}</h1><p>{institution?.short_name || institution?.name}</p></div><span className="activity-status">{label(ticket.status)}</span></header>

        <section className="detail-section ticket-progress-section"><h2>Progress</h2><div className="tracking-stages detail-stages">{stages.map((stage, index) => {
          const complete = currentIndex >= index || ticket.status === "closed";
          return <div className={complete ? "complete" : ""} key={stage}>{complete ? <CheckCircle2 size={18} /> : <Circle size={18} />}<span>{label(stage)}</span></div>;
        })}</div></section>

        <div className="detail-grid">
          <div className="detail-main">
            <section className="detail-section"><h2>Citizen report</h2><p className="detail-description">{report?.description}</p><div className="detail-kv-grid"><div><span>AI summary</span><strong>{report?.ai_summary || report?.description}</strong></div><div><span>Location</span><strong>{report?.location_text || "Not provided"}</strong></div><div><span>Priority</span><strong>{label(ticket.priority)}</strong></div><div><span>Source</span><strong>{label(report?.source)}</strong></div>{Object.entries(intakeData).filter(([key]) => !["location", "incident_description", "document_issue", "location_verification", "location_source_url"].includes(key)).map(([key, value]) => <div key={key}><span>{intakeFieldLabel(key)}</span><strong>{String(value)}</strong></div>)}</div><Link className="detail-action secondary" href={`/reports/${ticket.report_id}`}>Open complete report</Link></section>

            <section className="detail-section"><h2>Institution timeline</h2><div className="event-timeline large">{(ticket.ticket_events ?? []).map((event) => <div key={event.id}><CheckCircle2 size={16} /><div><strong>{label(event.event_type)}</strong><p>{event.note || `${label(event.from_status)} to ${label(event.to_status)}`}</p><span>{dateTime(event.created_at)}</span></div></div>)}</div></section>
          </div>

          <aside className="detail-side"><section className="detail-section"><h2>Assigned institution</h2><strong className="ticket-code">{institution?.short_name || institution?.name}</strong><p>{institution?.sector}</p><div className="detail-kv-list"><div><span>Phone</span><strong>{institution?.contact_phone || "Not available"}</strong></div><div><span>Email</span><strong>{institution?.contact_email || "Not available"}</strong></div></div>{institution?.website_url && <a className="detail-action" href={institution.website_url} rel="noreferrer" target="_blank">Official website</a>}</section><section className="detail-section"><h2>Ticket dates</h2><div className="detail-kv-list"><div><span>Created</span><strong>{dateTime(ticket.created_at)}</strong></div><div><span>Acknowledged</span><strong>{dateTime(ticket.acknowledged_at)}</strong></div><div><span>Resolved</span><strong>{dateTime(ticket.resolved_at)}</strong></div><div><span>Updated</span><strong>{dateTime(ticket.updated_at)}</strong></div></div></section></aside>
        </div>
      </div>
    </AppShell>
  );
}
