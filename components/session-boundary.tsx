"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

export function SessionBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const redirectingRef = useRef(false);
  const initializedRef = useRef(false);
  const knownUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUserId = session?.user.id ?? null;
      if (!initializedRef.current || event === "INITIAL_SESSION") {
        initializedRef.current = true;
        knownUserIdRef.current = currentUserId;
        return;
      }
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
      if (currentUserId === knownUserIdRef.current || redirectingRef.current) return;

      redirectingRef.current = true;
      window.location.replace(currentUserId ? "/auth/route" : "/");
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return children;
}
