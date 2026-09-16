import { ArrowUpRight, Building2, Search, ShieldCheck } from "lucide-react";

import { EmptyState, StatusBadge, titleCase } from "@/components/case-ui";
import { InstitutionStateForm } from "@/components/institution-state-form";
import { requireAdminWorkspace } from "@/lib/auth/workspace-session";

const statuses = new Set(["all", "pending", "active", "suspended"]);

export default async function AdminInstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdminWorkspace();
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const safeQ = q.replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
  const status = typeof params.status === "string" && statuses.has(params.status) ? params.status : "all";

  let query = supabase.from("institutions").select(`
    id, name, short_name, sector, status, onboarding_state, verified,
    contact_email, contact_phone, website_url, source_url, updated_at
  `, { count: "exact" });
  if (status !== "all") query = query.eq("status", status);
  if (safeQ) query = query.or(`name.ilike.%${safeQ}%,short_name.ilike.%${safeQ}%,sector.ilike.%${safeQ}%`);
  const { data: institutions, count, error } = await query.order("name").limit(100);
  if (error) throw new Error("The institution catalogue could not be loaded.");

  return (
    <main className="operations-page">
      <header className="operations-page-header"><div><p className="eyebrow">Network governance</p><h1>Institutions</h1><p>Control verification, onboarding and operational access with an immutable admin audit entry.</p></div></header>

      <form className="operations-filters institution-filters" method="get">
        <label className="operations-search"><Search size={17} /><span className="sr-only">Search institutions</span><input defaultValue={q} name="q" placeholder="Search name or sector" /></label>
        <label><span>Status</span><select defaultValue={status} name="status"><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select></label>
        <button type="submit">Apply filters</button>
      </form>

      <section className="operations-panel">
        <header><div><h2>Catalogue</h2><p>{count ?? 0} matching institution{count === 1 ? "" : "s"}</p></div></header>
        {(institutions ?? []).length === 0 ? (
          <EmptyState description="Change the filters or provision a verified institution record." icon={<Building2 size={19} />} title="No matching institutions" />
        ) : (
          <div className="institution-admin-list">
            {(institutions ?? []).map((institution) => (
              <article key={institution.id}>
                <div className="institution-admin-copy">
                  <span className="panel-icon"><Building2 size={18} /></span>
                  <div><p>{institution.short_name || institution.name}</p><h2>{institution.name}</h2><span>{institution.sector}</span></div>
                  <div className="institution-admin-badges"><StatusBadge status={institution.status} /><span className="source-badge"><ShieldCheck size={13} /> {institution.verified ? "Verified" : "Unverified"}</span><span className="source-badge">{titleCase(institution.onboarding_state)}</span></div>
                  <dl><div><dt>Phone</dt><dd>{institution.contact_phone || "Not provided"}</dd></div><div><dt>Email</dt><dd>{institution.contact_email || "Not provided"}</dd></div><div><dt>Updated</dt><dd>{new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(new Date(institution.updated_at))}</dd></div></dl>
                  <div className="institution-source-links">{institution.website_url && <a href={institution.website_url} rel="noreferrer" target="_blank">Official website <ArrowUpRight size={13} /></a>}{institution.source_url && <a href={institution.source_url} rel="noreferrer" target="_blank">Verification source <ArrowUpRight size={13} /></a>}</div>
                </div>
                <InstitutionStateForm institution={institution} />
              </article>
            ))}
          </div>
        )}
        {(count ?? 0) > 100 && <p className="result-limit-note admin-limit">Showing the first 100 matching institutions. Narrow the search to locate another record.</p>}
      </section>
    </main>
  );
}
