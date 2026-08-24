import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type InstitutionLayoutProps = {
  children: ReactNode;
};

export default async function InstitutionLayout({
  children,
}: InstitutionLayoutProps) {
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
     2. CHECK IF USER IS PLATFORM ADMIN
  ========================================================= */

  const {
    data: profile,
  } =
    await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

  /*
   * Platform admins belong in the
   * SAUTI1 Control Center.
   */

  if (
    profile?.role === "admin"
  ) {
    redirect("/admin");
  }

  /* =========================================================
     3. CHECK ACTIVE INSTITUTION MEMBERSHIP
  ========================================================= */

  const {
    data: membership,
    error: membershipError,
  } =
    await supabase
      .from(
        "institution_members"
      )
      .select(
        `
          institution_id,
          role,
          active
        `
      )
      .eq(
        "user_id",
        userId
      )
      .eq(
        "active",
        true
      )
      .limit(1)
      .maybeSingle();

  /* =========================================================
     4. CITIZENS ARE NOT ALLOWED
  ========================================================= */

  if (
    membershipError ||
    !membership
  ) {
    redirect("/");
  }

  /* =========================================================
     AUTHORIZED
  ========================================================= */

  return children;
}