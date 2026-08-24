import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Clock3,
  MapPin,
  Search,
  TicketCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type TicketListRow = {
  id: string;
  ticket_code: string;
  status: string;
  priority: string;
  category: string | null;
  created_at: string;
  reports: {
    user_id: string;
    description: string;
    ai_summary: string | null;
    source: string;
    location_text: string | null;
  } | {
    user_id: string;
    description: string;
    ai_summary: string | null;
    source: string;
    location_text: string | null;
  }[] | null;
};

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function InstitutionTicketsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("institution_members")
    .select("institution_id, institutions(name, short_name)")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/auth/route");

  const { data: rows, error } = await supabase
    .from("tickets")
    .select(`
      id, ticket_code, status, priority, category, created_at,
      reports(user_id, description, ai_summary, source, location_text)
    `)
    .eq("institution_id", membership.institution_id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const tickets = (rows ?? []) as TicketListRow[];
  const citizenIds = [...new Set(tickets.map((ticket) => relatedRecord(ticket.reports)?.user_id).filter(Boolean))] as string[];
  const { data: profiles } = citizenIds.length
    ? await supabase.from("profiles").select("id, full_name, phone").in("id", citizenIds)
    : { data: [] };
  const citizenById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const institution = relatedRecord(membership.institutions);
  const institutionName = institution?.short_name || institution?.name || "Institution";

  return (
    <main className="min-h-dvh bg-[#f7f8fb] text-[#0b1633]">
      <header className="sticky top-0 z-10 border-b border-[#e2e7ef] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link aria-label="Back to institution overview" className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-[#dfe5ed] hover:bg-[#f5f7fa]" href="/institution"><ArrowLeft size={17} /></Link>
            <div className="min-w-0">
              <h1 className="truncate text-[17px] font-bold">Ticket workspace</h1>
              <p className="truncate text-[10px] text-[#788499]">{institutionName}</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-[10px] font-semibold text-[#667288] sm:flex"><Building2 size={14} /> Institution queue</div>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-4 py-5 sm:px-6 sm:py-7">
        <section className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[24px] font-bold">All tickets</h2>
            <p className="mt-1 text-[12px] text-[#748095]">Open any ticket to see the citizen, evidence, transcript and complete history.</p>
          </div>
          <div className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#dfe4ec] bg-white px-3 text-[11px] text-[#6f7b8f]"><Search size={14} /> {tickets.length} ticket{tickets.length === 1 ? "" : "s"}</div>
        </section>

        <section className="overflow-hidden rounded-[8px] border border-[#e0e5ed] bg-white">
          {tickets.length === 0 ? (
            <div className="grid min-h-72 place-items-center px-5 text-center">
              <div><TicketCheck className="mx-auto text-[#9aa6b9]" size={28} /><h3 className="mt-3 text-sm font-bold">No tickets routed here yet</h3><p className="mt-1 text-[11px] text-[#7d899d]">New citizen reports will appear automatically.</p></div>
            </div>
          ) : tickets.map((ticket) => {
            const report = relatedRecord(ticket.reports);
            const citizen = report ? citizenById.get(report.user_id) : undefined;
            return (
              <Link className="group grid gap-3 border-b border-[#edf0f4] px-4 py-4 last:border-0 hover:bg-[#f8faff] sm:grid-cols-[minmax(0,1fr)_180px_34px] sm:items-center" href={`/institution/tickets/${ticket.id}`} key={ticket.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-[#1d5eff]">{ticket.ticket_code}</span>
                    <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 text-[9px] font-bold text-[#526078]">{label(ticket.status)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${["high", "critical"].includes(ticket.priority) ? "bg-[#fff1ea] text-[#a54c1f]" : "bg-[#edf8f3] text-[#087a50]"}`}>{label(ticket.priority)}</span>
                  </div>
                  <h3 className="mt-1.5 truncate text-[13px] font-bold">{label(ticket.category || "citizen_service_issue")}</h3>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[#69758a]">{report?.ai_summary || report?.description}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[#8490a3]">
                    <span className="inline-flex items-center gap-1"><UserRound size={11} /> {citizen?.full_name || "Citizen"}</span>
                    {report?.location_text && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {report.location_text}</span>}
                  </div>
                </div>
                <div className="text-[10px] text-[#7c889b]"><span className="inline-flex items-center gap-1"><Clock3 size={12} /> {dateLabel(ticket.created_at)}</span><p className="mt-1">{report?.source === "voice" ? "Voice Sauti1" : "Text Sauti1"}</p></div>
                <span className="grid h-8 w-8 place-items-center rounded-[8px] text-[#65728a] group-hover:bg-[#eaf1ff] group-hover:text-[#1d5eff]"><ArrowUpRight size={16} /></span>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
