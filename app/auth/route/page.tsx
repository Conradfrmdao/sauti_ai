import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

export default async function AuthRoutePage() {
  const supabase =
    await createClient();

  /* =========================================================
     VERIFY CURRENT IDENTITY
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
    redirect(
      "/login"
    );
  }

  /* =========================================================
     CHECK PLATFORM ROLE
  ========================================================= */

  const {
    data: profile,
  } =
    await supabase
      .from("profiles")
      .select("role")
      .eq(
        "id",
        userId
      )
      .maybeSingle();

  if (
    profile?.role ===
    "admin"
  ) {
    redirect(
      "/admin"
    );
  }

  /* =========================================================
     CHECK INSTITUTION MEMBERSHIP
  ========================================================= */

  const {
    data:
      institutionMembership,
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

  if (
    institutionMembership
  ) {
    redirect(
      "/institution"
    );
  }

  /* =========================================================
     DEFAULT = CITIZEN
  ========================================================= */

  redirect("/");
}