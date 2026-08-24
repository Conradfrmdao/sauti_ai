import { ArrowLeft, CheckCircle2, FileText, Image, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";
import { intakeFieldLabel } from "@/lib/sauti1/intake-fields";
import { visibleIntakeData } from "@/lib/sauti1/report-ai";

function label(value: string | null | undefined) {
  return (value || "Not available").replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireCitizenWorkspace();
  const { data: report } = await supabase
    .from("reports")
    .select(`
      id, conversation_id, description, ai_summary, detected_category, priority,
      status, source, ai_confidence, location_text, intake_data, confirmed_at, created_at, updated_at,
      institutions (name, short_name, sector, contact_phone, contact_email, website_url),
      report_attachments (id, storage_path, original_name, mime_type, size_bytes, created_at),
      tickets (
        id, ticket_code, status, priority, acknowledged_at, resolved_at, created_at, updated_at,
        ticket_events (id, event_type, from_status, to_status, note, created_at)
      )
    `)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!report) notFound();

  const institution = Array.isArray(report.institutions) ? report.institutions[0] : report.institutions;
  const ticket = Array.isArray(report.tickets) ? report.tickets[0] : report.tickets;
  const events = ticket?.ticket_events ?? [];
  const attachmentRows = report.report_attachments ?? [];
  const intakeData = visibleIntakeData(report.intake_data);
  const attachments = await Promise.all(attachmentRows.map(async (attachment) => {
    const { data } = await supabase.storage
      .from("report-attachments")
      .createSignedUrl(attachment.storage_path, 3600);
    return { ...attachment, url: data?.signedUrl };
  }));
  const { data: transcript } = report.conversation_id
    ? await supabase.from("messages").select("id, sender_type, body, created_at").eq("conversation_id", report.conversation_id).order("created_at")
    : { data: [] };

  return (
    <AppShell>
      <div className="simple-page detail-page">
        <Link className="back-link" href="/reports"><ArrowLeft size={16} /> My reports</Link>
        <header className="detail-header">
          <div><span className="detail-eyebrow">Report</span><h1>{label(report.detected_category || "Citizen service issue")}</h1><p>{report.ai_summary || report.description}</p></div>
          <span className="activity-status">{label(ticket?.status || report.status)}</span>
        </header>

        <div className="detail-grid">
          <div className="detail-main">
            <section className="detail-section"><h2>Report information</h2><p className="detail-description">{report.description}</p><div className="detail-kv-grid">
              <div><span>Institution</span><strong>{institution?.short_name || institution?.name || "Not yet identified"}</strong></div>
              <div><span>Category</span><strong>{label(report.detected_category)}</strong></div>
              <div><span>Priority</span><strong>{label(report.priority)}</strong></div>
              <div><span>Source</span><strong>{label(report.source)}</strong></div>
              <div><span>Location</span><strong>{report.location_text || "Not provided"}</strong></div>
              <div><span>AI confidence</span><strong>{report.ai_confidence === null ? "Not available" : `${Math.round(Number(report.ai_confidence) * 100)}%`}</strong></div>
            </div></section>

            {Object.keys(intakeData).length > 0 && <section className="detail-section"><h2>Case details</h2><div className="detail-kv-grid">{Object.entries(intakeData).filter(([key]) => !["incident_description", "document_issue", "location_verification", "location_source_url"].includes(key)).map(([key, value]) => <div key={key}><span>{intakeFieldLabel(key)}</span><strong>{String(value)}</strong></div>)}</div></section>}

            {attachments.length > 0 && (
              <section className="detail-section">
                <div className="detail-section-head"><h2>Evidence</h2><span>{attachments.length} file{attachments.length === 1 ? "" : "s"}</span></div>
                <div className="evidence-list">
                  {attachments.map((attachment) => (
                    attachment.url ? (
                      <a href={attachment.url} key={attachment.id} rel="noreferrer" target="_blank">
                        {attachment.mime_type?.startsWith("image/") ? <Image size={17} /> : <FileText size={17} />}
                        <span>{attachment.original_name || "Report evidence"}</span>
                        <small>{attachment.size_bytes ? `${Math.max(1, Math.round(Number(attachment.size_bytes) / 1024))} KB` : "Open"}</small>
                      </a>
                    ) : null
                  ))}
                </div>
              </section>
            )}

            <section className="detail-section"><div className="detail-section-head"><h2>Conversation</h2><MessageSquareText size={17} /></div><div className="detail-transcript">
              {(transcript ?? []).length === 0 ? <p>No conversation transcript is available.</p> : (transcript ?? []).map((message) => (
                <div className={message.sender_type === "citizen" ? "citizen" : "ai"} key={message.id}><strong>{message.sender_type === "citizen" ? "You" : "Sauti1"}</strong><p>{message.body}</p></div>
              ))}
            </div></section>
          </div>

          <aside className="detail-side">
            <section className="detail-section"><h2>Ticket</h2>{ticket ? <>
              <strong className="ticket-code">{ticket.ticket_code}</strong>
              <div className="detail-kv-list"><div><span>Status</span><strong>{label(ticket.status)}</strong></div><div><span>Created</span><strong>{dateTime(ticket.created_at)}</strong></div><div><span>Acknowledged</span><strong>{dateTime(ticket.acknowledged_at)}</strong></div><div><span>Resolved</span><strong>{dateTime(ticket.resolved_at)}</strong></div></div>
              <Link className="detail-action" href={`/track/${ticket.id}`}>Open tracking timeline</Link>
            </> : <>
              <p>This report has not been submitted yet.</p>
              {["draft", "pending_confirmation"].includes(report.status) && report.source === "text" && (
                <Link className="detail-action" href={`/chat?resume=${report.id}`}>Continue draft in chat</Link>
              )}
            </>}</section>

            <section className="detail-section"><h2>History</h2><div className="event-timeline">{events.length ? events.map((event) => <div key={event.id}><CheckCircle2 size={15} /><div><strong>{label(event.event_type)}</strong><p>{event.note || `${label(event.from_status)} to ${label(event.to_status)}`}</p><span>{dateTime(event.created_at)}</span></div></div>) : <p>No ticket events yet.</p>}</div></section>

            <section className="detail-section"><h2>Dates</h2><div className="detail-kv-list"><div><span>Created</span><strong>{dateTime(report.created_at)}</strong></div><div><span>Confirmed</span><strong>{dateTime(report.confirmed_at)}</strong></div><div><span>Last updated</span><strong>{dateTime(report.updated_at)}</strong></div></div></section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
