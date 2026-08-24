import { Bell, CheckCircle2, FileClock } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

export default async function NotificationsPage() {
  const { supabase, user } = await requireCitizenWorkspace();
  await supabase
    .from("reports")
    .update({ attention_read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("source", "text")
    .in("status", ["draft", "pending_confirmation"])
    .is("attention_read_at", null);

  const [{ data: ownedTickets }, { data: drafts }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, reports!inner(user_id)")
      .eq("reports.user_id", user.id),
    supabase
      .from("reports")
      .select("id, ai_summary, description, detected_category, updated_at")
      .eq("user_id", user.id)
      .eq("source", "text")
      .in("status", ["draft", "pending_confirmation"])
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);
  const ownedTicketIds = (ownedTickets ?? []).map((ticket) => ticket.id);
  const { data: events } = await supabase
    .from("ticket_events")
    .select(`
      id, event_type, note, created_at,
      tickets (id, ticket_code, institutions(name, short_name))
    `)
    .in("ticket_id", ownedTicketIds.length ? ownedTicketIds : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <AppShell>
      <div className="simple-page">
        <h1 className="page-title">Notifications</h1>
        <p className="page-subtitle">Drafts needing attention and updates from institutions handling your reports.</p>
        <div className="notification-list">
          {(drafts ?? []).map((draft) => (
            <Link className="notification-attention" href={`/chat?resume=${draft.id}`} key={`draft-${draft.id}`}>
              <div className="notification-icon"><FileClock size={16} /></div>
              <div>
                <strong>Draft report needs your attention</strong>
                <p>{draft.ai_summary || draft.description || draft.detected_category || "Continue your report with Sauti1."}</p>
                <span>Continue draft</span>
              </div>
            </Link>
          ))}

          {(events ?? []).map((event) => {
            const ticket = Array.isArray(event.tickets) ? event.tickets[0] : event.tickets;
            const institution = ticket
              ? Array.isArray(ticket.institutions) ? ticket.institutions[0] : ticket.institutions
              : undefined;
            return (
              <Link href={ticket ? `/track/${ticket.id}` : "/track"} key={event.id}>
                <div className="notification-icon">
                  {event.event_type === "acknowledged" ? <CheckCircle2 size={16} /> : <Bell size={16} />}
                </div>
                <div><strong>{ticket?.ticket_code} - {institution?.short_name || institution?.name}</strong><p>{event.note}</p></div>
              </Link>
            );
          })}
          {(drafts ?? []).length === 0 && (events ?? []).length === 0 && (
            <div className="preview-empty">Nothing needs your attention right now.</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
