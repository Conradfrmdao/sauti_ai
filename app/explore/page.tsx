import { Boxes } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/case-ui";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

export default async function ExplorePage() {
  const { supabase } = await requireCitizenWorkspace();
  const { data: services, error } = await supabase
    .from("institution_services")
    .select("id, name, description, category_key, institutions(name, short_name, sector)")
    .eq("active", true)
    .order("name");
  if (error) throw new Error("The service directory could not be loaded.");

  return (
    <AppShell>
      <div className="simple-page">
        <h1 className="page-title">Explore services</h1>
        <p className="page-subtitle">Examples of issues Sauti1 can identify without making you choose a department.</p>
        {(services ?? []).length === 0 ? (
          <EmptyState description="No active institution services are currently published." icon={<Boxes size={19} />} title="No services available" />
        ) : <div className="service-directory">
          {(services ?? []).map((service) => {
            const institution = Array.isArray(service.institutions) ? service.institutions[0] : service.institutions;
            return (
              <article key={service.id}>
                <span>{institution?.sector}</span>
                <h2>{service.name}</h2>
                <p>{service.description}</p>
                <strong>{institution?.short_name || institution?.name}</strong>
              </article>
            );
          })}
        </div>}
      </div>
    </AppShell>
  );
}
