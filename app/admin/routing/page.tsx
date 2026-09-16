import { AlertTriangle, ArrowRight, Route } from "lucide-react";
import Link from "next/link";

import { AdminRoutingApproval } from "@/components/admin-routing-approval";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PriorityMarker, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { requireAdminWorkspace } from "@/lib/auth/workspace-session";

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminRoutingReviewPage() {
  const { supabase } = await requireAdminWorkspace();
  const { data: decisions, error: decisionsError } = await supabase
    .from("routing_decisions")
    .select("id, ticket_id, predicted_institution_id, predicted_service_id, confidence, alternative_candidates, routing_evidence, decision_source, engine, model_name, review_reasons, created_at")
    .eq("review_required", true)
    .is("reviewed_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (decisionsError) throw new Error("The routing review queue could not be loaded.");

  const ticketIds = (decisions ?? []).map((decision) => decision.ticket_id);
  const { data: tickets, error: ticketsError } = ticketIds.length
    ? await supabase.from("tickets").select(`
        id, ticket_code, institution_id, status, priority, category,
        reports(description, ai_summary, source, location_text, detected_category)
      `).in("id", ticketIds)
    : { data: [], error: null };
  if (ticketsError) throw new Error("Tickets for routing review could not be loaded.");

  const institutionIds = [...new Set([
    ...(decisions ?? []).map((decision) => decision.predicted_institution_id),
    ...(tickets ?? []).map((ticket) => ticket.institution_id),
  ].filter(Boolean))] as string[];
  const serviceIds = [...new Set((decisions ?? []).map((decision) => decision.predicted_service_id).filter(Boolean))] as string[];
  const [{ data: institutions }, { data: services }] = await Promise.all([
    institutionIds.length
      ? supabase.from("institutions").select("id, name, short_name").in("id", institutionIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length
      ? supabase.from("institution_services").select("id, name, category_key").in("id", serviceIds)
      : Promise.resolve({ data: [] }),
  ]);
  const ticketById = new Map((tickets ?? []).map((ticket) => [ticket.id, ticket]));
  const institutionById = new Map((institutions ?? []).map((institution) => [institution.id, institution]));
  const serviceById = new Map((services ?? []).map((service) => [service.id, service]));

  return (
    <main className="operations-page">
      <header className="operations-page-header">
        <div><p className="eyebrow">Human safety net</p><h1>Routing review</h1><p>Real cases flagged by confidence, missing service evidence, or institution transfer.</p></div>
        <AutoRefresh intervalSeconds={20} />
      </header>

      <section className="operations-note"><strong><AlertTriangle size={14} /> Confidence is not accuracy</strong><p>Approval and correction are stored separately from the model&apos;s self-estimate and become measured routing outcomes.</p></section>

      <section className="operations-panel">
        <header><div><h2>Cases awaiting review</h2><p>Oldest first, capped at 50 per operational view.</p></div><span>{decisions?.length ?? 0}</span></header>
        {(decisions ?? []).length === 0 ? (
          <EmptyState description="New low-confidence, ambiguous, or transferred cases will appear here." icon={<Route size={19} />} title="No routing reviews pending" />
        ) : (
          <div className="space-y-4 p-4">
            {(decisions ?? []).map((decision) => {
              const ticket = ticketById.get(decision.ticket_id);
              if (!ticket) return null;
              const report = relatedRecord(ticket.reports);
              const predictedInstitution = decision.predicted_institution_id ? institutionById.get(decision.predicted_institution_id) : null;
              const currentInstitution = institutionById.get(ticket.institution_id);
              const predictedService = decision.predicted_service_id ? serviceById.get(decision.predicted_service_id) : null;
              const evidence = decision.routing_evidence as Record<string, unknown> | null;
              return (
                <article className="rounded-[8px] border border-[#dde3ec] bg-white p-4" key={decision.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-[9px] font-bold uppercase text-[#748096]">{ticket.ticket_code}</span><h2 className="mt-1 text-[15px] font-bold">{titleCase(ticket.category || report?.detected_category, "Citizen service issue")}</h2><p className="mt-1 max-w-3xl text-[11px] leading-5 text-[#56637a]">{report?.ai_summary || report?.description}</p></div><div className="flex flex-wrap gap-2"><PriorityMarker priority={ticket.priority} /><SourceBadge source={report?.source} /><StatusBadge status={ticket.status} /></div></div>
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-[8px] bg-[#f5f7fb] p-3"><dt className="text-[8px] uppercase text-[#7d889a]">AI suggestion</dt><dd className="mt-1 text-[11px] font-bold">{predictedInstitution?.short_name || predictedInstitution?.name || "No clear institution"}</dd></div>
                    <div className="rounded-[8px] bg-[#f5f7fb] p-3"><dt className="text-[8px] uppercase text-[#7d889a]">Current route</dt><dd className="mt-1 text-[11px] font-bold">{currentInstitution?.short_name || currentInstitution?.name || "Unassigned"}</dd></div>
                    <div className="rounded-[8px] bg-[#f5f7fb] p-3"><dt className="text-[8px] uppercase text-[#7d889a]">Service</dt><dd className="mt-1 text-[11px] font-bold">{predictedService?.name || titleCase(ticket.category)}</dd></div>
                    <div className="rounded-[8px] bg-[#f5f7fb] p-3"><dt className="text-[8px] uppercase text-[#7d889a]">Confidence</dt><dd className="mt-1 text-[11px] font-bold">{decision.confidence == null ? "Not scored" : `${Math.round(Number(decision.confidence) * 100)}%`}</dd></div>
                  </dl>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_340px]"><div className="text-[10px] leading-5 text-[#5d697d]"><p><strong>Review signals:</strong> {decision.review_reasons?.length ? decision.review_reasons.map((reason: string) => titleCase(reason)).join(", ") : "Manual review"}</p><p><strong>Location:</strong> {report?.location_text || String(evidence?.location_text || "Not provided")}</p><p><strong>Engine:</strong> {decision.engine}{decision.model_name ? ` / ${decision.model_name}` : ""}</p><p><strong>Alternatives:</strong> {Array.isArray(decision.alternative_candidates) && decision.alternative_candidates.length ? JSON.stringify(decision.alternative_candidates) : "None recorded"}</p><Link className="mt-2 inline-flex items-center gap-1 font-bold text-[#2458a6]" href={`/admin/reports/${ticket.id}`}>Inspect or correct route <ArrowRight size={13} /></Link></div><AdminRoutingApproval decisionId={decision.id} /></div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
