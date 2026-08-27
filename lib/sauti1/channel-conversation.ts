import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { locationCandidateFromMessage, resolveUgandaPlaceOnline } from "@/lib/sauti1/location-resolver";
import {
  type CitizenContext,
  getMissingReportFields,
  type InstitutionCatalogItem,
  type KnownLocation,
  type ReportDraft,
  reportRequiresLocation,
  understandCitizenMessage,
  visibleIntakeData,
} from "@/lib/sauti1/report-ai";

export type ExternalChannel = "phone" | "sms";
export type ChannelProvider = "twilio" | "infobip";

export type ChannelSession = {
  conversationId: string;
  contactId: string;
  phoneE164: string;
  userId: string | null;
  channel: ExternalChannel;
  provider: ChannelProvider;
  providerConversationId: string | null;
  status: "active" | "closed";
};

export type ChannelTicketReceipt = {
  ticketId: string;
  ticketCode: string;
  ticketStatus: string;
  institutionId: string;
  institutionName: string;
};

export type ChannelTurnResult = {
  duplicate: boolean;
  conversationId?: string;
  reportId?: string | null;
  aiMessageId?: string;
  assistantReply?: string;
  report?: ReportDraft | null;
  ticket?: ChannelTicketReceipt;
};

type ReferenceData = {
  catalog: InstitutionCatalogItem[];
  locations: KnownLocation[];
};

type ReportRow = {
  id: string;
  status: string;
  institution_id: string | null;
  description: string;
  ai_summary: string | null;
  detected_category: string | null;
  priority: ReportDraft["priority"];
  ai_confidence: number | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  location_confidence: number | null;
  intake_data: Record<string, string> | null;
};

const confirmationPattern = /^(?:yes|y|confirm|confirmed|submit|send|send it|go ahead|correct|that is correct)$/i;
const referenceDataTtlMs = 60_000;
const smsConversationIdleMs = 24 * 60 * 60 * 1000;
const retryableClaimAgeMs = 2 * 60 * 1000;

let referenceDataCache: (ReferenceData & { expiresAt: number }) | null = null;
let referenceDataPromise: Promise<ReferenceData> | null = null;

// Provider retries are claimed durably before any report mutation.

function relationOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isUniqueViolation(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(error?.message ?? "");
}

function isConfirmationMessage(value: string) {
  return confirmationPattern.test(value.trim().replace(/[.!?]+$/g, ""));
}

function hashPayload(payload: unknown) {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  return createHash("sha256").update(serialized).digest("hex");
}

async function loadReferenceData(supabase: SupabaseClient): Promise<ReferenceData> {
  if (referenceDataCache && referenceDataCache.expiresAt > Date.now()) {
    return { catalog: referenceDataCache.catalog, locations: [...referenceDataCache.locations] };
  }
  if (!referenceDataPromise) {
    referenceDataPromise = (async () => {
      const [catalogResult, locationsResult] = await Promise.all([
        supabase.from("institutions").select(`
          id, name, short_name, slug, sector, description, routing_keywords,
          contact_phone, emergency_phone, head_office_address, operating_hours, jurisdiction,
          institution_services (name, category_key, description, routing_keywords, required_fields),
          knowledge_documents (title, content, source_url)
        `).eq("status", "active").eq("verified", true).order("name"),
        supabase.from("locations").select(`
          name, normalized_name, location_type, district_name, region_name,
          latitude, longitude, source_url, location_aliases (normalized_alias)
        `).eq("active", true).limit(250),
      ]);
      if (catalogResult.error) throw new Error(`Could not load institution catalogue: ${catalogResult.error.message}`);
      if (locationsResult.error) console.warn("[CHANNEL] Could not refresh locations.", locationsResult.error.message);
      const data = {
        catalog: (catalogResult.data ?? []) as InstitutionCatalogItem[],
        locations: (locationsResult.data ?? []) as KnownLocation[],
      };
      referenceDataCache = { ...data, expiresAt: Date.now() + referenceDataTtlMs };
      return data;
    })().finally(() => { referenceDataPromise = null; });
  }
  const data = await referenceDataPromise;
  return { catalog: data.catalog, locations: [...data.locations] };
}

export async function claimProviderWebhookEvent(input: {
  provider: ChannelProvider;
  eventId: string;
  eventType: string;
  payload?: unknown;
}) {
  const supabase = createAdminClient();
  const payloadHash = hashPayload(input.payload);
  const { data, error } = await supabase
    .from("provider_webhook_events")
    .insert({
      provider: input.provider,
      event_id: input.eventId,
      event_type: input.eventType,
      payload_hash: payloadHash,
    })
    .select("id")
    .single();

  if (!error) return { claimed: true, databaseId: data.id as string };
  if (!isUniqueViolation(error)) {
    throw new Error(`Could not claim provider event: ${error.message}`);
  }

  const { data: existing, error: lookupError } = await supabase
    .from("provider_webhook_events")
    .select("id, payload_hash, outcome, updated_at")
    .eq("provider", input.provider)
    .eq("event_id", input.eventId)
    .single();
  if (lookupError) throw new Error("Could not inspect provider event.");
  if (existing.payload_hash !== payloadHash) {
    throw new Error("Provider event id was reused with a different payload.");
  }
  const stale = Date.now() - new Date(existing.updated_at).getTime() > retryableClaimAgeMs;
  if (existing.outcome !== "failed" && !(existing.outcome === "processing" && stale)) {
    return { claimed: false, databaseId: existing.id as string };
  }
  const { data: reclaimed, error: reclaimError } = await supabase
    .from("provider_webhook_events")
    .update({ outcome: "processing", processed_at: null })
    .eq("id", existing.id)
    .eq("outcome", existing.outcome)
    .eq("updated_at", existing.updated_at)
    .select("id")
    .maybeSingle();
  if (reclaimError) throw new Error("Could not reclaim provider event.");
  return { claimed: Boolean(reclaimed), databaseId: existing.id as string };
}

export async function finishProviderWebhookEvent(
  databaseId: string,
  outcome: "processed" | "failed" | "ignored"
) {
  const { error } = await createAdminClient().from("provider_webhook_events")
    .update({ outcome, processed_at: new Date().toISOString() })
    .eq("id", databaseId);
  if (error) throw new Error(`Could not finish provider event: ${error.message}`);
}

export async function markProviderWebhookForRetry(
  provider: ChannelProvider,
  eventId: string
) {
  const { error } = await createAdminClient().from("provider_webhook_events")
    .update({ outcome: "failed", processed_at: null })
    .eq("provider", provider).eq("event_id", eventId);
  if (error) throw new Error(`Could not release provider event for retry: ${error.message}`);
}

function toSession(row: Record<string, unknown>, phoneE164: string): ChannelSession {
  return {
    conversationId: String(row.id),
    contactId: String(row.external_contact_id),
    phoneE164,
    userId: typeof row.user_id === "string" ? row.user_id : null,
    channel: row.channel as ExternalChannel,
    provider: row.provider as ChannelProvider,
    providerConversationId: typeof row.provider_conversation_id === "string"
      ? row.provider_conversation_id : null,
    status: row.status as "active" | "closed",
  };
}

async function ensureExternalContact(supabase: SupabaseClient, phoneE164: string) {
  const { data: existing, error: lookupError } = await supabase
    .from("external_channel_contacts")
    .select("id, linked_user_id")
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (lookupError) throw new Error(`Could not load channel contact: ${lookupError.message}`);
  if (existing) {
    await supabase.from("external_channel_contacts")
      .update({ last_seen_at: new Date().toISOString() }).eq("id", existing.id);
    return { id: existing.id as string, userId: existing.linked_user_id as string | null };
  }
  const { data: profile } = await supabase.from("profiles")
    .select("id").eq("phone", phoneE164).limit(2);
  const linkedUserId = profile?.length === 1 ? profile[0].id : null;
  const { data, error } = await supabase.from("external_channel_contacts")
    .insert({ phone_e164: phoneE164, linked_user_id: linkedUserId })
    .select("id, linked_user_id").single();
  if (error && isUniqueViolation(error)) return ensureExternalContact(supabase, phoneE164);
  if (error) throw new Error(`Could not save channel contact: ${error.message}`);
  return { id: data.id as string, userId: data.linked_user_id as string | null };
}

export async function ensureChannelSession(input: {
  phoneE164: string;
  channel: ExternalChannel;
  provider: ChannelProvider;
  providerConversationId?: string | null;
  title?: string;
}): Promise<ChannelSession> {
  const supabase = createAdminClient();
  if (input.providerConversationId) {
    const { data: exact, error } = await supabase.from("conversations")
      .select("id, external_contact_id, user_id, channel, provider, provider_conversation_id, status")
      .eq("provider", input.provider)
      .eq("provider_conversation_id", input.providerConversationId)
      .maybeSingle();
    if (error) throw new Error(`Could not load provider session: ${error.message}`);
    if (exact) return toSession(exact, input.phoneE164);
  }
  const contact = await ensureExternalContact(supabase, input.phoneE164);
  const { data: active, error: activeError } = await supabase.from("conversations")
    .select("id, external_contact_id, user_id, channel, provider, provider_conversation_id, status, updated_at")
    .eq("external_contact_id", contact.id).eq("channel", input.channel)
    .eq("status", "active").maybeSingle();
  if (activeError) throw new Error(`Could not load active session: ${activeError.message}`);
  const resumeSms = active && input.channel === "sms" && input.provider === "infobip" &&
    Date.now() - new Date(active.updated_at).getTime() <= smsConversationIdleMs;
  if (resumeSms) {
    const { error } = await supabase.from("conversations").update({
      last_provider_event_at: new Date().toISOString(), provider_status: "active",
    }).eq("id", active.id);
    if (error) throw new Error(`Could not resume SMS session: ${error.message}`);
    return toSession(active, input.phoneE164);
  }
  if (active) {
    const { error } = await supabase.from("conversations").update({
      status: "closed", ended_at: new Date().toISOString(), provider_status: "replaced",
    }).eq("id", active.id);
    if (error) throw new Error(`Could not close prior channel session: ${error.message}`);
  }
  const { data: created, error: createError } = await supabase.from("conversations")
    .insert({
      user_id: contact.userId,
      external_contact_id: contact.id,
      channel: input.channel,
      provider: input.provider,
      provider_conversation_id: input.providerConversationId || null,
      provider_status: "active",
      last_provider_event_at: new Date().toISOString(),
      title: input.title?.slice(0, 80) || `${input.channel} report`,
    })
    .select("id, external_contact_id, user_id, channel, provider, provider_conversation_id, status")
    .single();
  if (createError && isUniqueViolation(createError)) return ensureChannelSession(input);
  if (createError) throw new Error(`Could not create channel session: ${createError.message}`);
  return toSession(created, input.phoneE164);
}

async function loadDraftReport(supabase: SupabaseClient, session: ChannelSession) {
  const { data, error } = await supabase.from("reports").select(`
    id, status, institution_id, description, ai_summary, detected_category,
    priority, ai_confidence, location_text, latitude, longitude,
    location_confidence, intake_data, institutions (slug, name, short_name)
  `).eq("conversation_id", session.conversationId)
    .in("status", ["draft", "pending_confirmation"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not load channel report: ${error.message}`);
  return data as (ReportRow & {
    institutions: { slug: string; name: string; short_name: string | null } |
      { slug: string; name: string; short_name: string | null }[] | null;
  }) | null;
}

function previousDraftFrom(row: Awaited<ReturnType<typeof loadDraftReport>>): Partial<ReportDraft> | undefined {
  if (!row) return undefined;
  const institution = relationOne(row.institutions);
  return {
    description: row.description, summary: row.ai_summary ?? undefined,
    category: row.detected_category ?? undefined, priority: row.priority,
    confidence: row.ai_confidence ?? undefined, locationText: row.location_text,
    institutionSlug: institution?.slug ?? null,
    institutionName: institution?.short_name || institution?.name,
    intakeData: row.intake_data ?? {},
  };
}

async function ticketForConversation(supabase: SupabaseClient, conversationId: string) {
  const { data, error } = await supabase.from("reports")
    .select("tickets (id, ticket_code, status, institution_id, institutions (name, short_name))")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw new Error(`Could not load channel ticket: ${error.message}`);
  const ticket = relationOne(relationOne(data?.tickets));
  if (!ticket) return undefined;
  const institution = relationOne(ticket.institutions);
  return {
    ticketId: ticket.id,
    ticketCode: ticket.ticket_code,
    ticketStatus: ticket.status,
    institutionId: ticket.institution_id,
    institutionName: institution?.short_name || institution?.name || "institution",
  } as ChannelTicketReceipt;
}

async function appendAiMessage(
  supabase: SupabaseClient,
  session: ChannelSession,
  body: string,
  metadata: Record<string, unknown>
) {
  const { data, error } = await supabase.from("messages").insert({
    conversation_id: session.conversationId, sender_type: "ai", body, metadata,
  }).select("id").single();
  if (error) throw new Error(`Could not save channel reply: ${error.message}`);
  return data.id as string;
}

async function submitDraftReport(supabase: SupabaseClient, reportId: string) {
  const { data, error } = await supabase.rpc("submit_channel_report_to_institution", {
    target_report_id: reportId,
  });
  if (error) throw new Error(`Could not submit channel report: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Channel submission did not return a ticket.");
  return {
    ticketId: row.ticket_id,
    ticketCode: row.ticket_code,
    ticketStatus: row.ticket_status,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
  } as ChannelTicketReceipt;
}

export async function processChannelTurn(input: {
  phoneE164: string;
  channel: ExternalChannel;
  provider: ChannelProvider;
  message: string;
  providerMessageId?: string | null;
  providerConversationId?: string | null;
  eventId: string;
  eventType: string;
  rawEvent?: unknown;
}): Promise<ChannelTurnResult> {
  const message = input.message.trim();
  if (!message || message.length > 4000) throw new Error("Channel message must be 1 to 4,000 characters.");
  const claim = await claimProviderWebhookEvent({
    provider: input.provider, eventId: input.eventId,
    eventType: input.eventType, payload: input.rawEvent ?? input.message,
  });
  if (!claim.claimed) return { duplicate: true };
  try {
    const supabase = createAdminClient();
    const session = await ensureChannelSession({
      phoneE164: input.phoneE164, channel: input.channel, provider: input.provider,
      providerConversationId: input.providerConversationId, title: message,
    });
    if (session.status === "closed") {
      const ticket = await ticketForConversation(supabase, session.conversationId);
      await finishProviderWebhookEvent(claim.databaseId, "ignored");
      return { duplicate: true, conversationId: session.conversationId, ticket };
    }
    const { error: messageError } = await supabase.from("messages").insert({
      conversation_id: session.conversationId,
      sender_type: "citizen",
      sender_user_id: session.userId,
      body: message,
      provider: input.provider,
      provider_message_id: input.providerMessageId || null,
      delivery_status: "received",
    });
    if (messageError && isUniqueViolation(messageError)) {
      const { data: citizen } = await supabase.from("messages")
        .select("created_at").eq("provider", input.provider)
        .eq("provider_message_id", input.providerMessageId).single();
      const { data: savedReply } = citizen ? await supabase.from("messages")
        .select("id, body").eq("conversation_id", session.conversationId)
        .eq("sender_type", "ai").gt("created_at", citizen.created_at)
        .order("created_at", { ascending: true }).limit(1).maybeSingle()
        : { data: null };
      if (savedReply) {
        await finishProviderWebhookEvent(claim.databaseId, "processed");
        return { duplicate: false, conversationId: session.conversationId,
          aiMessageId: savedReply.id, assistantReply: savedReply.body };
      }
    }
    if (messageError && !isUniqueViolation(messageError)) {
      throw new Error(`Could not save channel message: ${messageError.message}`);
    }
    const [report, referenceData, transcriptResult, profileResult] = await Promise.all([
      loadDraftReport(supabase, session),
      loadReferenceData(supabase),
      supabase.from("messages").select("sender_type, body")
        .eq("conversation_id", session.conversationId)
        .order("created_at", { ascending: true }).limit(30),
      session.userId
        ? supabase.from("profiles").select("full_name, phone").eq("id", session.userId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (transcriptResult.error) throw new Error("Could not load channel transcript.");
    const previousDraft = previousDraftFrom(report);
    const citizenContext: CitizenContext = {
      fullName: profileResult.data?.full_name,
      phone: profileResult.data?.phone || session.phoneE164,
    };
    const previousInstitution = previousDraft?.institutionSlug
      ? referenceData.catalog.find((item) => item.slug === previousDraft.institutionSlug)
      : undefined;
    const previousService = previousInstitution?.institution_services?.find(
      (service) => service.category_key === previousDraft?.category
    );
    const previousMissing = previousDraft ? getMissingReportFields(
      previousService, previousDraft.intakeData, previousDraft.locationText,
      previousDraft.description || "", citizenContext
    ) : [];
    if (report && previousInstitution && previousMissing.length === 0 && isConfirmationMessage(message)) {
      const ticket = await submitDraftReport(supabase, report.id);
      const assistantReply = `Thank you. Your report has been submitted. Ticket: ${ticket.ticketCode}.`;
      const aiMessageId = await appendAiMessage(supabase, session, assistantReply, {
        report_id: report.id, ticket_id: ticket.ticketId,
      });
      await finishProviderWebhookEvent(claim.databaseId, "processed");
      return { duplicate: false, conversationId: session.conversationId,
        reportId: report.id, aiMessageId, assistantReply, ticket };
    }
    const transcript = (transcriptResult.data ?? [])
      .filter((row) => row.sender_type === "citizen" || row.sender_type === "ai")
      .map((row) => ({
        role: row.sender_type === "citizen" ? "user" as const : "assistant" as const,
        text: row.body,
      }));
    const answeringCurrentLocation = previousMissing[0] === "current_location";
    const answeringLocation = Boolean(previousDraft && (
      ["location", "current_location"].includes(previousMissing[0] || "") ||
      (!previousDraft.locationText && reportRequiresLocation(
        previousService, previousDraft.description || ""))
    ));
    const locationCandidate = locationCandidateFromMessage(message, answeringLocation);
    const onlinePlace = locationCandidate ? await resolveUgandaPlaceOnline(locationCandidate) : null;
    const locations = [...referenceData.locations];
    if (locationCandidate) locations.unshift({
      name: locationCandidate,
      normalized_name: locationCandidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      location_type: "neighborhood", district_name: null, region_name: null,
      location_aliases: [],
    });
    const draft = await understandCitizenMessage(
      transcript, message, referenceData.catalog, locations,
      previousDraft, citizenContext
    );
    if (onlinePlace) {
      if (answeringCurrentLocation) {
        draft.intakeData.current_location_verification = "OpenStreetMap";
        draft.intakeData.current_location_source_url = onlinePlace.sourceUrl;
        draft.intakeData.current_location_latitude = String(onlinePlace.latitude);
        draft.intakeData.current_location_longitude = String(onlinePlace.longitude);
      } else {
        draft.locationText = onlinePlace.canonicalText;
        draft.intakeData.location = onlinePlace.canonicalText;
        draft.intakeData.location_verification = "OpenStreetMap";
        draft.intakeData.location_source_url = onlinePlace.sourceUrl;
        draft.missingFields = draft.missingFields.filter((field) => field !== "location");
        draft.needsFollowUp = draft.missingFields.length > 0 || !draft.institutionSlug;
        draft.readyToConfirm = draft.intent === "report" && !draft.needsFollowUp;
      }
    }
    const institution = draft.institutionSlug
      ? referenceData.catalog.find((item) => item.slug === draft.institutionSlug)
      : undefined;
    let reportId = report?.id ?? null;
    if (draft.intent === "report") {
      const reportPayload = {
        user_id: session.userId,
        conversation_id: session.conversationId,
        institution_id: institution?.id ?? null,
        description: draft.description,
        ai_summary: draft.summary,
        detected_category: draft.category,
        priority: draft.priority,
        status: "pending_confirmation",
        source: input.channel,
        ai_confidence: draft.confidence,
        location_text: draft.locationText,
        latitude: !answeringCurrentLocation && onlinePlace ? onlinePlace.latitude : report?.latitude,
        longitude: !answeringCurrentLocation && onlinePlace ? onlinePlace.longitude : report?.longitude,
        location_confidence: !answeringCurrentLocation && onlinePlace ? 0.9 : report?.location_confidence,
        intake_data: draft.intakeData,
      };
      if (report) {
        const { data: updated, error } = await supabase.from("reports")
          .update(reportPayload).eq("id", report.id)
          .in("status", ["draft", "pending_confirmation"])
          .select("id").maybeSingle();
        if (error || !updated) throw new Error(error?.message || "Channel report is no longer editable.");
      } else {
        const { data: createdReport, error } = await supabase.from("reports")
          .insert(reportPayload).select("id").single();
        if (error) throw new Error(`Could not create channel report: ${error.message}`);
        reportId = createdReport.id as string;
      }
    }
    const visibleDraft = draft.intent === "report"
      ? { ...draft, intakeData: visibleIntakeData(draft.intakeData) }
      : null;
    const aiMessageId = await appendAiMessage(supabase, session, draft.assistantReply, {
      report_id: reportId,
      draft: visibleDraft,
    });
    const { error: sessionError } = await supabase.from("conversations").update({
      provider_status: "active", last_provider_event_at: new Date().toISOString(),
    }).eq("id", session.conversationId);
    if (sessionError) throw new Error(`Could not update channel session: ${sessionError.message}`);
    await finishProviderWebhookEvent(claim.databaseId, "processed");
    return {
      duplicate: false,
      conversationId: session.conversationId,
      reportId,
      aiMessageId,
      assistantReply: draft.assistantReply,
      report: visibleDraft,
    };
  } catch (error) {
    await finishProviderWebhookEvent(claim.databaseId, "failed").catch(() => undefined);
    throw error;
  }
}

export async function updateChannelSessionStatus(input: {
  provider: ChannelProvider;
  providerConversationId: string;
  status: string;
  close?: boolean;
}) {
  const changes: Record<string, unknown> = {
    provider_status: input.status,
    last_provider_event_at: new Date().toISOString(),
  };
  if (input.close) Object.assign(changes, {
    status: "closed", ended_at: new Date().toISOString(),
  });
  const { error } = await createAdminClient().from("conversations")
    .update(changes).eq("provider", input.provider)
    .eq("provider_conversation_id", input.providerConversationId);
  if (error) throw new Error(`Could not update provider session: ${error.message}`);
}

export async function recordOutboundMessage(input: {
  localMessageId: string;
  provider: ChannelProvider;
  providerMessageId?: string | null;
  status: string;
}) {
  const { error } = await createAdminClient().from("messages").update({
    provider: input.provider,
    provider_message_id: input.providerMessageId || null,
    delivery_status: input.status,
  }).eq("id", input.localMessageId);
  if (error) throw new Error(`Could not record outbound delivery: ${error.message}`);
}

export async function updateOutboundDeliveryStatus(input: {
  provider: ChannelProvider;
  providerMessageId: string;
  status: string;
  delivered?: boolean;
}) {
  const { error } = await createAdminClient().from("messages").update({
    delivery_status: input.status,
    delivered_at: input.delivered ? new Date().toISOString() : null,
  }).eq("provider", input.provider)
    .eq("provider_message_id", input.providerMessageId);
  if (error) throw new Error(`Could not update outbound delivery: ${error.message}`);
}
