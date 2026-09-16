"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

export function AutoRefresh({ intervalSeconds = 20 }: { intervalSeconds?: number }) {
  const router = useRouter();
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setLastUpdated(new Date());
    });
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [intervalSeconds, refresh]);

  return (
    <button className="refresh-control" disabled={pending} onClick={refresh} type="button">
      <RefreshCw aria-hidden="true" className={pending ? "is-spinning" : ""} size={14} />
      <span>{pending ? "Refreshing" : `Updated ${lastUpdated.toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}`}</span>
    </button>
  );
}
