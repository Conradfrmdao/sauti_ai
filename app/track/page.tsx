import { ArrowRight, CheckCircle2, Circle, Clock3 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

const stages = ["routed", "acknowledged", "in_progress", "resolved"];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export default async function TrackPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: tickets } = await supabase
    .from("tickets")
    .select(`
      id, ticket_code, status, created_at,
      institutions (name, short_name),
      reports!inner (user_id, ai_summary, description),
      ticket_events (id, event_type, note, created_at)
    `)
    .eq("reports.user_id", user.id)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "ticket_events", ascending: true })
    .limit(50);

  return (
    <AppShell>
      <div className="simple-page">
        <h1 className="page-title">Track a ticket</h1>
        <p className="page-subtitle">Open a ticket to see its complete report and institution timeline.</p>

        <div className="tracking-list">
          {(tickets ?? []).length === 0 ? (
            <div className="preview-empty">You do not have a submitted ticket yet.</div>
          ) : (tickets ?? []).map((ticket) => {
            const institution = Array.isArray(ticket.institutions) ? ticket.institutions[0] : ticket.institutions;
            const report = Array.isArray(ticket.reports) ? ticket.reports[0] : ticket.reports;
            const currentIndex = stages.indexOf(ticket.status);
            return (
              <Link className="tracking-ticket" href={`/track/${ticket.id}`} key={ticket.id}>
                <div className="tracking-ticket-head">
                  <div><strong>{ticket.ticket_code}</strong><span>{institution?.short_name || institution?.name}</span></div>
                  <div className="tracking-ticket-action"><span className="activity-status">{label(ticket.status)}</span><ArrowRight size={17} /></div>
                </div>
                <p>{report?.ai_summary || report?.description}</p>
                <div className="tracking-stages">
                  {stages.map((stage, index) => {
                    const complete = currentIndex >= index || ticket.status === "closed";
                    return <div className={complete ? "complete" : ""} key={stage}>{complete ? <CheckCircle2 size={16} /> : <Circle size={16} />}<span>{label(stage)}</span></div>;
                  })}
                </div>
                <div className="tracking-events">
                  {(ticket.ticket_events ?? []).slice(-2).map((event) => (
                    <div key={event.id}><Clock3 size={12} /><span>{event.note || label(event.event_type)}</span></div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
