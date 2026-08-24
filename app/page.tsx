import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CitizenHome, RecentActivity } from "@/components/home";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (user) {
    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase
        .from("institution_members")
        .select("institution_id")
        .eq("user_id", user.id)
        .eq("active", true)
        .limit(1)
        .maybeSingle(),
    ]);
    if (profile?.role === "admin") redirect("/admin");
    if (membership) redirect("/institution");
  }

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
