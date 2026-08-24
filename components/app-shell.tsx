import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShellClient } from "@/components/app-shell-client";
import { getInitials } from "@/lib/identity";
import { createClient } from "@/lib/supabase/server";

export async function AppShell({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let name = "Citizen";
  let role = "Citizen account";

  if (user) {
    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, role")
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

    name = profile?.full_name?.trim() ||
      (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ||
      user.email?.split("@")[0] ||
      "Citizen";
    if (profile?.role === "admin") redirect("/admin");
    if (membership) redirect("/institution");
    role = "Citizen account";
  }

  return (
    <AppShellClient identity={{ name, role, initials: getInitials(name) }}>
      {children}
    </AppShellClient>
  );
}
