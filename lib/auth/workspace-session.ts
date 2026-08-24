import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export const getWorkspaceSession = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, profile: null, membership: null };
  }

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, phone, role")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("institution_members")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  return { supabase, user, profile, membership };
});

export async function requireCitizenWorkspace() {
  const session = await getWorkspaceSession();
  if (!session.user) redirect("/login");
  if (session.profile?.role === "admin") redirect("/admin");
  if (session.membership) redirect("/institution");
  return { ...session, user: session.user };
}
