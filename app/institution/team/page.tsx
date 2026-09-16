import { ShieldCheck, UserRound, UsersRound } from "lucide-react";

import { EmptyState, StatusBadge, titleCase } from "@/components/case-ui";
import { requireInstitutionWorkspace } from "@/lib/auth/workspace-session";

type TeamDirectoryMember = {
  user_id: string;
  full_name: string | null;
  member_role: string;
  department: string | null;
  active: boolean;
};

export default async function InstitutionTeamPage() {
  const { supabase, membership } = await requireInstitutionWorkspace();
  const { data: members, error } = await supabase.rpc("get_institution_team_directory", {
    target_institution_id: membership.institution_id,
  });
  if (error) throw new Error("The institution team could not be loaded.");
  const teamMembers = (members ?? []) as TeamDirectoryMember[];

  return (
    <main className="operations-page">
      <header className="operations-page-header">
        <div><p className="eyebrow">Access & ownership</p><h1>Team</h1><p>Active workspace members, roles and departments for this institution.</p></div>
      </header>

      <section className="operations-metrics is-two">
        <div><span><UsersRound size={17} /></span><p>Active members</p><strong>{teamMembers.filter((member) => member.active).length}</strong></div>
        <div><span><ShieldCheck size={17} /></span><p>Supervisors & admins</p><strong>{teamMembers.filter((member) => member.active && ["supervisor", "institution_admin"].includes(member.member_role)).length}</strong></div>
      </section>

      <section className="operations-panel">
        <header><div><h2>Workspace directory</h2><p>Assignments are limited to active members of this institution.</p></div></header>
        {teamMembers.length === 0 ? (
          <EmptyState description="A platform administrator must provision the first institution member." icon={<UsersRound size={19} />} title="No team members" />
        ) : (
          <div className="team-list">
            {teamMembers.map((member) => {
              return (
                <article key={member.user_id}>
                  <span className="team-avatar"><UserRound size={18} /></span>
                  <div><strong>{member.full_name || "Institution team member"}</strong><p>{member.department || "Department not specified"}</p></div>
                  <span>{titleCase(member.member_role)}</span>
                  <StatusBadge status={member.active ? "active" : "closed"} />
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
