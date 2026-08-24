"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

export function SessionBoundary({
  children,
  initialUserId,
}: {
  children: ReactNode;
  initialUserId: string | null;
}) {
  const redirectingRef = useRef(false);
  const listeningRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    const listeningTimer = window.setTimeout(() => {
      listeningRef.current = true;
    }, 1000);

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase may replay SIGNED_IN while hydrating an old browser session.
      // The server-rendered identity remains authoritative during that replay.
      if (!listeningRef.current) return;
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;

      const currentUserId = session?.user.id ?? null;
      if (currentUserId === initialUserId || redirectingRef.current) return;

      redirectingRef.current = true;
      window.location.replace(currentUserId ? "/auth/route" : "/login");
    });

    return () => {
      window.clearTimeout(listeningTimer);
      authListener.subscription.unsubscribe();
    };
  }, [initialUserId]);

  return children;
}
