import { ArrowRight, Clock3, SearchCheck } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { TicketLifecycle } from "@/components/ticket-lifecycle";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function TrackPage() {
  const { supabase, user } = await requireCitizenWorkspace();
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(`
      id, ticket_code, status, created_at,
      institutions (name, short_name),
      reports!inner (user_id, ai_summary, description, source, detected_category),
      ticket_events (id, event_type, note, created_at)
    `)
    .eq("reports.user_id", user.id)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "ticket_events", ascending: true })
    .limit(50);
  if (error) throw new Error("We could not load ticket tracking. Please try again.");

  return (
    <AppShell>
      <div className="simple-page case-index-page">
        <header className="case-index-header">
          <div><p className="eyebrow">Accountability</p><h1 className="page-title">Track tickets</h1><p className="page-subtitle">Follow receipt, institution work and resolution without losing the original record.</p></div>
          <AutoRefresh intervalSeconds={20} />
        </header>

        {(tickets ?? []).length === 0 ? (
          <EmptyState
            action={<Link className="primary-page-action" href="/chat">Start a report</Link>}
            description="A tracking number appears after you review and submit a report."
            icon={<SearchCheck size={20} />}
            title="No submitted tickets"
          />
        ) : (
          <div className="tracking-list">
            {(tickets ?? []).map((ticket) => {
              const institution = Array.isArray(ticket.institutions) ? ticket.institutions[0] : ticket.institutions;
              const report = Array.isArray(ticket.reports) ? ticket.reports[0] : ticket.reports;
              const latestEvent = ticket.ticket_events?.at(-1);
              return (
                <Link className="tracking-ticket" href={`/track/${ticket.id}`} key={ticket.id} prefetch={false}>
                  <div className="tracking-ticket-head">
                    <div>
                      <span>{ticket.ticket_code}</span>
                      <strong>{titleCase(report?.detected_category, "Citizen service issue")}</strong>
                      <small>{institution?.short_name || institution?.name || "Institution not available"}</small>
                    </div>
                    <div className="tracking-ticket-action"><SourceBadge source={report?.source} /><StatusBadge status={ticket.status} /><ArrowRight size={17} /></div>
                  </div>
                  <p>{report?.ai_summary || report?.description}</p>
                  <TicketLifecycle compact status={ticket.status} />
                  {latestEvent && (
                    <div className="tracking-latest-event">
                      <Clock3 aria-hidden="true" size={13} />
                      <span>{latestEvent.note || titleCase(latestEvent.event_type)}</span>
                      <time>{timeLabel(latestEvent.created_at)}</time>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
