import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Clock3,
  Inbox,
  TicketCheck,
} from "lucide-react";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PriorityMarker, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { requireInstitutionWorkspace } from "@/lib/auth/workspace-session";

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const priorityRank: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export default async function InstitutionPage() {
  const { supabase, membership } = await requireInstitutionWorkspace();
  const institution = relatedRecord(membership.institutions);
  const institutionName = institution?.short_name || institution?.name || "Institution";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { data: queueRows, error: queueError },
    { count: openCount, error: openError },
    { count: newToday, error: todayError },
    { count: highPriority, error: priorityError },
    { count: acknowledgedCount, error: acknowledgedError },
    { count: knowledgeCount, error: knowledgeError },
  ] = await Promise.all([
    supabase
      .from("tickets")
      .select(`
        id, ticket_code, status, priority, category, created_at, assigned_to,
        reports (description, ai_summary, source, location_text, report_attachments(id))
      `)
      .eq("institution_id", membership.institution_id)
      .not("status", "in", "(closed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("tickets").select("id", { count: "exact", head: true })
      .eq("institution_id", membership.institution_id)
      .not("status", "in", "(closed,cancelled)"),
    supabase.from("tickets").select("id", { count: "exact", head: true })
      .eq("institution_id", membership.institution_id)
      .gte("created_at", today.toISOString()),
    supabase.from("tickets").select("id", { count: "exact", head: true })
      .eq("institution_id", membership.institution_id)
      .in("priority", ["high", "critical"])
      .not("status", "in", "(closed,cancelled)"),
    supabase.from("tickets").select("id", { count: "exact", head: true })
      .eq("institution_id", membership.institution_id)
      .not("acknowledged_at", "is", null),
    supabase.from("knowledge_documents").select("id", { count: "exact", head: true })
      .eq("institution_id", membership.institution_id)
      .eq("status", "verified"),
  ]);

  if (queueError || openError || todayError || priorityError || acknowledgedError || knowledgeError) {
    throw new Error("The institution queue could not be loaded. Please try again.");
  }

  const queue = [...(queueRows ?? [])].sort((left, right) => {
    const priorityDifference = (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9);
    return priorityDifference || new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });

  return (
    <main className="operations-page">
      <header className="operations-page-header">
        <div>
          <p className="eyebrow">Institution operations</p>
          <h1>Priority queue</h1>
          <p>{institutionName} · Open cases are ordered by urgency, then age.</p>
        </div>
        <AutoRefresh intervalSeconds={20} />
      </header>

      <section className="operations-metrics" aria-label="Queue metrics">
        <div><span><Inbox size={17} /></span><p>Open tickets</p><strong>{openCount ?? 0}</strong></div>
        <div><span><Clock3 size={17} /></span><p>New today</p><strong>{newToday ?? 0}</strong></div>
        <div><span className="is-danger"><AlertTriangle size={17} /></span><p>High or critical</p><strong>{highPriority ?? 0}</strong></div>
        <div><span className="is-success"><TicketCheck size={17} /></span><p>Ever acknowledged</p><strong>{acknowledgedCount ?? 0}</strong></div>
      </section>

      <div className="operations-grid">
        <section className="operations-panel queue-panel">
          <header>
            <div><h2>Needs attention</h2><p>{openCount ?? 0} open case{openCount === 1 ? "" : "s"} across Web, Voice, Phone and SMS</p></div>
            <Link href="/institution/tickets">Open all <ArrowRight size={15} /></Link>
          </header>

          {queue.length === 0 ? (
            <EmptyState
              description={`New reports routed to ${institutionName} will appear here.`}
              icon={<TicketCheck size={19} />}
              title="The open queue is clear"
            />
          ) : (
            <div className="operations-case-list">
              {queue.slice(0, 12).map((ticket) => {
                const report = relatedRecord(ticket.reports);
                return (
                  <Link href={`/institution/tickets/${ticket.id}`} key={ticket.id} prefetch={false}>
                    <div className="operations-case-copy">
                      <span>{ticket.ticket_code}</span>
                      <strong>{titleCase(ticket.category, "Citizen service issue")}</strong>
                      <p>{report?.ai_summary || report?.description}</p>
                      <small>{report?.location_text || "Location not provided"} · {timeLabel(ticket.created_at)}</small>
                    </div>
                    <div className="operations-case-badges">
                      <PriorityMarker priority={ticket.priority} />
                      <SourceBadge source={report?.source} />
                      <StatusBadge status={ticket.status} />
                    </div>
                    <ArrowRight aria-hidden="true" size={17} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <aside className="operations-aside">
          <section className="operations-panel knowledge-panel">
            <span className="panel-icon"><BookOpenCheck size={19} /></span>
            <p className="eyebrow">Routing knowledge</p>
            <strong>{knowledgeCount ?? 0}</strong>
            <h2>Verified documents</h2>
            <p>Official sources SAUTI1 can use when understanding and routing this institution’s cases.</p>
            <Link href="/institution/knowledge">Review knowledge <ArrowRight size={15} /></Link>
          </section>
          <section className="operations-note">
            <strong>Queue truth</strong>
            <p>This page refreshes every 20 seconds while visible. Open work excludes only closed and cancelled tickets.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
