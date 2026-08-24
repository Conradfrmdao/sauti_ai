import type { ReactNode } from "react";

import { AppShellClient } from "@/components/app-shell-client";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";
import { getInitials } from "@/lib/identity";

export async function AppShell({ children }: { children: ReactNode }) {
  const { supabase, user, profile } = await requireCitizenWorkspace();
  const { count: attentionCount } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("source", "text")
    .in("status", ["draft", "pending_confirmation"])
    .is("attention_read_at", null);

  const name = profile?.full_name?.trim() ||
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ||
    user.email?.split("@")[0] ||
    "Citizen";

  return (
    <AppShellClient
      attentionCount={attentionCount ?? 0}
      identity={{ name, role: "Citizen account", initials: getInitials(name) }}
    >
      {children}
    </AppShellClient>
  );
}
