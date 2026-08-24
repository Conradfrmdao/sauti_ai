import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import type { ChatMessage, ReportPreview } from "@/components/chat-view";
import { VoiceView } from "@/components/voice-view";
import { enrichReportIntakeData, getMissingReportFields, matchInstitutionService, reportReplacementMessage, reportRequiresLocation, visibleIntakeData } from "@/lib/sauti1/report-ai";
import { createClient } from "@/lib/supabase/server";

function titleFromCategory(category: string | null) {
  return (category || "Citizen service issue").replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function cleanPendingDescription(value: string) {
  return value
    .replace(
      /\s*Additional information:\s*(?:yes[,.\s]+)?(?:i(?:'| a)?ve\s+)?(?:confirm(?:ed)?(?:\s+the\s+report)?|submit(?:\s+it)?|send(?:\s+it)?|go\s+ahead)\.?/gi,
      ""
    )
    .trim();
}

export default async function VoicePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: citizenProfile } = await supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle();

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, reports(status)")
    .eq("user_id", user.id)
    .eq("channel", "voice")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(5);
  const rows = conversations ?? [];
  const staleIds = rows
    .filter((item) => (item.reports ?? []).some((report) => !["draft", "pending_confirmation"].includes(report.status)))
    .map((item) => item.id);
  if (staleIds.length) {
    await supabase.from("conversations").update({ status: "closed", ended_at: new Date().toISOString() }).eq("user_id", user.id).in("id", staleIds);
  }
  const conversation = rows.find((item) => !staleIds.includes(item.id));

  let initialMessages: ChatMessage[] | undefined;
  let initialReportId: string | undefined;
  let initialPreview: ReportPreview | undefined;
  if (conversation) {
    const [{ data: messageRows }, { data: report }] = await Promise.all([
      supabase.from("messages").select("sender_type, body").eq("conversation_id", conversation.id).order("created_at", { ascending: true }).limit(50),
      supabase.from("reports").select(`
        id, description, ai_summary, detected_category, priority, status,
        ai_confidence, location_text, intake_data,
        institutions(
          name, short_name, slug,
          institution_services(name, category_key, description, routing_keywords, required_fields)
        )
      `).eq("conversation_id", conversation.id).eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    initialMessages = (messageRows ?? []).filter((row) => row.sender_type === "citizen" || row.sender_type === "ai").map((row) => ({
      role: row.sender_type === "citizen" ? "user" as const : "assistant" as const,
      text: row.body,
    }));
    if (report) {
      const institution = Array.isArray(report.institutions) ? report.institutions[0] : report.institutions;
      const citizenMessages = (messageRows ?? []).filter((row) => row.sender_type === "citizen");
      const replacementIndex = citizenMessages.findLastIndex((message) => Boolean(reportReplacementMessage(message.body)));
      const rebuiltDescription = replacementIndex >= 0
        ? citizenMessages.slice(replacementIndex).map((message, index) => {
          const replacement = reportReplacementMessage(message.body);
          const content = replacement || message.body;
          return index === 0 ? content : `Additional information: ${content}`;
        }).join("\n")
        : report.description;
      const cleanedDescription = cleanPendingDescription(rebuiltDescription);
      const matchedService = institution
        ? matchInstitutionService(institution, cleanedDescription)
        : undefined;
      const detectedCategory = matchedService?.category_key || report.detected_category;
      const service = matchedService || institution?.institution_services?.find(
        (item) => item.category_key === detectedCategory
      );
      const normalizedLocation = reportRequiresLocation(service, cleanedDescription)
        ? report.location_text
        : null;
      const intakeData = enrichReportIntakeData(
        service,
        (report.intake_data ?? {}) as Record<string, string>,
        cleanedDescription,
        normalizedLocation,
        { fullName: citizenProfile?.full_name, phone: citizenProfile?.phone }
      );
      const missingFields = institution
        ? getMissingReportFields(service, intakeData, normalizedLocation, cleanedDescription, {
          fullName: citizenProfile?.full_name,
          phone: citizenProfile?.phone,
        })
        : [];
      const intakeChanged = JSON.stringify(intakeData) !== JSON.stringify(report.intake_data ?? {});
      if (
        detectedCategory !== report.detected_category ||
        cleanedDescription !== report.description ||
        normalizedLocation !== report.location_text ||
        intakeChanged
      ) {
        await supabase
          .from("reports")
          .update({
            detected_category: detectedCategory,
            description: cleanedDescription,
            location_text: normalizedLocation,
            intake_data: intakeData,
          })
          .eq("id", report.id)
          .eq("user_id", user.id)
          .in("status", ["draft", "pending_confirmation"]);
      }
      initialReportId = report.id;
      initialPreview = {
        title: matchedService?.name || titleFromCategory(detectedCategory),
        description: cleanedDescription,
        summary: report.status === "pending_confirmation" ? cleanedDescription : report.ai_summary || cleanedDescription,
        category: detectedCategory || "citizen_service_issue",
        institutionSlug: institution?.slug ?? null,
        institutionName: institution?.short_name || institution?.name || "Not yet identified",
        priority: report.priority,
        confidence: report.ai_confidence ?? 0,
        locationText: normalizedLocation,
        intakeData: visibleIntakeData(intakeData),
        missingFields,
        needsFollowUp: !institution || missingFields.length > 0,
        readyToConfirm: report.status === "pending_confirmation" && Boolean(institution) && missingFields.length === 0,
      };
    }
  }

  return (
    <AppShell>
      <VoiceView
        initialConversationId={conversation?.id}
        initialMessages={initialMessages}
        initialPreview={initialPreview}
        initialReportId={initialReportId}
      />
    </AppShell>
  );
}
