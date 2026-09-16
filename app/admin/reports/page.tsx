import { ArrowRight, ChevronLeft, ChevronRight, Search, TicketCheck } from "lucide-react";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PriorityMarker, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { requireAdminWorkspace } from "@/lib/auth/workspace-session";

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const pageSize = 30;
const statuses = new Set(["open", "all", "submitted", "routed", "needs_review", "acknowledged", "assigned", "in_progress", "resolution_proposed", "reopened", "closed", "cancelled"]);
const sources = new Set(["all", "text", "voice", "phone", "sms"]);
const priorities = new Set(["all", "low", "normal", "high", "critical"]);

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdminWorkspace();
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const safeQ = q.replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
  const status = typeof params.status === "string" && statuses.has(params.status) ? params.status : "open";
  const source = typeof params.source === "string" && sources.has(params.source) ? params.source : "all";
  const priority = typeof params.priority === "string" && priorities.has(params.priority) ? params.priority : "all";
  const parsedPage = typeof params.page === "string" ? Number.parseInt(params.page, 10) : 1;
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const from = (page - 1) * pageSize;

  let query = supabase.from("tickets").select(`
    id, ticket_code, status, priority, category, created_at,
    institutions!tickets_institution_id_fkey(id, name, short_name),
    reports!inner(source, ai_summary, description, location_text)
  `, { count: "exact" });
  if (status === "open") query = query.not("status", "in", "(closed,cancelled)");
  else if (status !== "all") query = query.eq("status", status);
  if (source !== "all") query = query.eq("reports.source", source);
  if (priority !== "all") query = query.eq("priority", priority);
  if (safeQ) query = query.or(`ticket_code.ilike.%${safeQ}%,category.ilike.%${safeQ}%`);

  const { data: tickets, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error("The platform case queue could not be loaded.");
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const queryBase = { q, status, source, priority };

  return (
    <main className="operations-page">
      <header className="operations-page-header"><div><p className="eyebrow">Platform triage</p><h1>Reports & tickets</h1><p>Review routing across every institution and channel; open a case to correct its destination.</p></div><AutoRefresh intervalSeconds={20} /></header>

      <form className="operations-filters" method="get">
        <label className="operations-search"><Search size={17} /><span className="sr-only">Search ticket code or category</span><input defaultValue={q} name="q" placeholder="Search ticket code or category" /></label>
        <label><span>Status</span><select defaultValue={status} name="status"><option value="open">Open</option><option value="all">All</option><option value="routed">Routed</option><option value="needs_review">Needs review</option><option value="acknowledged">Acknowledged</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="resolution_proposed">Awaiting citizen</option><option value="reopened">Reopened</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label>
        <label><span>Channel</span><select defaultValue={source} name="source"><option value="all">All channels</option><option value="text">Web</option><option value="voice">Voice</option><option value="phone">Phone</option><option value="sms">SMS</option></select></label>
        <label><span>Priority</span><select defaultValue={priority} name="priority"><option value="all">All priorities</option><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
        <button type="submit">Apply filters</button>
      </form>

      <section className="operations-panel">
        <header><div><h2>Case queue</h2><p>{count ?? 0} matching ticket{count === 1 ? "" : "s"}</p></div></header>
        {(tickets ?? []).length === 0 ? (
          <EmptyState description="Change the filters or wait for new routed reports." icon={<TicketCheck size={19} />} title="No matching tickets" />
        ) : (
          <div className="operations-case-list is-index">
            {(tickets ?? []).map((ticket) => {
              const institution = relatedRecord(ticket.institutions);
              const report = relatedRecord(ticket.reports);
              return (
                <Link href={`/admin/reports/${ticket.id}`} key={ticket.id} prefetch={false}>
                  <div className="operations-case-copy"><span>{ticket.ticket_code}</span><strong>{titleCase(ticket.category, "Citizen service issue")}</strong><p>{report?.ai_summary || report?.description}</p><small>{institution?.short_name || institution?.name || "No institution"}{report?.location_text ? ` · ${report.location_text}` : ""}</small></div>
                  <div className="operations-case-badges"><PriorityMarker priority={ticket.priority} /><SourceBadge source={report?.source} /><StatusBadge status={ticket.status} /><time>{new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(new Date(ticket.created_at))}</time></div>
                  <ArrowRight size={17} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {totalPages > 1 && <nav aria-label="Report pages" className="operations-pagination">{page > 1 ? <Link href={{ pathname: "/admin/reports", query: { ...queryBase, page: page - 1 } }}><ChevronLeft size={15} /> Previous</Link> : <span />}<p>Page {Math.min(page, totalPages)} of {totalPages}</p>{page < totalPages ? <Link href={{ pathname: "/admin/reports", query: { ...queryBase, page: page + 1 } }}>Next <ChevronRight size={15} /></Link> : <span />}</nav>}
    </main>
  );
}
