import { AppShell } from "@/components/app-shell";
import { CitizenHome, RecentActivity } from "@/components/home";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

export default async function DashboardPage() {
  const { supabase, user } = await requireCitizenWorkspace();
  const [
    { data, error: recentError },
    { count: total, error: totalError },
    { count: active, error: activeError },
    { count: resolved, error: resolvedError },
  ] = await Promise.all([
    supabase
      .from("reports")
      .select(`
        id, description, ai_summary, detected_category, status, source, created_at,
        institutions (name, short_name),
        tickets (ticket_code, status)
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(4),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("user_id", user.id)
      .in("status", ["submitted", "routed", "needs_review", "acknowledged", "assigned", "in_progress", "resolution_proposed", "reopened"]),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("user_id", user.id)
      .in("status", ["resolved_confirmed", "closed"]),
  ]);
  if (recentError || totalError || activeError || resolvedError) {
    throw new Error("We could not load your workspace. Please try again.");
  }

  const recentActivity: RecentActivity[] = (data ?? []).map((report) => {
    const ticket = Array.isArray(report.tickets) ? report.tickets[0] : report.tickets;
    const institution = Array.isArray(report.institutions) ? report.institutions[0] : report.institutions;
    return {
      id: report.id,
      status: ticket?.status || report.status,
      source: report.source,
      title: report.detected_category
        ? report.detected_category.replaceAll("_", " ")
        : report.ai_summary || report.description,
      institutionName: institution?.short_name || institution?.name || "Institution not yet identified",
      ticketCode: ticket?.ticket_code || null,
      time: new Intl.DateTimeFormat("en-UG", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(report.created_at)),
    };
  });

  return (
    <AppShell>
      <CitizenHome
        recentActivity={recentActivity}
        summary={{ total: total ?? 0, active: active ?? 0, resolved: resolved ?? 0 }}
      />
    </AppShell>
  );
}
