import type { ReactNode } from "react";

import { OperationsShell } from "@/components/operations-shell";
import { requireAdminWorkspace } from "@/lib/auth/workspace-session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { profile, user } = await requireAdminWorkspace();
  const personName = profile?.full_name?.trim()
    || (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "")
    || user.email?.split("@")[0]
    || "Platform administrator";

  return (
    <OperationsShell
      kind="admin"
      personName={personName}
      roleLabel="Platform administrator"
      workspaceName="SAUTI1 Control Centre"
    >
      {children}
    </OperationsShell>
  );
}
