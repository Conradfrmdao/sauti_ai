import {
  AlertTriangle,
  ArrowRight,
  Building2,
  FileCheck2,
  RadioTower,
  TicketCheck,
} from "lucide-react";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PriorityMarker, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { requireAdminWorkspace } from "@/lib/auth/workspace-session";
import { createAdminClient } from "@/lib/supabase/admin";

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminPage() {
  const { supabase } = await requireAdminWorkspace();
  const trustedSupabase = createAdminClient();

  const [
    { count: institutions, error: institutionError },
    { count: submittedReports, error: reportError },
    { count: openTickets, error: ticketError },
    { count: routingReviews, error: routingReviewError },
    { data: recentTickets, error: recentError },
    { data: institutionRows, error: readinessError },
    { count: failedProviderEvents, error: providerError },
  ] = await Promise.all([
    supabase.from("institutions").select("id", { count: "exact", head: true }),
    supabase.from("reports").select("id", { count: "exact", head: true })
      .not("status", "in", "(draft,pending_confirmation)"),
    supabase.from("tickets").select("id", { count: "exact", head: true })
      .not("status", "in", "(closed,cancelled)"),
    supabase.from("routing_decisions").select("id", { count: "exact", head: true })
      .eq("review_required", true)
      .is("reviewed_at", null),
    supabase.from("tickets").select(`
      id, ticket_code, status, priority, category, created_at,
      institutions(name, short_name),
      reports(source, ai_summary, description, location_text)
    `).order("created_at", { ascending: false }).limit(10),
    supabase.from("institutions").select("id, status, onboarding_state, verified"),
    trustedSupabase.from("provider_webhook_events").select("id", { count: "exact", head: true }).eq("outcome", "failed"),
  ]);

  if (institutionError || reportError || ticketError || routingReviewError || recentError || readinessError || providerError) {
    throw new Error("The platform snapshot could not be loaded. Please try again.");
  }

  const onboarded = (institutionRows ?? []).filter((item) => item.onboarding_state === "onboarded").length;
  const invited = (institutionRows ?? []).filter((item) => item.onboarding_state === "invited").length;
  const catalogued = (institutionRows ?? []).filter((item) => item.onboarding_state === "catalogued").length;
  const suspended = (institutionRows ?? []).filter((item) => item.status === "suspended").length;

  return (
    <main className="operations-page">
      <header className="operations-page-header">
        <div><p className="eyebrow">Platform operations</p><h1>Network overview</h1><p>Exact case, institution and channel counts from the current platform state.</p></div>
        <AutoRefresh intervalSeconds={20} />
      </header>

      <section className="operations-metrics">
        <div><span><Building2 size={17} /></span><p>Institutions</p><strong>{institutions ?? 0}</strong></div>
        <div><span><FileCheck2 size={17} /></span><p>Submitted reports</p><strong>{submittedReports ?? 0}</strong></div>
        <div><span><TicketCheck size={17} /></span><p>Open tickets</p><strong>{openTickets ?? 0}</strong></div>
        <div><span className={(failedProviderEvents ?? 0) > 0 ? "is-danger" : "is-success"}><RadioTower size={17} /></span><p>Failed provider events</p><strong>{failedProviderEvents ?? 0}</strong></div>
      </section>

      <div className="operations-grid">
        <section className="operations-panel">
          <header><div><h2>Recent routing activity</h2><p>Newest tickets across every authorized institution.</p></div><Link href="/admin/reports">Open operations queue <ArrowRight size={15} /></Link></header>
          {(recentTickets ?? []).length === 0 ? (
            <EmptyState description="Submitted reports will appear here after a ticket is created." icon={<TicketCheck size={19} />} title="No routed tickets" />
          ) : (
            <div className="operations-case-list">
              {(recentTickets ?? []).map((ticket) => {
                const institution = relatedRecord(ticket.institutions);
                const report = relatedRecord(ticket.reports);
                return (
                  <Link href={`/admin/reports/${ticket.id}`} key={ticket.id} prefetch={false}>
                    <div className="operations-case-copy"><span>{ticket.ticket_code}</span><strong>{titleCase(ticket.category, "Citizen service issue")}</strong><p>{report?.ai_summary || report?.description}</p><small>{institution?.short_name || institution?.name || "No institution"}{report?.location_text ? ` · ${report.location_text}` : ""}</small></div>
                    <div className="operations-case-badges"><PriorityMarker priority={ticket.priority} /><SourceBadge source={report?.source} /><StatusBadge status={ticket.status} /></div>
                    <ArrowRight aria-hidden="true" size={17} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <aside className="operations-aside">
          <section className="operations-panel admin-readiness">
            <header><div><h2>Institution readiness</h2><p>Lifecycle states, not inferred partnerships.</p></div></header>
            <dl><div><dt>Onboarded</dt><dd>{onboarded}</dd></div><div><dt>Invited</dt><dd>{invited}</dd></div><div><dt>Catalogued</dt><dd>{catalogued}</dd></div><div><dt>Suspended</dt><dd>{suspended}</dd></div></dl>
            <Link href="/admin/institutions">Manage institutions <ArrowRight size={15} /></Link>
          </section>
          <section className="operations-note">
            <strong><AlertTriangle size={14} /> Routing review queue: {routingReviews ?? 0}</strong>
            <p>Confidence, missing service evidence and institution transfers create review signals. Confidence is never presented as accuracy.</p>
            <Link href="/admin/routing">Open routing review <ArrowRight size={15} /></Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
