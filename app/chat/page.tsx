import { AppShell } from "@/components/app-shell";
import {
  ChatMessage,
  ChatView,
  ReportPreview,
  RoutedTicket,
} from "@/components/chat-view";
import { requireCitizenWorkspace } from "@/lib/auth/workspace-session";
import { getMissingReportFields, visibleIntakeData } from "@/lib/sauti1/report-ai";

function titleFromCategory(category: string | null) {
  return (category || "Citizen service issue")
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ prompt?: string | string[] }> }) {
  const resolvedSearchParams = await searchParams;
  const promptParam = resolvedSearchParams.prompt;
  const initialPrompt = typeof promptParam === "string" ? promptParam.slice(0, 4000) : undefined;
  const { supabase, user, profile: citizenProfile } = await requireCitizenWorkspace();
  const { data: conversationRows } = await supabase
    .from("conversations")
    .select("id, channel, reports(status)")
    .eq("user_id", user.id)
    .eq("channel", "text")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(10);

  const activeConversations = conversationRows ?? [];
  const staleConversationIds = activeConversations
    .filter((item) => (item.reports ?? []).some((report) => !["draft", "pending_confirmation"].includes(report.status)))
    .map((item) => item.id);

  if (staleConversationIds.length) {
    await supabase
      .from("conversations")
      .update({ status: "closed", ended_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .in("id", staleConversationIds);
  }

  const conversation = activeConversations.find((item) =>
    !staleConversationIds.includes(item.id)
  );

  let initialMessages: ChatMessage[] | undefined;
  let initialReportId: string | undefined;
  let initialPreview: ReportPreview | undefined;
  let initialTicket: RoutedTicket | undefined;

  if (conversation) {
    const [{ data: messageRows }, { data: report }] = await Promise.all([
      supabase
        .from("messages")
        .select("sender_type, body")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("reports")
        .select(`
          id, description, ai_summary, detected_category, priority, status,
          ai_confidence, location_text, intake_data,
          institutions (
            name, short_name, slug,
            institution_services(name, category_key, description, routing_keywords, required_fields)
          ),
          tickets (
            id, ticket_code, status, acknowledged_at,
            institutions (name, short_name),
            ticket_events (event_type, note, created_at)
          )
        `)
        .eq("conversation_id", conversation.id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .order("created_at", { referencedTable: "tickets.ticket_events", ascending: false })
        .limit(1)
        .limit(1, { referencedTable: "tickets.ticket_events" })
        .maybeSingle(),
    ]);

    initialMessages = (messageRows ?? [])
      .filter((row) => row.sender_type === "citizen" || row.sender_type === "ai")
      .map((row) => ({
        role: row.sender_type === "citizen" ? "user" as const : "assistant" as const,
        text: row.body,
      }));

    if (report) {
      const institution = Array.isArray(report.institutions)
        ? report.institutions[0]
        : report.institutions;
      const ticket = Array.isArray(report.tickets) ? report.tickets[0] : report.tickets;
      const ticketInstitution = ticket
        ? Array.isArray(ticket.institutions) ? ticket.institutions[0] : ticket.institutions
        : undefined;
      const latestEvent = ticket
        ? Array.isArray(ticket.ticket_events) ? ticket.ticket_events[0] : ticket.ticket_events
        : undefined;
      const institutionName = ticketInstitution?.short_name || ticketInstitution?.name ||
        institution?.short_name || institution?.name || "Not yet identified";
      const service = institution?.institution_services?.find(
        (item) => item.category_key === report.detected_category
      );
      const intakeData = (report.intake_data ?? {}) as Record<string, string>;
      const missingFields = institution
        ? getMissingReportFields(service, intakeData, report.location_text, report.description, {
          fullName: citizenProfile?.full_name,
          phone: citizenProfile?.phone,
        })
        : [];

      initialPreview = {
        title: titleFromCategory(report.detected_category),
        description: report.description,
        summary: report.ai_summary || report.description,
        category: report.detected_category || "citizen_service_issue",
        institutionSlug: institution?.slug ?? null,
        institutionName,
        priority: report.priority,
        confidence: report.ai_confidence ?? 0,
        locationText: report.location_text,
        intakeData: visibleIntakeData(intakeData),
        missingFields,
        needsFollowUp: !institution || missingFields.length > 0,
        readyToConfirm: report.status === "pending_confirmation" && Boolean(institution) && missingFields.length === 0,
      };

      if (["draft", "pending_confirmation"].includes(report.status)) {
        initialReportId = report.id;
      }

      if (ticket) {
        initialTicket = {
          ticket_id: ticket.id,
          ticket_code: ticket.ticket_code,
          ticket_status: ticket.status,
          acknowledged_at: ticket.acknowledged_at,
          institution_name: institutionName,
          acknowledgement_note: latestEvent?.note,
        };
        const statusText = ticket.status === "acknowledged"
          ? `${institutionName} acknowledged ${ticket.ticket_code}${latestEvent?.note ? `: ${latestEvent.note}` : "."}`
          : `${ticket.ticket_code} is with ${institutionName} and is waiting for acknowledgement.`;
        initialMessages = [...(initialMessages ?? []), { role: "assistant", text: statusText }];
      }
    }
  }

  return (
    <AppShell>
      <ChatView
        initialMessages={initialMessages}
        initialConversationId={conversation?.id}
        initialReportId={initialReportId}
        initialPreview={initialPreview}
        initialTicket={initialTicket}
        initialPrompt={initialPrompt}
        voiceMode={false}
      />
    </AppShell>
  );
}
