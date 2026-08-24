import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({
  children,
}: AdminLayoutProps) {
  const supabase =
    await createClient();

  /* =========================================================
     1. VERIFY AUTHENTICATION
  ========================================================= */

  const {
    data: claimsData,
    error: claimsError,
  } =
    await supabase.auth.getClaims();

  const userId =
    claimsData?.claims?.sub;

  if (
    claimsError ||
    !userId
  ) {
    redirect("/login");
  }

  /* =========================================================
     2. CHECK PLATFORM ROLE
  ========================================================= */

  const {
    data: profile,
    error: profileError,
  } =
    await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

  if (
    profileError ||
    !profile
  ) {
    redirect("/");
  }

  /* =========================================================
     3. ONLY SAUTI1 ADMINS MAY CONTINUE
  ========================================================= */

  if (
    profile.role !== "admin"
  ) {
    redirect(
      "/auth/route"
    );
  }

  /* =========================================================
     AUTHORIZED
  ========================================================= */

  return children;
}