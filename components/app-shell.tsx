import type { ReactNode } from "react";

import { AppShellClient } from "@/components/app-shell-client";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";
import { getInitials } from "@/lib/identity";

export async function AppShell({ children }: { children: ReactNode }) {
  const { user, profile } = await requireCitizenWorkspace();

  const name = profile?.full_name?.trim() ||
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ||
    user.email?.split("@")[0] ||
    "Citizen";

  return (
    <AppShellClient identity={{ name, role: "Citizen account", initials: getInitials(name) }}>
      {children}
    </AppShellClient>
  );
}
