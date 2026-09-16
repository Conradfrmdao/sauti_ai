import type { ReactNode } from "react";

import { OperationsShell } from "@/components/operations-shell";
import { requireInstitutionWorkspace } from "@/lib/auth/workspace-session";

export default async function InstitutionLayout({ children }: { children: ReactNode }) {
  const { membership, profile, user } = await requireInstitutionWorkspace();
  const institution = Array.isArray(membership.institutions)
    ? membership.institutions[0]
    : membership.institutions;
  const personName = profile?.full_name?.trim()
    || (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "")
    || user.email?.split("@")[0]
    || "Institution team member";

  return (
    <OperationsShell
      kind="institution"
      personName={personName}
      roleLabel={membership.role.replaceAll("_", " ")}
      workspaceName={institution?.short_name || institution?.name || "Institution workspace"}
    >
      {children}
    </OperationsShell>
  );
}
