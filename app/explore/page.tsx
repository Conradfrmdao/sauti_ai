import { AppShell } from "@/components/app-shell";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

export default async function ExplorePage() {
  const { supabase } = await requireCitizenWorkspace();
  const { data: services } = await supabase
    .from("institution_services")
    .select("id, name, description, category_key, institutions(name, short_name, sector)")
    .eq("active", true)
    .order("name");

  return (
    <AppShell>
      <div className="simple-page">
        <h1 className="page-title">Explore services</h1>
        <p className="page-subtitle">Examples of issues Sauti1 can identify without making you choose a department.</p>
        <div className="service-directory">
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
        </div>
      </div>
    </AppShell>
  );
}
