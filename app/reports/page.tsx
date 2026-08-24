import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ReportsPage() {
  const { supabase, user } = await requireCitizenWorkspace();
  await supabase
    .from("reports")
    .update({ attention_read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("source", "text")
    .in("status", ["draft", "pending_confirmation"])
    .is("attention_read_at", null);

  const { data: reports } = await supabase
    .from("reports")
    .select(`
      id, description, ai_summary, detected_category, status, created_at,
      institutions (name, short_name),
      tickets (id, ticket_code, status, acknowledged_at)
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <AppShell>
      <div className="simple-page">
        <h1 className="page-title">My reports</h1>
        <p className="page-subtitle">Every report, institution response and resolution in one place.</p>

        <div className="table-card report-table">
          <div className="row report-table-head">
            <div>Report</div><div>Status</div><div>Created</div><div>Ticket</div><div />
          </div>

          {(reports ?? []).length === 0 ? (
            <div className="report-empty"><strong>No reports yet</strong><span>Text Sauti1 to create your first report.</span></div>
          ) : (reports ?? []).map((report) => {
            const ticket = Array.isArray(report.tickets) ? report.tickets[0] : report.tickets;
            const institution = Array.isArray(report.institutions) ? report.institutions[0] : report.institutions;
            return (
              <Link className="row report-row" href={`/reports/${report.id}`} key={report.id}>
                <div className="report-row-copy">
                  <strong>{label(report.detected_category || "Citizen service issue")}</strong>
                  <span>{report.ai_summary || report.description}</span>
                  <small>{institution?.short_name || institution?.name || "Institution not yet identified"}</small>
                </div>
                <div><span className="activity-status">{label(ticket?.status || report.status)}</span></div>
                <div>{timeLabel(report.created_at)}</div>
                <div>{ticket?.ticket_code || "Draft"}</div>
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
