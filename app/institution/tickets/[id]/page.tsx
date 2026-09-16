import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  MapPin,
  MessageSquareText,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { PriorityMarker, SourceBadge, StatusBadge } from "@/components/case-ui";
import { TicketAssignment, type AssignmentMember } from "@/components/ticket-assignment";
import {
  TicketCommentComposer,
  TicketTransferRequest,
  type TransferInstitution,
} from "@/components/ticket-collaboration";
import { TicketStatusActions } from "@/components/ticket-status-actions";
import { intakeFieldLabel } from "@/lib/sauti1/intake-fields";
import { visibleIntakeData } from "@/lib/sauti1/report-ai";
import { reportSourceLabel } from "@/lib/sauti1/source-label";
import { createClient } from "@/lib/supabase/server";

type TicketDetail = {
  id: string;
  ticket_code: string;
  status: string;
  priority: string;
  category: string | null;
  assigned_to: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  resolution_proposed_at: string | null;
  created_at: string;
  updated_at: string;
  reports: {
    id: string;
    user_id: string | null;
    conversation_id: string | null;
    description: string;
    ai_summary: string | null;
    detected_category: string | null;
    priority: string;
    status: string;
    source: string;
    ai_confidence: number | null;
    location_text: string | null;
    intake_data: Record<string, string> | null;
    confirmed_at: string | null;
    created_at: string;
    report_attachments: {
      id: string;
      storage_path: string;
      original_name: string | null;
      mime_type: string | null;
      size_bytes: number | null;
      created_at: string;
    }[] | null;
  } | {
    id: string;
    user_id: string | null;
    conversation_id: string | null;
    description: string;
    ai_summary: string | null;
    detected_category: string | null;
    priority: string;
    status: string;
    source: string;
    ai_confidence: number | null;
    location_text: string | null;
    intake_data: Record<string, string> | null;
    confirmed_at: string | null;
    created_at: string;
    report_attachments: {
      id: string;
      storage_path: string;
      original_name: string | null;
      mime_type: string | null;
      size_bytes: number | null;
      created_at: string;
    }[] | null;
  }[] | null;
};

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function label(value: string | null | undefined) {
  return (value || "Not provided").replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function fileSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default async function InstitutionTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("institution_members")
    .select("institution_id, role, institutions(name, short_name)")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/auth/route");

  const { data, error } = await supabase
    .from("tickets")
    .select(`
      id, ticket_code, status, priority, category, assigned_to,
      acknowledged_at, resolved_at, resolution_note, resolution_proposed_at, created_at, updated_at,
      reports(
        id, user_id, conversation_id, description, ai_summary,
        detected_category, priority, status, source, ai_confidence,
        location_text, intake_data, confirmed_at, created_at,
        report_attachments(id, storage_path, original_name, mime_type, size_bytes, created_at)
      )
    `)
    .eq("id", id)
    .eq("institution_id", membership.institution_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) notFound();

  const ticket = data as TicketDetail;
  const report = relatedRecord(ticket.reports);
  if (!report) notFound();

  const [
    { data: citizen, error: citizenError },
    { data: messages, error: messagesError },
    { data: events, error: eventsError },
    { data: team, error: teamError },
    { data: comments, error: commentsError },
    { data: transferInstitutions, error: transferInstitutionsError },
  ] = await Promise.all([
    report.user_id
      ? supabase.from("profiles").select("id, full_name, phone, created_at").eq("id", report.user_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    report.conversation_id
      ? supabase.from("messages").select("id, sender_type, body, created_at").eq("conversation_id", report.conversation_id).order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("ticket_events").select("id, actor_user_id, event_type, from_status, to_status, note, created_at").eq("ticket_id", ticket.id).order("created_at", { ascending: false }),
    ["supervisor", "institution_admin"].includes(membership.role)
      ? supabase.rpc("get_institution_team_directory", { target_institution_id: membership.institution_id })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("ticket_comments").select("id, author_user_id, visibility, body, created_at").eq("ticket_id", ticket.id).order("created_at", { ascending: false }),
    supabase.from("institutions").select("id, name, short_name").eq("status", "active").eq("verified", true).neq("id", membership.institution_id).order("name"),
  ]);
  if (citizenError || messagesError || eventsError || teamError || commentsError || transferInstitutionsError) {
    throw new Error("The complete ticket record could not be loaded.");
  }

  const attachments = report.report_attachments ?? [];
  const signedAttachments = (await Promise.all(attachments.map(async (attachment) => {
    const { data: signed } = await supabase.storage.from("report-attachments").createSignedUrl(attachment.storage_path, 3600);
    return { ...attachment, url: signed?.signedUrl };
  }))).filter((attachment) => Boolean(attachment.url));
  const institution = relatedRecord(membership.institutions);
  const institutionName = institution?.short_name || institution?.name || "Institution";
  const confidence = report.ai_confidence === null ? "Not scored" : `${Math.round(report.ai_confidence * 100)}%`;
  const intakeData = visibleIntakeData(report.intake_data);
  const activeTeam = ((team ?? []) as AssignmentMember[]).filter((member) => member.active !== false && member.member_role !== "viewer");
  const teamById = new Map(activeTeam.map((member) => [member.user_id, member]));
  const canCollaborate = ["supervisor", "institution_admin"].includes(membership.role)
    || (membership.role === "agent" && ticket.assigned_to === user.id);
  const canTransfer = canCollaborate
    && ["routed", "acknowledged", "assigned", "in_progress", "reopened"].includes(ticket.status);

  return (
    <main className="operations-page ticket-detail-page">
      <header className="operations-page-header">
        <div>
          <Link className="back-link" href="/institution/tickets"><ArrowLeft size={15} /> All tickets</Link>
          <p className="eyebrow">{ticket.ticket_code}</p>
          <h1>{label(ticket.category || report.detected_category)}</h1>
          <p>{institutionName} ticket detail</p>
        </div>
        <div className="detail-header-status"><StatusBadge status={ticket.status} /><AutoRefresh intervalSeconds={15} /></div>
      </header>

      <div className="ticket-detail-grid">
        <div className="min-w-0 space-y-4">
          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[9px] font-bold uppercase text-[#7f8a9c]">Citizen report</p><h2 className="mt-1 text-[20px] font-bold">{label(ticket.category || report.detected_category)}</h2></div>
              <div className="flex gap-2"><PriorityMarker priority={ticket.priority} /><SourceBadge source={report.source} /></div>
            </div>
            <div className="mt-4 border-t border-[#edf0f4] pt-4"><h3 className="text-[11px] font-bold">What the citizen reported</h3><p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[#33415b]">{report.description}</p></div>
            {report.ai_summary && <div className="mt-4 rounded-[8px] bg-[#f4f7fc] p-3"><h3 className="text-[10px] font-bold text-[#5f6d84]">SAUTI1 summary</h3><p className="mt-1 text-[12px] leading-5 text-[#34425b]">{report.ai_summary}</p></div>}
            {Object.keys(intakeData).length > 0 && <div className="mt-4 border-t border-[#edf0f4] pt-4"><h3 className="text-[11px] font-bold">Case details</h3><dl className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(intakeData).filter(([key]) => !["incident_description", "document_issue", "location_verification", "location_source_url"].includes(key)).map(([key, value]) => <div className="rounded-[8px] bg-[#f7f9fc] p-3" key={key}><dt className="text-[9px] text-[#7a869a]">{intakeFieldLabel(key)}</dt><dd className="mt-1 break-words text-[11px] font-semibold text-[#2f3d56]">{value}</dd></div>)}</dl></div>}
          </section>

          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2"><MessageSquareText className="text-[#496bb2]" size={17} /><h2 className="text-[13px] font-bold">Conversation transcript</h2></div>
            <div className="mt-4 space-y-3">
              {(messages ?? []).length === 0 ? <p className="text-[11px] text-[#7b879a]">No transcript is available for this report.</p> : (messages ?? []).map((message) => (
                <div className={`max-w-[88%] rounded-[8px] px-3 py-2.5 text-[11px] leading-5 ${message.sender_type === "citizen" ? "ml-auto bg-[#eaf1ff] text-[#18335f]" : "border border-[#e2e7ef] bg-white text-[#34425b]"}`} key={message.id}>
                  <div className="mb-1 text-[8px] font-bold uppercase text-[#77849a]">{message.sender_type === "citizen" ? citizen?.full_name || "Citizen" : "Sauti1 AI"}</div>
                  {message.body}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2"><FileText className="text-[#496bb2]" size={17} /><h2 className="text-[13px] font-bold">Evidence</h2></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {signedAttachments.length === 0 ? <p className="text-[11px] text-[#7b879a]">The citizen did not attach evidence.</p> : signedAttachments.map((attachment) => (
                <a className="flex min-w-0 items-center gap-3 rounded-[8px] border border-[#dfe5ed] p-3 hover:bg-[#f7f9fc]" href={attachment.url} key={attachment.id} rel="noreferrer" target="_blank">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[#edf3ff] text-[#1d5eff]"><FileText size={16} /></span>
                  <span className="min-w-0"><span className="block truncate text-[11px] font-bold">{attachment.original_name || "Report evidence"}</span><span className="mt-0.5 block text-[9px] text-[#7e899b]">{attachment.mime_type || "File"} {fileSize(attachment.size_bytes)}</span></span>
                </a>
              ))}
            </div>
          </section>

          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2"><MessageSquareText className="text-[#496bb2]" size={17} /><h2 className="text-[13px] font-bold">Team notes and citizen updates</h2></div>
            <div className="mt-4 space-y-2">
              {(comments ?? []).length === 0 ? <p className="text-[11px] text-[#7b879a]">No collaboration notes have been added.</p> : (comments ?? []).map((comment) => (
                <article className={`rounded-[8px] border p-3 ${comment.visibility === "internal" ? "border-[#eadfbe] bg-[#fffaf0]" : "border-[#d8e5f8] bg-[#f6f9ff]"}`} key={comment.id}>
                  <div className="flex items-center justify-between gap-3"><strong className="text-[9px] uppercase text-[#68758a]">{comment.visibility === "internal" ? "Internal only" : "Citizen-visible"}</strong><time className="text-[8px] text-[#98a1af]">{dateLabel(comment.created_at)}</time></div>
                  <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#34425b]">{comment.body}</p>
                  <small className="mt-2 block text-[8px] text-[#8b95a5]">{comment.author_user_id ? teamById.get(comment.author_user_id)?.full_name || "Institution team member" : "SAUTI1 operations"}</small>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4">
            <div className="flex items-center gap-2"><UserRound className="text-[#496bb2]" size={17} /><h2 className="text-[13px] font-bold">Sent by</h2></div>
            <div className="mt-3 rounded-[8px] bg-[#f5f7fb] p-3"><p className="text-[13px] font-bold">{citizen?.full_name || "Citizen"}</p><p className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#68758a]"><ShieldCheck size={12} className="text-[#087a50]" /> {report.user_id ? "Authenticated citizen account" : `${reportSourceLabel(report.source)} contact`}</p></div>
            <dl className="mt-3 space-y-2.5 text-[10px]">
              <div className="flex items-start justify-between gap-3"><dt className="inline-flex items-center gap-1 text-[#7a869a]"><Phone size={12} /> Phone</dt><dd className="text-right font-semibold">{citizen?.phone || intakeData.contact_phone || "Not provided"}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="inline-flex items-center gap-1 text-[#7a869a]"><MapPin size={12} /> Location</dt><dd className="max-w-[180px] text-right font-semibold">{report.location_text || "Not provided"}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-[#7a869a]">AI confidence</dt><dd className="font-semibold">{confidence}</dd></div>
            </dl>
          </section>

          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4">
            <h2 className="text-[13px] font-bold">Update ticket</h2><p className="mt-1 text-[10px] leading-4 text-[#748095]">Every update is recorded and shown to the citizen.</p>
            {["acknowledged", "assigned", "in_progress", "reopened"].includes(ticket.status) && ["supervisor", "institution_admin"].includes(membership.role) && (
              <div className="mt-4"><TicketAssignment currentAssignee={ticket.assigned_to} members={activeTeam} ticketId={ticket.id} /></div>
            )}
            <div className="mt-4"><TicketStatusActions status={ticket.status} ticketId={ticket.id} /></div>
            {ticket.status === "resolution_proposed" && <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#59667b]"><Clock3 size={14} /> Waiting for the citizen to confirm whether the issue is fixed.</p>}
            {["closed", "cancelled"].includes(ticket.status) && <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#59667b]"><CheckCircle2 size={14} /> No further actions are available.</p>}
          </section>

          {canCollaborate && !["closed", "cancelled"].includes(ticket.status) && (
            <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4">
              <h2 className="text-[13px] font-bold">Add note or update</h2>
              <p className="mt-1 text-[10px] leading-4 text-[#748095]">Internal notes stay private. Citizen updates appear in the citizen timeline.</p>
              <div className="mt-4"><TicketCommentComposer ticketId={ticket.id} /></div>
            </section>
          )}

          {canTransfer && (
            <section className="rounded-[8px] border border-[#ead9c9] bg-[#fffaf5] p-4">
              <h2 className="text-[13px] font-bold">Not our mandate</h2>
              <p className="mt-1 text-[10px] leading-4 text-[#786958]">Request review without rejecting or replacing the citizen&apos;s ticket.</p>
              <div className="mt-4"><TicketTransferRequest institutions={(transferInstitutions ?? []) as TransferInstitution[]} ticketId={ticket.id} /></div>
            </section>
          )}

          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4">
            <h2 className="text-[13px] font-bold">Ticket facts</h2>
            <dl className="mt-3 space-y-2.5 text-[10px]">
              <div className="flex justify-between gap-3"><dt className="text-[#7a869a]">Report status</dt><dd className="font-semibold">{label(report.status)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#7a869a]">Confirmed</dt><dd className="text-right font-semibold">{dateLabel(report.confirmed_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#7a869a]">Acknowledged</dt><dd className="text-right font-semibold">{dateLabel(ticket.acknowledged_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#7a869a]">Resolution proposed</dt><dd className="text-right font-semibold">{dateLabel(ticket.resolution_proposed_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#7a869a]">Citizen confirmed</dt><dd className="text-right font-semibold">{dateLabel(ticket.resolved_at)}</dd></div>
            </dl>
          </section>

          <section className="rounded-[8px] border border-[#e0e5ed] bg-white p-4">
            <div className="flex items-center gap-2"><Clock3 className="text-[#496bb2]" size={17} /><h2 className="text-[13px] font-bold">History</h2></div>
            <ol className="mt-4 space-y-4">
              {(events ?? []).map((event) => (
                <li className="relative pl-5 before:absolute before:left-[5px] before:top-4 before:h-[calc(100%+8px)] before:w-px before:bg-[#dce3ed] last:before:hidden" key={event.id}>
                  <span className="absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 border-white bg-[#4d72c4] ring-1 ring-[#cad4e4]" />
                  <p className="text-[10px] font-bold">{label(event.event_type)}</p><p className="mt-0.5 text-[9px] text-[#788499]">{event.note || `${label(event.from_status)} to ${label(event.to_status)}`}</p><p className="mt-1 inline-flex items-center gap-1 text-[8px] text-[#9aa3b2]"><CalendarDays size={10} /> {dateLabel(event.created_at)}{event.actor_user_id && <> · {teamById.get(event.actor_user_id)?.full_name || "Institution team member"}</>}</p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}
