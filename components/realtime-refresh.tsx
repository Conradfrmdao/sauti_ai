"use client";

import { Radio, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createClient } from "@/lib/supabase/client";

type RealtimeRefreshProps = {
  ticketId?: string;
  institutionId?: string;
  userId?: string;
  admin?: boolean;
  fallbackSeconds?: number;
};

export function RealtimeRefresh({
  ticketId,
  institutionId,
  userId,
  admin = false,
  fallbackSeconds = 60,
}: RealtimeRefreshProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const refreshTimer = useRef<number | undefined>(undefined);
  const [live, setLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      startTransition(() => {
        router.refresh();
        setLastUpdated(new Date());
      });
    }, 250);
  }, [router]);

  useEffect(() => {
    const scope = ticketId || institutionId || userId || (admin ? "admin" : "workspace");
    let channel = supabase.channel(`sauti1-lifecycle:${scope}`);

    if (ticketId) {
      channel = channel
        .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `id=eq.${ticketId}` }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "ticket_events", filter: `ticket_id=eq.${ticketId}` }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "ticket_comments", filter: `ticket_id=eq.${ticketId}` }, refresh);
    } else if (institutionId) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `institution_id=eq.${institutionId}` }, refresh);
    } else if (userId) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "reports", filter: `user_id=eq.${userId}` }, refresh);
    } else if (admin) {
      channel = channel
        .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "routing_decisions" }, refresh);
    }

    channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [admin, institutionId, refresh, supabase, ticketId, userId]);

  useEffect(() => {
    const timer = window.setInterval(() => refresh(), fallbackSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [fallbackSeconds, refresh]);

  return (
    <button className="refresh-control" disabled={pending} onClick={refresh} type="button">
      {live ? <Radio aria-hidden="true" size={14} /> : <RefreshCw aria-hidden="true" className={pending ? "is-spinning" : ""} size={14} />}
      <span>{pending ? "Refreshing" : live ? "Live updates" : `Fallback ${lastUpdated.toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}`}</span>
    </button>
  );
}
