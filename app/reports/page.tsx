import { ArrowRight, FileText, Plus } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { MarkDraftsRead } from "@/components/visit-effects";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function ReportsPage() {
  const { supabase, user } = await requireCitizenWorkspace();
  const [
    { data: reports, error: reportsError },
    { count: total, error: totalError },
    { count: active, error: activeError },
    { count: resolved, error: resolvedError },
  ] = await Promise.all([
    supabase
      .from("reports")
      .select(`
        id, description, ai_summary, detected_category, status, source, created_at,
        institutions (name, short_name),
        tickets (id, ticket_code, status, acknowledged_at)
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("user_id", user.id)
      .in("status", ["submitted", "routed", "needs_review", "acknowledged", "assigned", "in_progress", "resolution_proposed", "reopened"]),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("user_id", user.id)
      .in("status", ["resolved_confirmed", "closed"]),
  ]);
  if (reportsError || totalError || activeError || resolvedError) {
    throw new Error("We could not load your reports. Please try again.");
  }

  return (
    <AppShell>
      <MarkDraftsRead />
      <div className="simple-page case-index-page">
        <header className="case-index-header">
          <div><p className="eyebrow">Your record</p><h1 className="page-title">My reports</h1><p className="page-subtitle">Drafts, submitted cases and institution outcomes in one accountable record.</p></div>
          <Link className="primary-page-action" href="/chat"><Plus aria-hidden="true" size={17} /> New report</Link>
        </header>

        <section className="case-index-summary" aria-label="Report summary">
          <div><strong>{total ?? 0}</strong><span>All reports</span></div>
          <div><strong>{active ?? 0}</strong><span>Being handled</span></div>
          <div><strong>{resolved ?? 0}</strong><span>Citizen-confirmed</span></div>
        </section>

        {(reports ?? []).length === 0 ? (
          <EmptyState
            action={<Link className="primary-page-action" href="/chat">Start a report</Link>}
            description="Describe an issue in your own words. SAUTI1 will help turn it into a case you can review."
            icon={<FileText size={19} />}
            title="No reports yet"
          />
        ) : (
          <>
            <div className="case-list" role="list">
              {(reports ?? []).map((report) => {
                const ticket = Array.isArray(report.tickets) ? report.tickets[0] : report.tickets;
                const institution = Array.isArray(report.institutions) ? report.institutions[0] : report.institutions;
                return (
                  <Link href={`/reports/${report.id}`} key={report.id} prefetch={false} role="listitem">
                    <div className="case-list-copy">
                      <span>{ticket?.ticket_code || "Draft report"}</span>
                      <strong>{titleCase(report.detected_category, "Citizen service issue")}</strong>
                      <p>{report.ai_summary || report.description}</p>
                      <small>{institution?.short_name || institution?.name || "Institution not yet identified"}</small>
                    </div>
                    <div className="case-list-facts">
                      <SourceBadge source={report.source} />
                      <StatusBadge status={ticket?.status || report.status} />
                      <time>{timeLabel(report.created_at)}</time>
                    </div>
                    <ArrowRight aria-hidden="true" size={18} />
                  </Link>
                );
              })}
            </div>
            {(total ?? 0) > 50 && <p className="result-limit-note">Showing the newest 50 of {total} reports.</p>}
          </>
        )}
      </div>
    </AppShell>
  );
}
