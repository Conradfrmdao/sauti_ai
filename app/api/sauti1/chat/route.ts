import { NextResponse } from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import {
  CitizenContext,
  getMissingReportFields,
  InstitutionCatalogItem,
  KnownLocation,
  ReportEvidenceInput,
  ReportDraft,
  reportRequiresLocation,
  understandCitizenMessage,
  visibleIntakeData,
} from "@/lib/sauti1/report-ai";
import {
  locationCandidateFromMessage,
  resolveUgandaPlaceOnline,
} from "@/lib/sauti1/location-resolver";
import { createClient } from "@/lib/supabase/server";

type ChatRequest = {
  conversationId?: string;
  reportId?: string;
  message?: string;
  source?: "text" | "voice";
};

type PreparedEvidence = {
  file: File;
  bytes: Uint8Array;
  aiInput: ReportEvidenceInput;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const referenceDataTtlMs = 60_000;
const allowedEvidenceTypes = new Set<ReportEvidenceInput["mimeType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const maxEvidenceFiles = 3;
const maxEvidenceFileBytes = 5 * 1024 * 1024;
const maxEvidenceRequestBytes = 12 * 1024 * 1024;

type ReferenceData = {
  catalog: InstitutionCatalogItem[];
  locations: KnownLocation[];
};

let referenceDataCache: (ReferenceData & { expiresAt: number }) | null = null;
let referenceDataPromise: Promise<ReferenceData> | null = null;

function invalidId(value?: string) {
  return Boolean(value && !uuidPattern.test(value));
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

async function parseChatRequest(request: Request) {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      body: {
        conversationId: formString(formData, "conversationId"),
        reportId: formString(formData, "reportId"),
        message: formString(formData, "message"),
        source: formString(formData, "source") === "voice" ? "voice" as const : "text" as const,
      },
      files: formData.getAll("evidence").filter((value): value is File => value instanceof File),
    };
  }

  return { body: await request.json() as ChatRequest, files: [] as File[] };
}

function hasExpectedFileSignature(mimeType: ReportEvidenceInput["mimeType"], bytes: Uint8Array) {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/webp") {
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
}

async function prepareEvidence(files: File[]): Promise<PreparedEvidence[]> {
  if (files.length > maxEvidenceFiles) {
    throw new Error(`Attach up to ${maxEvidenceFiles} files to one report.`);
  }
  if (files.reduce((total, file) => total + file.size, 0) > maxEvidenceRequestBytes) {
    throw new Error("Keep the combined evidence size below 12 MB.");
  }

  return Promise.all(files.map(async (file) => {
    if (!allowedEvidenceTypes.has(file.type as ReportEvidenceInput["mimeType"])) {
      throw new Error(`${file.name} must be a JPEG, PNG, WebP or PDF.`);
    }
    if (file.size === 0 || file.size > maxEvidenceFileBytes) {
      throw new Error(`${file.name} must be no larger than 5 MB.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type as ReportEvidenceInput["mimeType"];
    if (!hasExpectedFileSignature(mimeType, bytes)) {
      throw new Error(`${file.name} does not match its declared file type.`);
    }
    return {
      file,
      bytes,
      aiInput: {
        name: file.name.slice(0, 120),
        mimeType,
        data: Buffer.from(bytes).toString("base64"),
      },
    };
  }));
}

async function persistEvidence(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  reportId: string,
  evidence: PreparedEvidence[]
) {
  const persisted: { id: string; storagePath: string }[] = [];

  try {
    for (const item of evidence) {
      const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "evidence";
      const storagePath = `${userId}/${reportId}/${crypto.randomUUID()}-${safeName}`;
      const { data: metadata, error: metadataError } = await supabase
        .from("report_attachments")
        .insert({
          report_id: reportId,
          uploaded_by: userId,
          storage_path: storagePath,
          original_name: item.file.name.slice(0, 255),
          mime_type: item.aiInput.mimeType,
          size_bytes: item.file.size,
          attachment_type: item.aiInput.mimeType.startsWith("image/") ? "image" : "document",
        })
        .select("id")
        .single();
      if (metadataError) throw new Error(`Could not attach ${item.file.name}: ${metadataError.message}`);

      const { error: storageError } = await supabase.storage
        .from("report-attachments")
        .upload(storagePath, item.bytes, { contentType: item.aiInput.mimeType, upsert: false });
      if (storageError) {
        await supabase.from("report_attachments").delete().eq("id", metadata.id).eq("uploaded_by", userId);
        throw new Error(`Could not upload ${item.file.name}: ${storageError.message}`);
      }
      persisted.push({ id: metadata.id, storagePath });
    }
  } catch (error) {
    for (const item of persisted.reverse()) {
      await supabase.storage.from("report-attachments").remove([item.storagePath]);
      await supabase.from("report_attachments").delete().eq("id", item.id).eq("uploaded_by", userId);
    }
    throw error;
  }
}

async function loadReferenceData(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<ReferenceData> {
  if (referenceDataCache && referenceDataCache.expiresAt > Date.now()) {
    return {
      catalog: referenceDataCache.catalog,
      locations: [...referenceDataCache.locations],
    };
  }

  if (!referenceDataPromise) {
    referenceDataPromise = (async () => {
      const [catalogResult, locationsResult] = await Promise.all([
        supabase
          .from("institutions")
          .select(`
            id, name, short_name, slug, sector, description, routing_keywords,
            contact_phone, emergency_phone, head_office_address, operating_hours, jurisdiction,
            institution_services (name, category_key, description, routing_keywords, required_fields),
            knowledge_documents (title, content, source_url)
          `)
          .eq("status", "active")
          .eq("verified", true)
          .order("name"),
        supabase
          .from("locations")
          .select(`
            name, normalized_name, location_type, district_name, region_name,
            latitude, longitude, source_url,
            location_aliases (normalized_alias)
          `)
          .eq("active", true)
          .limit(250),
      ]);

      if (catalogResult.error) {
        throw new Error("The institution catalogue is not ready. Apply migration 004 and try again.");
      }
      if (locationsResult.error) {
        console.warn("Could not refresh the Uganda location catalogue.", locationsResult.error.message);
      }

      const data = {
        catalog: (catalogResult.data ?? []) as InstitutionCatalogItem[],
        locations: (locationsResult.data ?? []) as KnownLocation[],
      };
      referenceDataCache = { ...data, expiresAt: Date.now() + referenceDataTtlMs };
      return data;
    })().finally(() => {
      referenceDataPromise = null;
    });
  }

  const data = await referenceDataPromise;
  return { catalog: data.catalog, locations: [...data.locations] };
}

export async function POST(request: Request) {
  const requestStartedAt = performance.now();
  const timings: Record<string, number> = {};
  const mark = (name: string) => {
    timings[name] = Math.round(performance.now() - requestStartedAt);
  };
  let body: ChatRequest;
  let files: File[];

  try {
    ({ body, files } = await parseChatRequest(request));
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  mark("request_parsed");

  let preparedEvidence: PreparedEvidence[];
  try {
    preparedEvidence = await prepareEvidence(files);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The attached evidence is invalid." },
      { status: 400 }
    );
  }

  const citizenMessage = body.message?.trim() || (preparedEvidence.length
    ? `I attached ${preparedEvidence.length} ${preparedEvidence.length === 1 ? "file" : "files"} as evidence for this report.`
    : undefined);
  const source = body.source === "voice" ? "voice" : "text";
  if (!citizenMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (citizenMessage.length > 4000) {
    return NextResponse.json({ error: "Keep each message below 4,000 characters." }, { status: 400 });
  }
  if (invalidId(body.conversationId) || invalidId(body.reportId)) {
    return NextResponse.json({ error: "Invalid conversation or report reference." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to text Sauti1." }, { status: 401 });
  }
  if (!await isCitizenWorkspace(supabase, user.id)) {
    return NextResponse.json({ error: "Citizen AI is not available in this account workspace." }, { status: 403 });
  }
  mark("authentication");

  let conversationId = body.conversationId;
  if (conversationId) {
    const { data: ownedConversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .eq("channel", source)
      .eq("status", "active")
      .maybeSingle();
    if (!ownedConversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
  } else {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, channel: source, title: citizenMessage.slice(0, 80) })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    conversationId = conversation.id;
  }

  let previousDraft: Partial<ReportDraft> | undefined;
  let previousLatitude: number | null = null;
  let previousLongitude: number | null = null;
  let previousLocationConfidence: number | null = null;
  let reportId = body.reportId;
  if (reportId) {
    const { data: report } = await supabase
      .from("reports")
      .select(`
        id, description, ai_summary, detected_category, priority,
        ai_confidence, location_text, latitude, longitude, location_confidence,
        intake_data, status,
        institutions (slug, name, short_name)
      `)
      .eq("id", reportId)
      .eq("user_id", user.id)
      .eq("conversation_id", conversationId)
      .in("status", ["draft", "pending_confirmation"])
      .maybeSingle();

    if (!report) {
      return NextResponse.json({ error: "The report draft is no longer editable." }, { status: 409 });
    }

    const linkedInstitution = Array.isArray(report.institutions)
      ? report.institutions[0]
      : report.institutions;
    previousDraft = {
      description: report.description,
      summary: report.ai_summary ?? undefined,
      category: report.detected_category ?? undefined,
      priority: report.priority as ReportDraft["priority"],
      confidence: report.ai_confidence ?? undefined,
      locationText: report.location_text,
      institutionSlug: linkedInstitution?.slug ?? null,
      institutionName: linkedInstitution?.short_name || linkedInstitution?.name,
      intakeData: (report.intake_data ?? {}) as Record<string, string>,
    };
    previousLatitude = report.latitude === null ? null : Number(report.latitude);
    previousLongitude = report.longitude === null ? null : Number(report.longitude);
    previousLocationConfidence = report.location_confidence === null
      ? null
      : Number(report.location_confidence);
  }

  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "citizen",
    sender_user_id: user.id,
    body: citizenMessage,
  });
  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }
  mark("citizen_message_persisted");

  let transcriptResult;
  let profileResult;
  let referenceData: ReferenceData;
  try {
    [transcriptResult, profileResult, referenceData] = await Promise.all([
      supabase
        .from("messages")
        .select("sender_type, body")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(30),
      supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("id", user.id)
        .maybeSingle(),
      loadReferenceData(supabase),
    ]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The institution catalogue is not ready." },
      { status: 503 }
    );
  }

  const transcript = (transcriptResult.data ?? [])
    .filter((row) => row.sender_type === "citizen" || row.sender_type === "ai")
    .map((row) => ({
      role: row.sender_type === "citizen" ? "user" as const : "assistant" as const,
      text: row.body,
    }));
  const catalog = referenceData.catalog;
  const locations = referenceData.locations;
  mark("reference_data_loaded");
  const citizenContext: CitizenContext = {
    fullName: profileResult.data?.full_name,
    phone: profileResult.data?.phone,
  };
  const previousInstitution = previousDraft?.institutionSlug
    ? catalog.find((item) => item.slug === previousDraft.institutionSlug)
    : undefined;
  const previousService = previousInstitution?.institution_services?.find(
    (service) => service.category_key === previousDraft?.category
  );
  const previousMissingFields = previousDraft
    ? getMissingReportFields(
        previousService,
        previousDraft.intakeData,
        previousDraft.locationText,
        previousDraft.description || "",
        citizenContext
      )
    : [];
  const answeringCurrentLocation = previousMissingFields[0] === "current_location";
  const answeringLocationQuestion = Boolean(
    previousDraft &&
    (
      ["location", "current_location"].includes(previousMissingFields[0] || "") ||
      (
        !previousDraft.locationText &&
        (
          reportRequiresLocation(previousService, previousDraft.description || "") ||
          ["Water and sanitation", "Electricity", "Environment", "Forestry", "Roads and transport"]
            .includes(previousInstitution?.sector ?? "")
        )
      )
    )
  );
  const locationCandidate = locationCandidateFromMessage(citizenMessage, answeringLocationQuestion);
  const normalizedCitizenMessage = citizenMessage.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hasKnownLocation = locations.some((location) => [
    location.normalized_name,
    ...(location.location_aliases ?? []).map((alias) => alias.normalized_alias),
  ].some((term) => Boolean(term) && normalizedCitizenMessage.includes(term)));
  const onlinePlacePromise = locationCandidate && !hasKnownLocation
    ? resolveUgandaPlaceOnline(locationCandidate)
    : Promise.resolve(null);
  const locationsForUnderstanding = [...locations];
  if (locationCandidate && !hasKnownLocation) {
    locationsForUnderstanding.unshift({
      name: locationCandidate,
      normalized_name: locationCandidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      location_type: "neighborhood",
      district_name: null,
      region_name: null,
      location_aliases: [{
        normalized_alias: citizenMessage.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      }],
    });
  }
  mark("location_resolution_started");
  const draft = await understandCitizenMessage(
    transcript,
    citizenMessage,
    catalog,
    locationsForUnderstanding,
    previousDraft,
    citizenContext,
    preparedEvidence.map((item) => item.aiInput)
  );
  mark("gemini_or_fallback_complete");
  const onlinePlace = await onlinePlacePromise;
  mark("location_resolution_complete");
  if (onlinePlace) {
    if (!answeringCurrentLocation) {
      draft.locationText = onlinePlace.canonicalText;
      draft.intakeData.location = onlinePlace.canonicalText;
      draft.missingFields = draft.missingFields.filter((field) => field !== "location");
      draft.needsFollowUp = draft.missingFields.length > 0 || !draft.institutionSlug;
      draft.readyToConfirm = draft.intent === "report" && Boolean(draft.institutionSlug) && !draft.needsFollowUp;
    }
    if (answeringCurrentLocation) {
      draft.intakeData.current_location_verification = "OpenStreetMap";
      draft.intakeData.current_location_source_url = onlinePlace.sourceUrl;
      draft.intakeData.current_location_latitude = String(onlinePlace.latitude);
      draft.intakeData.current_location_longitude = String(onlinePlace.longitude);
    } else {
      draft.intakeData.location_verification = "OpenStreetMap";
      draft.intakeData.location_source_url = onlinePlace.sourceUrl;
    }
  }
  const institution = draft.institutionSlug
    ? catalog.find((item) => item.slug === draft.institutionSlug)
    : undefined;

  if (draft.intent === "report") {
    const reportPayload = {
      user_id: user.id,
      conversation_id: conversationId,
      institution_id: institution?.id ?? null,
      description: draft.description,
      ai_summary: draft.summary,
      detected_category: draft.category,
      priority: draft.priority,
      status: source === "text" ? "draft" : "pending_confirmation",
      source,
      ai_confidence: draft.confidence,
      location_text: draft.locationText,
      latitude: !answeringCurrentLocation && onlinePlace ? onlinePlace.latitude : previousLatitude,
      longitude: !answeringCurrentLocation && onlinePlace ? onlinePlace.longitude : previousLongitude,
      location_confidence: !answeringCurrentLocation && onlinePlace ? 0.9 : previousLocationConfidence,
      intake_data: draft.intakeData,
      ...(source === "text" ? { attention_read_at: null } : {}),
    };

    if (reportId) {
      const { data: updated, error } = await supabase
        .from("reports")
        .update(reportPayload)
        .eq("id", reportId)
        .eq("user_id", user.id)
        .in("status", ["draft", "pending_confirmation"])
        .select("id")
        .maybeSingle();
      if (error || !updated) {
        return NextResponse.json({ error: error?.message || "The report could not be updated." }, { status: 409 });
      }
    } else {
      const { data: report, error } = await supabase
        .from("reports")
        .insert(reportPayload)
        .select("id")
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      reportId = report.id;
    }
  }
  mark("report_persisted");

  if (preparedEvidence.length) {
    if (!reportId || draft.intent !== "report") {
      return NextResponse.json(
        { error: "Attach evidence while describing a reportable issue." },
        { status: 409 }
      );
    }
    try {
      await persistEvidence(supabase, user.id, reportId, preparedEvidence);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "The evidence could not be saved." },
        { status: 500 }
      );
    }
  }
  mark("evidence_persisted");

  const { error: aiMessageError } = await supabase.rpc("append_ai_message", {
    target_conversation_id: conversationId,
    message_body: draft.assistantReply,
    message_metadata: {
      report_id: reportId ?? null,
      draft: { ...draft, intakeData: visibleIntakeData(draft.intakeData) },
    },
  });
  if (aiMessageError) {
    console.error("Could not persist Sauti1 response", aiMessageError);
  }
  mark("ai_message_persisted");

  const visibleDraft = { ...draft, intakeData: visibleIntakeData(draft.intakeData) };
  mark("total");
  if (process.env.NODE_ENV !== "production") {
    console.info("[Sauti1 latency]", timings);
  }
  return NextResponse.json({
    conversationId,
    reportId: reportId ?? null,
    assistantReply: draft.assistantReply,
    report: draft.intent === "report" ? visibleDraft : null,
    intent: draft.intent,
    debugTimings: process.env.NODE_ENV === "production" ? undefined : timings,
  });
}
