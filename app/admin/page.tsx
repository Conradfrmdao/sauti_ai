import {
  Activity,
  Building2,
  FileText,
  Gauge,
  ShieldCheck,
  TicketCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { AccountMenu } from "@/components/account-menu";
import { getInitials } from "@/lib/identity";
import { createClient } from "@/lib/supabase/server";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [
    profileResult,
    institutionsResult,
    profilesResult,
    reportsResult,
    ticketsResult,
    recentResult,
    knowledgeResult,
    confidenceResult,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user?.id ?? "").maybeSingle(),
    supabase.from("institutions").select("id, name, short_name, sector, status, onboarding_state").order("name"),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("reports").select("id", { count: "exact", head: true }),
    supabase.from("tickets").select("id, status"),
    supabase
      .from("tickets")
      .select(`
        id, ticket_code, status, priority, created_at,
        institutions(name, short_name),
        reports(ai_summary, description, location_text)
      `)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("knowledge_documents").select("id", { count: "exact", head: true }).eq("status", "verified"),
    supabase.from("reports").select("ai_confidence").not("ai_confidence", "is", null).limit(500),
  ]);

  const adminName = profileResult.data?.full_name?.trim() || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "SAUTI1 Admin";
  const institutions = institutionsResult.data ?? [];
  const tickets = ticketsResult.data ?? [];
  const recentTickets = recentResult.data ?? [];
  const openTickets = tickets.filter((ticket) => !["resolved", "closed", "rejected"].includes(ticket.status)).length;
  const confidenceRows = confidenceResult.data ?? [];
  const averageConfidence = confidenceRows.length
    ? Math.round(confidenceRows.reduce((sum, row) => sum + Number(row.ai_confidence || 0), 0) / confidenceRows.length * 100)
    : 0;
  const lowConfidence = confidenceRows.filter((row) => Number(row.ai_confidence) < 0.6).length;
  const onboarded = institutions.filter((institution) => institution.onboarding_state === "onboarded").length;

  const metrics = [
    { label: "Institutions", value: institutions.length, icon: Building2 },
    { label: "Citizen profiles", value: profilesResult.count ?? 0, icon: Users },
    { label: "Reports", value: reportsResult.count ?? 0, icon: FileText },
    { label: "Open tickets", value: openTickets, icon: TicketCheck },
  ];

  return (
    <div className="min-h-dvh bg-[#f7f8fb] text-[#0b1633] lg:grid lg:h-dvh lg:grid-cols-[224px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="hidden border-r border-[#e6eaf1] bg-white lg:flex lg:flex-col">
        <div className="flex h-full flex-col px-3.5 pb-3 pt-4">
          <div className="px-2 text-[21px] font-[850]">SAUTI<span className="text-[#1d5eff]">1</span> <span className="text-[10px] text-[#67738b]">AI</span></div>
          <div className="mt-4 rounded-[8px] border border-[#e5e9f0] bg-[#fafbfc] p-2.5">
            <div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#0e1d3b] text-white"><ShieldCheck size={15} /></div><div><strong className="block text-[10px]">SAUTI1 Operations</strong><span className="text-[8px] text-[#7a8498]">Platform administration</span></div></div>
          </div>
          <nav className="mt-4 space-y-1">
            {[{ label: "Control center", href: "#overview" }, { label: "Reports", href: "#reports" }, { label: "AI operations", href: "#ai" }, { label: "Institutions", href: "#institutions" }].map((item, index) => (
              <Link href={item.href} key={item.href} className={`flex h-9 w-full items-center rounded-[8px] px-3 text-[10px] font-semibold ${index === 0 ? "bg-[#edf3ff] text-[#1d5eff]" : "text-[#435068] hover:bg-[#f5f7fa]"}`}>{item.label}</Link>
            ))}
          </nav>
          <AccountMenu name={adminName} role="Platform administrator" initials={getInitials(adminName)} />
        </div>
      </aside>

      <main className="min-w-0 lg:h-dvh lg:overflow-y-auto">
        <div id="overview" className="mx-auto max-w-[1280px] scroll-mt-4 p-4 lg:p-6">
          <div className="mb-4 flex items-center justify-between border-b border-[#e8ebf1] bg-white px-3 py-2 lg:hidden">
            <strong>SAUTI<span className="text-[#1d5eff]">1</span> <span className="text-[9px] text-[#68758a]">ADMIN</span></strong>
            <form action="/auth/signout" method="post"><button className="rounded-[7px] border border-[#dfe5ee] px-3 py-2 text-[9px] font-bold" type="submit">Log out</button></form>
          </div>
          <header className="flex items-start justify-between gap-4">
            <div><h1 className="text-[25px] font-[800] tracking-[-0.8px]">Control center</h1><p className="mt-1 text-[10px] text-[#7d8799]">Live platform, routing and institution readiness.</p></div>
            <div className="flex items-center gap-2 rounded-[8px] border border-[#dfe5ee] bg-white px-3 py-2 text-[9px] text-[#59667b]"><span className="h-2 w-2 rounded-full bg-[#20a66a]" /> Operational</div>
          </header>

          <section className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {metrics.map(({ label: metricLabel, value, icon: Icon }) => (
              <article key={metricLabel} className="flex items-center justify-between rounded-[8px] border border-[#e3e7ee] bg-white px-4 py-3">
                <div><span className="text-[9px] text-[#7e889b]">{metricLabel}</span><strong className="mt-1 block text-[24px]">{value}</strong></div><Icon size={18} className="text-[#4771d8]" />
              </article>
            ))}
          </section>

          <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div id="reports" className="scroll-mt-4 overflow-hidden rounded-[8px] border border-[#e3e7ee] bg-white">
              <div className="flex items-center justify-between border-b border-[#edf0f4] px-4 py-3"><div><h2 className="text-[12px] font-bold">Recent routing activity</h2><p className="text-[8px] text-[#8992a3]">Newest tickets across authorized institutions</p></div><Activity size={15} className="text-[#6076aa]" /></div>
              {recentTickets.length === 0 ? <div className="p-8 text-center text-[10px] text-[#7e899b]">No tickets have been routed yet.</div> : recentTickets.map((ticket) => {
                const institution = Array.isArray(ticket.institutions) ? ticket.institutions[0] : ticket.institutions;
                const report = Array.isArray(ticket.reports) ? ticket.reports[0] : ticket.reports;
                return (
                  <article className="flex items-start gap-3 border-b border-[#edf0f4] px-4 py-3 last:border-0" key={ticket.id}>
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#4a75df]" />
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2 text-[9px]"><strong className="text-[#1d5eff]">{ticket.ticket_code}</strong><span>{institution?.short_name || institution?.name}</span><span className="text-[#8a94a5]">{label(ticket.status)}</span></div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#617087]">{report?.ai_summary || report?.description}</p>{report?.location_text && <span className="mt-1 block text-[8px] text-[#8b95a6]">{report.location_text}</span>}</div>
                  </article>
                );
              })}
            </div>

            <div className="space-y-3">
              <article id="ai" className="scroll-mt-4 rounded-[8px] border border-[#e3e7ee] bg-white p-4">
                <div className="flex items-center justify-between"><h2 className="text-[12px] font-bold">AI routing quality</h2><Gauge size={16} className="text-[#6076aa]" /></div>
                <div className="mt-4 flex items-end justify-between"><div><strong className="text-[28px]">{averageConfidence}%</strong><span className="ml-2 text-[9px] text-[#7c8799]">average confidence</span></div></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf0f5]"><div className="h-full rounded-full bg-[#1d5eff]" style={{ width: `${averageConfidence}%` }} /></div>
                <p className="mt-3 text-[9px] text-[#7c8799]">{lowConfidence} report{lowConfidence === 1 ? "" : "s"} below the 60% review threshold.</p>
              </article>

              <article className="rounded-[8px] border border-[#e3e7ee] bg-white p-4">
                <h2 className="text-[12px] font-bold">Institution readiness</h2>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="bg-[#f5f7fa] p-2"><strong className="block text-[17px]">{onboarded}</strong><span className="text-[8px] text-[#7c8799]">Onboarded</span></div><div className="bg-[#f5f7fa] p-2"><strong className="block text-[17px]">{institutions.length - onboarded}</strong><span className="text-[8px] text-[#7c8799]">Catalogued</span></div><div className="bg-[#f5f7fa] p-2"><strong className="block text-[17px]">{knowledgeResult.count ?? 0}</strong><span className="text-[8px] text-[#7c8799]">Knowledge</span></div></div>
              </article>
            </div>
          </section>

          <section id="institutions" className="mt-3 scroll-mt-4 overflow-hidden rounded-[8px] border border-[#e3e7ee] bg-white">
            <div className="border-b border-[#edf0f4] px-4 py-3"><h2 className="text-[12px] font-bold">Institution catalogue</h2></div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3">
              {institutions.map((institution) => (
                <div className="border-b border-r border-[#edf0f4] p-3" key={institution.id}><strong className="block text-[10px]">{institution.short_name || institution.name}</strong><span className="mt-1 block text-[8px] text-[#7c8799]">{institution.sector} · {label(institution.onboarding_state)}</span></div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
