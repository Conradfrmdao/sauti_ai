import { AppShell } from "@/components/app-shell";
import { CitizenHome, RecentActivity } from "@/components/home";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";

export default async function DashboardPage() {
  const { supabase, user } = await requireCitizenWorkspace();
  const { data } = await supabase
    .from("reports")
    .select(`
      id, description, ai_summary, detected_category, status, created_at,
      tickets (ticket_code, status)
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(3);

  const recentActivity: RecentActivity[] = (data ?? []).map((report) => {
    const ticket = Array.isArray(report.tickets) ? report.tickets[0] : report.tickets;
    return {
      id: report.id,
      status: ticket?.status || report.status,
      title: report.detected_category
        ? report.detected_category.replaceAll("_", " ")
        : report.ai_summary || report.description,
      ticketCode: ticket?.ticket_code || null,
      time: new Intl.DateTimeFormat("en-UG", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(report.created_at)),
    };
  });

  return <AppShell><CitizenHome recentActivity={recentActivity} /></AppShell>;
}
