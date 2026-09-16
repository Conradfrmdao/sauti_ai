import { Building2, Clock3, ExternalLink, Mail, MapPin, Phone, ShieldAlert, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/case-ui";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

export default async function InstitutionsPage() {
  const { supabase } = await requireCitizenWorkspace();
  const { data: institutions, error } = await supabase
    .from("institutions")
    .select(`
      id, name, short_name, slug, sector, description, onboarding_state,
      contact_email, contact_phone, emergency_phone, website_url,
      head_office_address, operating_hours, jurisdiction, information_verified_at,
      institution_services (id, name)
    `)
    .eq("status", "active")
    .eq("verified", true)
    .order("sector")
    .order("name");
  if (error) throw new Error("The institution directory could not be loaded.");

  function phoneHref(value: string) {
    const candidate = value.match(/(?:\+\d[\d\s]{7,}|0\d[\d\s]{7,})/)?.[0];
    return candidate ? `tel:${candidate.replace(/[^+\d]/g, "")}` : undefined;
  }

  return (
    <AppShell>
      <div className="simple-page">
        <h1 className="page-title">Institutions</h1>
        <p className="page-subtitle">
          Organizations Sauti1 can identify and route to from a natural conversation.
        </p>

        {(institutions ?? []).length === 0 ? (
          <EmptyState description="No verified active institution is currently published in the SAUTI1 catalogue." icon={<Building2 size={19} />} title="No institutions available" />
        ) : (
          <div className="institution-directory">
            {(institutions ?? []).map((institution) => (
              <article className="institution-directory-item" key={institution.id}>
                <div className="institution-directory-icon"><Building2 size={18} /></div>
                <div className="institution-directory-copy">
                  <div className="institution-directory-heading">
                    <h2>{institution.short_name || institution.name}</h2>
                    <span className={institution.onboarding_state === "onboarded" ? "onboarded" : ""}>
                      <ShieldCheck size={11} />
                      {institution.onboarding_state === "onboarded" ? "Onboarded" : "Catalogued"}
                    </span>
                  </div>
                  <div className="institution-sector">{institution.sector}</div>
                  <p>{institution.description}</p>
                  <div className="institution-services">
                    {(institution.institution_services ?? []).map((service) => (
                      <span key={service.id}>{service.name}</span>
                    ))}
                  </div>
                  <div className="institution-facts">
                    {institution.head_office_address && <span><MapPin size={13} />{institution.head_office_address}</span>}
                    {institution.operating_hours && <span><Clock3 size={13} />{institution.operating_hours}</span>}
                    {institution.jurisdiction && <span><Building2 size={13} />{institution.jurisdiction}</span>}
                    {institution.emergency_phone && <strong><ShieldAlert size={13} />Emergency / toll-free: {institution.emergency_phone}</strong>}
                  </div>
                  <div className="institution-contacts">
                    {institution.contact_phone && (phoneHref(institution.contact_phone) ? <a href={phoneHref(institution.contact_phone)}><Phone size={12} />{institution.contact_phone}</a> : <span><Phone size={12} />{institution.contact_phone}</span>)}
                    {institution.contact_email && <a href={`mailto:${institution.contact_email}`}><Mail size={12} />{institution.contact_email}</a>}
                    {institution.website_url && (
                      <a href={institution.website_url} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} /> Official website
                      </a>
                    )}
                    {institution.information_verified_at && (
                      <span><ShieldCheck size={12} />Checked {new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(new Date(institution.information_verified_at))}</span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
