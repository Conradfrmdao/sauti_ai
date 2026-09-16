import { AlertTriangle, ArrowRight, MessageSquareText, PhoneCall, RadioTower, UsersRound } from "lucide-react";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { requireAdminWorkspace } from "@/lib/auth/workspace-session";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminChannelsPage() {
  const { supabase } = await requireAdminWorkspace();
  const trustedSupabase = createAdminClient();
  const [
    { count: phoneReports, error: phoneError },
    { count: smsReports, error: smsError },
    { count: contacts, error: contactError },
    { count: failures, error: failureError },
    { data: events, error: eventsError },
  ] = await Promise.all([
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("source", "phone")
      .not("status", "in", "(draft,pending_confirmation)"),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("source", "sms")
      .not("status", "in", "(draft,pending_confirmation)"),
    trustedSupabase.from("external_channel_contacts").select("id", { count: "exact", head: true }),
    trustedSupabase.from("provider_webhook_events").select("id", { count: "exact", head: true }).eq("outcome", "failed"),
    trustedSupabase.from("provider_webhook_events")
      .select("id, provider, event_type, outcome, processed_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (phoneError || smsError || contactError || failureError || eventsError) {
    throw new Error("Channel operations could not be loaded.");
  }

  return (
    <main className="operations-page">
      <header className="operations-page-header"><div><p className="eyebrow">Low-tech access</p><h1>Channel operations</h1><p>Sanitized Phone and SMS intake visibility. Phone numbers, payloads and provider secrets are never shown here.</p></div><AutoRefresh intervalSeconds={20} /></header>

      <section className="operations-metrics">
        <div><span><PhoneCall size={17} /></span><p>Phone tickets</p><strong>{phoneReports ?? 0}</strong></div>
        <div><span><MessageSquareText size={17} /></span><p>SMS tickets</p><strong>{smsReports ?? 0}</strong></div>
        <div><span><UsersRound size={17} /></span><p>Channel contacts</p><strong>{contacts ?? 0}</strong></div>
        <div><span className={(failures ?? 0) > 0 ? "is-danger" : "is-success"}><AlertTriangle size={17} /></span><p>Failed events</p><strong>{failures ?? 0}</strong></div>
      </section>

      <div className="channel-shortcuts"><Link href={{ pathname: "/admin/reports", query: { source: "phone", status: "all" } }}><PhoneCall size={17} /><span><strong>Review Phone cases</strong><small>Open the filtered platform queue</small></span><ArrowRight size={16} /></Link><Link href={{ pathname: "/admin/reports", query: { source: "sms", status: "all" } }}><MessageSquareText size={17} /><span><strong>Review SMS cases</strong><small>Open the filtered platform queue</small></span><ArrowRight size={16} /></Link></div>

      <section className="operations-panel">
        <header><div><h2>Recent provider events</h2><p>Newest 100 idempotency records; raw payloads and external identifiers are omitted.</p></div><RadioTower size={17} /></header>
        {(events ?? []).length === 0 ? (
          <EmptyState description="Provider callbacks will create sanitized event records here." icon={<RadioTower size={19} />} title="No provider events" />
        ) : (
          <div className="provider-event-list">
            {(events ?? []).map((event) => (
              <article key={event.id}>
                <SourceBadge source={event.provider === "twilio" ? "phone" : "sms"} />
                <div><strong>{titleCase(event.event_type)}</strong><span>{event.provider === "twilio" ? "Phone adapter" : "SMS adapter"}</span></div>
                <StatusBadge status={event.outcome === "processed" ? "closed" : event.outcome === "failed" ? "cancelled" : event.outcome} />
                <time>{new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.updated_at))}</time>
              </article>
            ))}
          </div>
        )}
      </section>

      {(failures ?? 0) > 0 && <section className="operations-note"><strong><AlertTriangle size={14} /> Operator attention required</strong><p>This schema records failed provider events but does not yet include a durable retry outbox. Investigate the adapter/provider logs and use provider replay; do not mark failures healthy.</p></section>}
    </main>
  );
}
