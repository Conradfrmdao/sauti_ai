import { ArrowUpRight, BookOpenCheck, Boxes, FileCheck2 } from "lucide-react";

import { EmptyState, StatusBadge, titleCase } from "@/components/case-ui";
import { requireInstitutionWorkspace } from "@/lib/auth/workspace-session";

export default async function InstitutionKnowledgePage() {
  const { supabase, membership } = await requireInstitutionWorkspace();
  const [
    { data: documents, error: documentsError },
    { data: services, error: servicesError },
  ] = await Promise.all([
    supabase
      .from("knowledge_documents")
      .select("id, title, document_type, status, source_url, verified_at, updated_at")
      .eq("institution_id", membership.institution_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("institution_services")
      .select("id, name, description, category_key, required_fields, source_url, active, updated_at")
      .eq("institution_id", membership.institution_id)
      .order("name"),
  ]);
  if (documentsError || servicesError) {
    throw new Error("Routing knowledge could not be loaded. Please try again.");
  }

  return (
    <main className="operations-page">
      <header className="operations-page-header">
        <div><p className="eyebrow">Routing quality</p><h1>Routing knowledge</h1><p>Trace the official sources and service rules SAUTI1 uses for this institution.</p></div>
      </header>

      <section className="operations-metrics is-two">
        <div><span><FileCheck2 size={17} /></span><p>Verified documents</p><strong>{(documents ?? []).filter((item) => item.status === "verified").length}</strong></div>
        <div><span><Boxes size={17} /></span><p>Active service rules</p><strong>{(services ?? []).filter((item) => item.active).length}</strong></div>
      </section>

      <section className="operations-panel">
        <header><div><h2>Institution services</h2><p>Categories and required facts used during intake.</p></div></header>
        {(services ?? []).length === 0 ? (
          <EmptyState description="An institution administrator or SAUTI1 operator must configure services before routing can be specific." icon={<Boxes size={19} />} title="No service rules configured" />
        ) : (
          <div className="knowledge-list">
            {(services ?? []).map((service) => (
              <article key={service.id}>
                <div><span>{titleCase(service.category_key)}</span><h3>{service.name}</h3><p>{service.description}</p></div>
                <div><StatusBadge status={service.active ? "active" : "closed"} /><small>{service.required_fields?.length ?? 0} required field{service.required_fields?.length === 1 ? "" : "s"}</small>{service.source_url && <a href={service.source_url} rel="noreferrer" target="_blank">Official source <ArrowUpRight size={13} /></a>}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="operations-panel">
        <header><div><h2>Verified documents</h2><p>Every source remains traceable to its public authority.</p></div></header>
        {(documents ?? []).length === 0 ? (
          <EmptyState description="No verified institutional source has been added yet." icon={<BookOpenCheck size={19} />} title="No knowledge documents" />
        ) : (
          <div className="knowledge-list">
            {(documents ?? []).map((document) => (
              <article key={document.id}>
                <div><span>{titleCase(document.document_type)}</span><h3>{document.title}</h3><p>Last updated {new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(new Date(document.updated_at))}</p></div>
                <div><StatusBadge status={document.status} /><a href={document.source_url} rel="noreferrer" target="_blank">Open source <ArrowUpRight size={13} /></a></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
