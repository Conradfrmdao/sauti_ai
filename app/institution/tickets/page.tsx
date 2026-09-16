import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
  TicketCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PriorityMarker, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { requireInstitutionWorkspace } from "@/lib/auth/workspace-session";

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const pageSize = 25;
const allowedStatuses = new Set(["all", "open", "submitted", "routed", "needs_review", "acknowledged", "assigned", "in_progress", "resolution_proposed", "reopened", "closed", "cancelled"]);
const allowedSources = new Set(["all", "text", "voice", "phone", "sms"]);
const allowedPriorities = new Set(["all", "low", "normal", "high", "critical"]);

export default async function InstitutionTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, membership } = await requireInstitutionWorkspace();
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const safeQ = q.replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
  const requestedStatus = typeof params.status === "string" ? params.status : "open";
  const requestedSource = typeof params.source === "string" ? params.source : "all";
  const requestedPriority = typeof params.priority === "string" ? params.priority : "all";
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "open";
  const source = allowedSources.has(requestedSource) ? requestedSource : "all";
  const priority = allowedPriorities.has(requestedPriority) ? requestedPriority : "all";
  const requestedPage = typeof params.page === "string" ? Number.parseInt(params.page, 10) : 1;
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("tickets")
    .select(`
      id, ticket_code, status, priority, category, created_at, assigned_to,
      reports!inner(user_id, description, ai_summary, source, location_text)
    `, { count: "exact" })
    .eq("institution_id", membership.institution_id);

  if (status === "open") query = query.not("status", "in", "(closed,cancelled)");
  else if (status !== "all") query = query.eq("status", status);
  if (source !== "all") query = query.eq("reports.source", source);
  if (priority !== "all") query = query.eq("priority", priority);
  if (safeQ) query = query.or(`ticket_code.ilike.%${safeQ}%,category.ilike.%${safeQ}%`);

  const { data: tickets, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error("The ticket queue could not be loaded. Please try again.");

  const citizenIds = [...new Set((tickets ?? [])
    .map((ticket) => relatedRecord(ticket.reports)?.user_id)
    .filter(Boolean))] as string[];
  const { data: profiles, error: profilesError } = citizenIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", citizenIds)
    : { data: [], error: null };
  if (profilesError) throw new Error("Citizen details could not be loaded.");
  const citizenById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const queryBase = { q, status, source, priority };

  return (
    <main className="operations-page">
      <header className="operations-page-header">
        <div>
          <Link className="back-link" href="/institution"><ArrowLeft size={15} /> Priority queue</Link>
          <p className="eyebrow">Case management</p>
          <h1>All tickets</h1>
          <p>Search and filter the institution’s complete visible ticket record.</p>
        </div>
        <AutoRefresh intervalSeconds={25} />
      </header>

      <form className="operations-filters" method="get">
        <label className="operations-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">Search ticket code or category</span>
          <input defaultValue={q} name="q" placeholder="Search ticket code or category" />
        </label>
        <label><span>Status</span><select defaultValue={status} name="status">
          <option value="open">Open</option><option value="all">All</option><option value="routed">Routed</option>
          <option value="needs_review">Needs review</option><option value="acknowledged">Acknowledged</option><option value="assigned">Assigned</option>
          <option value="in_progress">In progress</option><option value="resolution_proposed">Awaiting citizen</option>
          <option value="reopened">Reopened</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option>
        </select></label>
        <label><span>Channel</span><select defaultValue={source} name="source">
          <option value="all">All channels</option><option value="text">Web</option><option value="voice">Voice</option>
          <option value="phone">Phone</option><option value="sms">SMS</option>
        </select></label>
        <label><span>Priority</span><select defaultValue={priority} name="priority">
          <option value="all">All priorities</option><option value="critical">Critical</option><option value="high">High</option>
          <option value="normal">Normal</option><option value="low">Low</option>
        </select></label>
        <button type="submit">Apply filters</button>
      </form>

      <section className="operations-panel ticket-index-panel">
        <header><div><h2>Results</h2><p>{count ?? 0} matching ticket{count === 1 ? "" : "s"}</p></div></header>
        {(tickets ?? []).length === 0 ? (
          <EmptyState
            description="Change the filters or wait for a new citizen report to be routed here."
            icon={<TicketCheck size={19} />}
            title="No matching tickets"
          />
        ) : (
          <div className="operations-case-list is-index">
            {(tickets ?? []).map((ticket) => {
              const report = relatedRecord(ticket.reports);
              const citizen = report ? citizenById.get(report.user_id) : undefined;
              return (
                <Link href={`/institution/tickets/${ticket.id}`} key={ticket.id} prefetch={false}>
                  <div className="operations-case-copy">
                    <span>{ticket.ticket_code}</span>
                    <strong>{titleCase(ticket.category, "Citizen service issue")}</strong>
                    <p>{report?.ai_summary || report?.description}</p>
                    <small><UserRound size={12} /> {citizen?.full_name || "Citizen"} {report?.location_text && <> · <MapPin size={12} /> {report.location_text}</>}</small>
                  </div>
                  <div className="operations-case-badges">
                    <PriorityMarker priority={ticket.priority} />
                    <SourceBadge source={report?.source} />
                    <StatusBadge status={ticket.status} />
                    <time>{dateLabel(ticket.created_at)}</time>
                  </div>
                  <ArrowRight aria-hidden="true" size={17} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <nav aria-label="Ticket pages" className="operations-pagination">
          {page > 1 ? <Link href={{ pathname: "/institution/tickets", query: { ...queryBase, page: page - 1 } }}><ChevronLeft size={15} /> Previous</Link> : <span />}
          <p>Page {Math.min(page, totalPages)} of {totalPages}</p>
          {page < totalPages ? <Link href={{ pathname: "/institution/tickets", query: { ...queryBase, page: page + 1 } }}>Next <ChevronRight size={15} /></Link> : <span />}
        </nav>
      )}
    </main>
  );
}
