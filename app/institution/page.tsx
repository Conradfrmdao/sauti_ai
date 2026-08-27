import {
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountMenu } from "@/components/account-menu";
import { getInitials } from "@/lib/identity";
import { reportSourceLabel } from "@/lib/sauti1/source-label";
import { createClient } from "@/lib/supabase/server";

type TicketRecord = {
  id: string;
  ticket_code: string;
  status: string;
  priority: string;
  category: string | null;
  created_at: string;
  acknowledged_at: string | null;
  reports: {
    description: string;
    ai_summary: string | null;
    source: string;
    location_text: string | null;
    report_attachments: {
      id: string;
      storage_path: string;
      original_name: string | null;
      mime_type: string | null;
    }[] | null;
  } | {
    description: string;
    ai_summary: string | null;
    source: string;
    location_text: string | null;
    report_attachments: {
      id: string;
      storage_path: string;
      original_name: string | null;
      mime_type: string | null;
    }[] | null;
  }[] | null;
};

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function relatedRecord<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

async function acknowledgeTicket(formData: FormData) {
  "use server";

  const ticketId = formData.get("ticketId");
  if (typeof ticketId !== "string" || !ticketId) return;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: ticket }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("tickets")
      .select("id, institutions(name, short_name)")
      .eq("id", ticketId)
      .maybeSingle(),
  ]);

  if (!ticket) throw new Error("Ticket not found or not available to this institution.");
  const institution = relatedRecord(ticket.institutions);
  const staffName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Institution staff";
  const institutionName = institution?.short_name || institution?.name || "the institution";
  const { error } = await supabase.rpc("acknowledge_ticket", {
    target_ticket_id: ticketId,
    acknowledgement_note: `${staffName} acknowledged this ticket for ${institutionName}.`,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/institution");
  revalidatePath("/reports");
  revalidatePath("/chat");
}

export default async function InstitutionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("institution_members")
      .select(`
        institution_id, role, department,
        institutions (id, name, short_name, slug, sector, onboarding_state)
      `)
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!membership) redirect("/auth/route");
  const institution = relatedRecord(membership.institutions);
  if (!institution) redirect("/auth/route");

  const [{ data: ticketRows, error: ticketError }, { count: knowledgeCount }] = await Promise.all([
    supabase
      .from("tickets")
      .select(`
        id, ticket_code, status, priority, category, created_at, acknowledged_at,
        reports (
          description, ai_summary, source, location_text,
          report_attachments (id, storage_path, original_name, mime_type)
        )
      `)
      .eq("institution_id", membership.institution_id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("knowledge_documents")
      .select("id", { count: "exact", head: true })
      .eq("institution_id", membership.institution_id)
      .eq("status", "verified"),
  ]);

  if (ticketError) throw new Error(ticketError.message);
  const tickets = (ticketRows ?? []) as TicketRecord[];
  const evidencePaths = tickets.flatMap((ticket) => relatedRecord(ticket.reports)?.report_attachments ?? []);
  const evidenceUrls = new Map(
    (await Promise.all(evidencePaths.map(async (attachment) => {
      const { data } = await supabase.storage
        .from("report-attachments")
        .createSignedUrl(attachment.storage_path, 3600);
      return data?.signedUrl ? [attachment.storage_path, data.signedUrl] as const : null;
    }))).filter((entry): entry is readonly [string, string] => Boolean(entry))
  );
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const openTickets = tickets.filter((ticket) => !["resolved", "closed", "rejected"].includes(ticket.status));
  const newToday = tickets.filter((ticket) => new Date(ticket.created_at).getTime() >= todayStart).length;
  const highPriority = openTickets.filter((ticket) => ["high", "critical"].includes(ticket.priority)).length;
  const acknowledged = tickets.filter((ticket) => ticket.status === "acknowledged").length;
  const categoryCounts = new Map<string, number>();
  tickets.forEach((ticket) => {
    const key = ticket.category || "citizen_service_issue";
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  });
  const emergingCategory = [...categoryCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((left, right) => right[1] - left[1])[0];
  const staffName = profile?.full_name?.trim() || user.user_metadata?.full_name || user.email?.split("@")[0] || "Institution staff";
  const institutionName = institution.short_name || institution.name;

  const navigation = [
    { label: "Overview", icon: LayoutDashboard, count: null, href: "#overview" },
    { label: "Tickets", icon: TicketCheck, count: tickets.length, href: "/institution/tickets" },
    { label: "Knowledge base", icon: BookOpen, count: knowledgeCount ?? 0, href: "#knowledge" },
  ];
  const metrics = [
    { label: "Open tickets", value: openTickets.length, icon: TicketCheck },
    { label: "New today", value: newToday, icon: Clock3 },
    { label: "High priority", value: highPriority, icon: AlertTriangle },
    { label: "Acknowledged", value: acknowledged, icon: CheckCircle2 },
  ];

  return (
    <div id="overview" className="min-h-dvh bg-[#f7f8fb] text-[#0b1633]">
      <div className="min-h-dvh lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="hidden h-dvh border-r border-[#e6eaf1] bg-white lg:sticky lg:top-0 lg:flex lg:flex-col">
          <div className="flex h-full min-h-0 flex-col px-3.5 pb-3 pt-4">
            <div className="flex items-center gap-1 px-2 text-[21px] font-[850]">
              SAUTI<span className="text-[#1d5eff]">1</span><span className="ml-0.5 text-[10px] text-[#67738b]">AI</span>
            </div>

            <div className="mt-4 rounded-[8px] border border-[#e5e9f0] bg-[#fafbfc] px-2.5 py-2">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#eaf1ff] text-[#1d5eff]">
                  <Building2 size={15} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-bold">{institutionName}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[8px] text-[#6f7c91]">
                    <ShieldCheck size={9} className="text-[#168b5d]" />
                    {statusLabel(institution.onboarding_state)} workspace
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-1 mt-4 px-2 text-[8px] font-bold uppercase text-[#98a1b1]">Workspace</div>
            <nav className="space-y-px">
              {navigation.map(({ label, icon: Icon, count, href }, index) => (
                <Link
                  key={label}
                  href={href}
                  className={`flex h-[32px] w-full items-center gap-2 rounded-[8px] px-2 text-left text-[11px] font-medium ${index === 0 ? "bg-[#edf3ff] text-[#1d5eff]" : "text-[#38445a] hover:bg-[#f5f7fa]"}`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                  {count !== null && <span className="ml-auto text-[9px] font-bold">{count}</span>}
                </Link>
              ))}
            </nav>

            <AccountMenu
              name={staffName}
              role={statusLabel(membership.role)}
              initials={getInitials(staffName)}
            />
          </div>
        </aside>

        <main className="min-w-0 lg:min-h-dvh lg:overflow-y-auto">
          <div className="flex h-[60px] items-center justify-between border-b border-[#e8ebf1] bg-white px-4 lg:hidden">
            <Link href="/institution/tickets" className="grid h-9 w-9 place-items-center rounded-full bg-[#f4f6f9]" aria-label="Open ticket workspace">
              <TicketCheck size={18} />
            </Link>
            <div className="font-[850]">SAUTI<span className="text-[#1d5eff]">1</span> <span className="text-[10px] text-[#6d778a]">AI</span></div>
            <form action="/auth/signout" method="post">
              <button className="grid h-9 w-9 place-items-center rounded-full bg-[#102652] text-white" aria-label="Log out" title="Log out" type="submit"><LogOut size={15} /></button>
            </form>
          </div>

          <div className="flex min-h-[calc(100dvh-60px)] flex-col gap-3 overflow-y-auto p-4 lg:min-h-dvh lg:overflow-visible lg:p-5">
            <header className="flex shrink-0 items-start justify-between gap-4">
              <div>
                <h1 className="text-[24px] font-[780] tracking-[-0.8px]">Institution overview</h1>
                <p className="mt-1 text-[11px] text-[#7b8598]">{institutionName} - {institution.sector}</p>
              </div>
              <div className="hidden items-center gap-2 rounded-[8px] border border-[#dfe5ee] bg-white px-3 py-2 text-[10px] text-[#546176] sm:flex">
                <span className="h-2 w-2 rounded-full bg-[#20a66a]" /> Live ticket queue
              </div>
            </header>

            <section className="grid shrink-0 grid-cols-2 gap-2.5 xl:grid-cols-4">
              {metrics.map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex items-center justify-between rounded-[8px] border border-[#e3e7ee] bg-white px-4 py-3">
                  <div><div className="text-[9px] text-[#7e889b]">{label}</div><div className="mt-1 text-[24px] font-[780]">{value}</div></div>
                  <Icon size={18} className="text-[#4771d8]" />
                </div>
              ))}
            </section>

            <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div id="tickets" className="flex min-h-[360px] scroll-mt-4 flex-col overflow-hidden rounded-[8px] border border-[#e3e7ee] bg-white">
                <div className="flex shrink-0 items-center justify-between border-b border-[#edf0f4] px-4 py-3">
                  <div><h2 className="text-[13px] font-bold">Needs attention</h2><p className="mt-0.5 text-[9px] text-[#8992a3]">Newest routed tickets first</p></div>
                  <span className="rounded-full bg-[#eef3ff] px-2 py-1 text-[9px] font-bold text-[#1d5eff]">{openTickets.length} open</span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {tickets.length === 0 ? (
                    <div className="grid h-full min-h-[260px] place-items-center px-6 text-center">
                      <div><TicketCheck className="mx-auto text-[#aab3c3]" size={24} /><h3 className="mt-3 text-[12px] font-bold">No tickets yet</h3><p className="mt-1 text-[10px] text-[#7f899b]">Citizen reports routed to {institutionName} will appear here.</p></div>
                    </div>
                  ) : tickets.map((ticket) => {
                    const report = relatedRecord(ticket.reports);
                    const canAcknowledge = ["submitted", "routed"].includes(ticket.status);
                    return (
                      <article key={ticket.id} className="border-b border-[#edf0f4] px-4 py-3 last:border-0">
                        <div className="flex items-start gap-3">
                          <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${ticket.priority === "critical" ? "bg-[#d94b45]" : ticket.priority === "high" ? "bg-[#e78143]" : "bg-[#4a75df]"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-bold text-[#1d5eff]">{ticket.ticket_code}</span>
                              <span className="rounded-full bg-[#f2f4f8] px-1.5 py-0.5 text-[8px] font-semibold text-[#5d687b]">{statusLabel(ticket.status)}</span>
                              <span className="text-[8px] text-[#9aa2b1]">{timeLabel(ticket.created_at)}</span>
                            </div>
                            <h3 className="mt-1 text-[12px] font-bold">{statusLabel(ticket.category || "citizen_service_issue")}</h3>
                            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#687388]">{report?.ai_summary || report?.description}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[8px] text-[#8490a2]">
                              <span>{statusLabel(ticket.priority)} priority</span><span>-</span><span>{reportSourceLabel(report?.source)}</span>
                              {report?.location_text && <><span>-</span><span>{report.location_text}</span></>}
                            </div>
                            <Link className="mt-2 inline-flex items-center text-[9px] font-bold text-[#1d5eff] hover:underline" href={`/institution/tickets/${ticket.id}`}>
                              View full ticket details
                            </Link>
                            {(report?.report_attachments?.length ?? 0) > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {report?.report_attachments?.map((attachment) => {
                                  const url = evidenceUrls.get(attachment.storage_path);
                                  return url ? (
                                    <a
                                      className="inline-flex max-w-[190px] items-center gap-1 rounded-[6px] border border-[#dfe5ee] bg-[#f8fafc] px-2 py-1 text-[8px] font-semibold text-[#3f567e] hover:bg-[#eef3fb]"
                                      href={url}
                                      key={attachment.id}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      <FileText size={11} />
                                      <span className="truncate">{attachment.original_name || "Report evidence"}</span>
                                    </a>
                                  ) : null;
                                })}
                              </div>
                            )}
                          </div>
                          {canAcknowledge && (
                            <form action={acknowledgeTicket}>
                              <input type="hidden" name="ticketId" value={ticket.id} />
                              <button type="submit" className="rounded-[8px] bg-[#155dff] px-3 py-2 text-[9px] font-bold text-white hover:bg-[#0f52eb]">Acknowledge</button>
                            </form>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <section id="knowledge" className="scroll-mt-4 rounded-[8px] border border-[#e3e7ee] bg-white p-4">
                  <div className="flex items-center justify-between"><h2 className="text-[12px] font-bold">Knowledge readiness</h2><BookOpen size={15} className="text-[#5472b4]" /></div>
                  <div className="mt-4 text-[28px] font-[780]">{knowledgeCount ?? 0}</div>
                  <p className="mt-1 text-[9px] leading-4 text-[#7e899b]">Verified documents available to Sauti1 for {institutionName}.</p>
                </section>

                <section className="rounded-[8px] border border-[#e3e7ee] bg-white p-4">
                  <div className="flex items-center justify-between"><h2 className="text-[12px] font-bold">Pattern watch</h2><AlertTriangle size={15} className="text-[#c5743c]" /></div>
                  {emergingCategory ? (
                    <><div className="mt-3 text-[12px] font-bold">{statusLabel(emergingCategory[0])}</div><p className="mt-1 text-[9px] leading-4 text-[#7e899b]">{emergingCategory[1]} related tickets are visible in the current queue.</p></>
                  ) : (
                    <p className="mt-3 text-[9px] leading-4 text-[#7e899b]">No category has reached the three-ticket pattern threshold.</p>
                  )}
                </section>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
