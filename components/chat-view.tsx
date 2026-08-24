"use client";

import { CheckCircle2, FileCheck2, FileText, Image, MessageSquarePlus, Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { intakeFieldLabel } from "@/lib/sauti1/intake-fields";

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export type ReportPreview = {
  title: string;
  description: string;
  summary: string;
  category: string;
  institutionSlug: string | null;
  institutionName: string;
  priority: string;
  confidence: number;
  locationText: string | null;
  intakeData: Record<string, string>;
  missingFields: string[];
  needsFollowUp: boolean;
  readyToConfirm: boolean;
};

export type RoutedTicket = {
  ticket_id?: string;
  ticket_code?: string;
  ticket_status?: string;
  institution_name?: string;
  acknowledged_at?: string | null;
  acknowledgement_note?: string | null;
};

type ChatViewProps = {
  initialMessages?: ChatMessage[];
  initialConversationId?: string;
  initialReportId?: string;
  initialPreview?: ReportPreview;
  initialTicket?: RoutedTicket;
  initialPrompt?: string;
  voiceMode?: boolean;
};

const welcomeMessage: ChatMessage = {
  role: "assistant",
  text: "Tell me what happened. I will understand the issue, identify the right institution and ask you to confirm before anything is submitted.",
};

const allowedAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxCombinedAttachmentBytes = 12 * 1024 * 1024;
const maxAttachments = 3;

function statusLabel(status?: string) {
  if (!status) return "Draft";
  return status.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const hiddenIntakeFields = new Set([
  "location",
  "incident_description",
  "document_issue",
  "location_verification",
  "location_source_url",
  "current_location_verification",
  "current_location_source_url",
  "current_location_latitude",
  "current_location_longitude",
]);

function ReportReview({ preview }: { preview: ReportPreview }) {
  const intakeFacts = Object.entries(preview.intakeData ?? {})
    .filter(([key]) => !hiddenIntakeFields.has(key));

  return (
    <div className="mobile-report-review">
      <div className="mobile-review-heading">
        <span><FileCheck2 size={17} /></span>
        <div><small>Ready for your review</small><strong>{preview.title}</strong></div>
      </div>
      <p>{preview.summary || preview.description}</p>
      <dl>
        <div><dt>Institution</dt><dd>{preview.institutionName}</dd></div>
        <div><dt>Category</dt><dd>{statusLabel(preview.category)}</dd></div>
        <div><dt>Priority</dt><dd>{statusLabel(preview.priority)}</dd></div>
        {preview.locationText && <div><dt>Location</dt><dd>{preview.locationText}</dd></div>}
        {intakeFacts.map(([key, value]) => (
          <div key={key}><dt>{intakeFieldLabel(key)}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <small className="mobile-review-note">Nothing is submitted until you confirm.</small>
    </div>
  );
}

function changeAttentionCount(delta: number) {
  window.dispatchEvent(new CustomEvent("sauti1:attention-change", { detail: { delta } }));
}

export function ChatView({
  initialMessages,
  initialConversationId,
  initialReportId,
  initialPreview,
  initialTicket,
  initialPrompt,
  voiceMode = false,
}: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages?.length ? initialMessages : [welcomeMessage]
  );
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [reportId, setReportId] = useState(initialReportId);
  const [preview, setPreview] = useState(initialPreview);
  const [ticket, setTicket] = useState(initialTicket);
  const [chatClosed, setChatClosed] = useState(Boolean(initialTicket));
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirming, setCancelConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const announcedAcknowledgement = useRef(initialTicket?.ticket_status === "acknowledged");
  const announcedTicketStatus = useRef(initialTicket?.ticket_status);
  const sentInitialPrompt = useRef(false);

  function speak(text: string) {
    if (!voiceMode || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-UG";
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  }

  const confidence = useMemo(
    () => preview ? `${Math.round(preview.confidence * 100)}%` : "0%",
    [preview]
  );

  function chooseAttachments(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;

    const invalid = selected.find(
      (file) => !allowedAttachmentTypes.has(file.type) || file.size > maxAttachmentBytes
    );
    if (invalid) {
      setError(`${invalid.name} must be a JPEG, PNG, WebP or PDF no larger than 5 MB.`);
      return;
    }

    setAttachments((current) => {
      const combined = [...current, ...selected];
      if (combined.length > maxAttachments) {
        setError(`Attach up to ${maxAttachments} files to one report.`);
      } else if (combined.reduce((total, file) => total + file.size, 0) > maxCombinedAttachmentBytes) {
        setError("Keep the combined evidence size below 12 MB.");
        return current;
      } else {
        setError(undefined);
      }
      return combined.slice(0, maxAttachments);
    });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  async function submitText(text: string) {
    const filesToUpload = [...attachments];
    const messageText = text || (filesToUpload.length
      ? `Attached ${filesToUpload.map((file) => file.name).join(", ")} as evidence for this report.`
      : "");
    if (!messageText || pending || uploading || chatClosed) return;

    const activeReportId = ticket ? undefined : reportId;
    setInput("");
    setPending(true);
    setUploading(filesToUpload.length > 0);
    setError(undefined);
    setNotice(undefined);
    setMessages((current) => [...current, { role: "user", text: messageText }]);

    try {
      const formData = new FormData();
      formData.set("message", messageText);
      formData.set("source", voiceMode ? "voice" : "text");
      if (conversationId) formData.set("conversationId", conversationId);
      if (activeReportId) formData.set("reportId", activeReportId);
      filesToUpload.forEach((file) => formData.append("evidence", file));
      const response = await fetch("/api/sauti1/chat", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Sauti1 could not process that message.");
      }

      setConversationId(payload.conversationId);
      if (payload.report) {
        if (!activeReportId && payload.reportId) changeAttentionCount(1);
        setReportId(payload.reportId);
        setPreview(payload.report);
        setTicket(undefined);
        announcedAcknowledgement.current = false;
      } else if (!activeReportId) {
        setReportId(undefined);
        setPreview(undefined);
      }
      setMessages((current) => [
        ...current,
        { role: "assistant", text: payload.assistantReply },
      ]);
      speak(payload.assistantReply);
      if (filesToUpload.length) {
        setAttachments([]);
      }
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : "Sauti1 could not process that message.");
    } finally {
      setUploading(false);
      setPending(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    await submitText(input.trim());
  }

  useEffect(() => {
    if (!initialPrompt || sentInitialPrompt.current) return;
    sentInitialPrompt.current = true;
    void submitText(initialPrompt);
  }, [initialPrompt]);

  async function confirmReport() {
    if (!reportId || submitting || !preview?.readyToConfirm) return;
    setSubmitting(true);
    setError(undefined);

    try {
      const response = await fetch("/api/sauti1/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Sauti1 could not submit this report.");
      }

      const routedTicket = payload.ticket as RoutedTicket;
      changeAttentionCount(-1);
      setTicket(routedTicket);
      setChatClosed(true);
      setConversationId(undefined);
      setReportId(undefined);
      const institutionName = routedTicket.institution_name || preview.institutionName;
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `Report submitted as ${routedTicket.ticket_code} and routed to ${institutionName}. I will show their acknowledgement here when it arrives.`,
        },
      ]);
      speak(`Report submitted as ${routedTicket.ticket_code} and routed to ${institutionName}.`);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : "Sauti1 could not submit this report.");
    } finally {
      setSubmitting(false);
    }
  }

  function startNewChat(nextNotice?: string) {
    setMessages([welcomeMessage]);
    setInput("");
    setConversationId(undefined);
    setReportId(undefined);
    setPreview(undefined);
    setTicket(undefined);
    setAttachments([]);
    setError(undefined);
    setNotice(nextNotice);
    setCancelConfirming(false);
    setChatClosed(false);
    announcedAcknowledgement.current = false;
    announcedTicketStatus.current = undefined;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function discardDraft() {
    if (!conversationId || cancelling) return;
    const hadReport = Boolean(reportId);
    setCancelling(true);
    setError(undefined);

    try {
      const response = await fetch("/api/sauti1/cancel-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "This draft could not be discarded.");
      if (hadReport) changeAttentionCount(-1);
      startNewChat("Draft discarded. You can start a new report whenever you are ready.");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "This draft could not be discarded.");
    } finally {
      setCancelling(false);
    }
  }

  useEffect(() => {
    if (!ticket?.ticket_id || ["resolved", "closed", "rejected"].includes(ticket.ticket_status || "")) return;

    let active = true;
    let timeoutId: number | undefined;

    async function refreshTicket() {
      try {
        const response = await fetch(`/api/sauti1/ticket-status?ticketId=${ticket?.ticket_id}`);
        if (!response.ok || !active) return;
        const payload = await response.json();
        const updated = payload.ticket;
        const institution = relatedRecord<{ name: string; short_name: string | null }>(updated.institutions);
        const latestEvent = relatedRecord<{ note: string | null }>(updated.ticket_events);
        const institutionName = institution?.short_name || institution?.name || preview?.institutionName || "The institution";

        setTicket({
          ticket_id: updated.id,
          ticket_code: updated.ticket_code,
          ticket_status: updated.status,
          institution_name: institutionName,
          acknowledged_at: updated.acknowledged_at,
          acknowledgement_note: latestEvent?.note,
        });

        if (updated.status === "acknowledged" && !announcedAcknowledgement.current) {
          announcedAcknowledgement.current = true;
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              text: latestEvent?.note
                ? `${institutionName} acknowledged ${updated.ticket_code}: ${latestEvent.note}`
                : `${institutionName} has acknowledged ${updated.ticket_code}.`,
            },
          ]);
          speak(latestEvent?.note
            ? `${institutionName} acknowledged ${updated.ticket_code}. ${latestEvent.note}`
            : `${institutionName} has acknowledged ${updated.ticket_code}.`);
        }

        if (updated.status !== announcedTicketStatus.current) {
          const updateText = updated.status === "in_progress"
            ? latestEvent?.note || `${institutionName} has started working on ${updated.ticket_code}.`
            : updated.status === "resolved"
              ? latestEvent?.note || `${institutionName} marked ${updated.ticket_code} as solved.`
              : updated.status === "closed"
                ? latestEvent?.note || `${institutionName} closed ${updated.ticket_code}.`
                : undefined;
          announcedTicketStatus.current = updated.status;
          if (updateText) {
            setMessages((current) => [...current, { role: "assistant", text: updateText }]);
            speak(updateText);
          }
        }
      } finally {
        if (active) timeoutId = window.setTimeout(refreshTicket, 5000);
      }
    }

    timeoutId = window.setTimeout(refreshTicket, 1500);
    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [preview?.institutionName, ticket?.ticket_id, ticket?.ticket_status]);

  return (
    <div className="chat-page">
      <section className="chat-column">
        <header className="chat-header">
          <h1 className="page-title">{voiceMode ? "Voice Sauti1" : "Text Sauti1"}</h1>
          <p className="page-subtitle">
            Describe what happened naturally. You never need to choose a category or institution.
          </p>
        </header>

        {notice && <div className="chat-notice" role="status">{notice}</div>}
        {error && <div className="chat-error" role="alert">{error}</div>}

        {reportId && !ticket && (
          <div className="chat-draft-toolbar">
            <span><CheckCircle2 size={15} /> Draft saved automatically</span>
            <button disabled={cancelling} onClick={() => setCancelConfirming(true)} type="button"><Trash2 size={15} /> Discard</button>
          </div>
        )}
        {cancelConfirming && reportId && !ticket && (
          <div className="discard-confirmation" role="alert">
            <div><strong>Discard this draft?</strong><span>The conversation and attached evidence will be permanently removed.</span></div>
            <div>
              <button className="pill-action" disabled={cancelling} onClick={() => setCancelConfirming(false)} type="button">Keep draft</button>
              <button className="pill-action danger" disabled={cancelling} onClick={() => void discardDraft()} type="button">{cancelling ? "Discarding..." : "Discard draft"}</button>
            </div>
          </div>
        )}

        <div className="chat-thread" aria-live="polite">
          {messages.map((message, index) => (
            <div className={`message ${message.role === "user" ? "user" : ""}`} key={`${message.role}-${index}`}>
              {message.role === "assistant" && <div className="s1-mark">S1</div>}
              <div className="message-bubble">
                {message.text}

                {preview && !ticket && preview.readyToConfirm && index === messages.length - 1 && message.role === "assistant" && (
                  <>
                    <ReportReview preview={preview} />
                    <div className="confirm-row">
                      <button className="pill-action primary" disabled={submitting} onClick={confirmReport} type="button">
                        <CheckCircle2 size={15} /> {submitting ? "Submitting..." : "Confirm and submit"}
                      </button>
                      <button className="pill-action" onClick={() => inputRef.current?.focus()} type="button">
                        <Pencil size={15} /> Change details
                      </button>
                      <button className="pill-action danger" onClick={() => setCancelConfirming(true)} type="button">
                        <Trash2 size={15} /> Discard
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {pending && (
            <div className="message">
              <div className="s1-mark">S1</div>
              <div className="message-bubble thinking">Sauti1 is thinking...</div>
            </div>
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {chatClosed ? (
          <div className="chat-closed-actions" role="status">
            <div>
              <strong>Report submitted</strong>
              <span>This conversation is now read-only.</span>
            </div>
            <button className="pill-action primary" onClick={() => startNewChat()} type="button">
              <MessageSquarePlus size={17} />
              Start new chat
            </button>
          </div>
        ) : (
          <div className="chat-input-area">
            {attachments.length > 0 && (
              <div className="attachment-strip" aria-label="Files ready to attach">
                {attachments.map((file, index) => (
                  <div className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
                    {file.type === "application/pdf" ? <FileText size={15} /> : <Image size={15} />}
                    <span>{file.name}</span>
                    <button
                      aria-label={`Remove ${file.name}`}
                      disabled={pending || uploading}
                      onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      title="Remove attachment"
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form className="chat-composer" onSubmit={sendMessage}>
              <input
                ref={attachmentInputRef}
                accept="image/jpeg,image/png,image/webp,application/pdf"
                aria-label="Attach screenshots or a PDF"
                hidden
                multiple
                onChange={chooseAttachments}
                type="file"
              />
              <button
                className="circle-btn attachment-button"
                aria-label="Attach screenshots or a PDF"
                disabled={pending || uploading || attachments.length >= maxAttachments}
                onClick={() => attachmentInputRef.current?.click()}
                title="Attach screenshots or a PDF"
                type="button"
              >
                <Paperclip size={18} />
              </button>
              <input
                ref={inputRef}
                aria-label="Message Sauti1"
                autoComplete="off"
                placeholder={uploading ? "Uploading evidence..." : "Tell Sauti1 what happened..."}
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
              <button className="circle-btn voice" aria-label="Send message" disabled={pending || uploading || (!input.trim() && attachments.length === 0)} type="submit">
                <Send size={19} />
              </button>
            </form>
          </div>
        )}
      </section>

      <aside className="preview">
        <h2>Report preview</h2>

        {preview ? (
          <>
            <div className="preview-card">
              <div className="preview-eyebrow">AI understanding</div>
              <div className="preview-title">{preview.title}</div>
              <div className="preview-description">{preview.description}</div>

              <div className="kv"><span>Institution</span><strong>{preview.institutionName}</strong></div>
              <div className="kv"><span>Confidence</span><span className="confidence">{confidence}</span></div>
              <div className="kv"><span>Priority</span><strong>{statusLabel(preview.priority)}</strong></div>
              <div className="kv"><span>Category</span><strong>{statusLabel(preview.category)}</strong></div>
              <div className="kv"><span>Location</span><strong>{preview.locationText || "Not required / not provided"}</strong></div>

              {Object.entries(preview.intakeData ?? {})
                .filter(([key]) => !hiddenIntakeFields.has(key))
                .map(([key, value]) => (
                  <div className="kv" key={key}><span>{intakeFieldLabel(key)}</span><strong>{value}</strong></div>
                ))}

              {preview.intakeData?.location_source_url && <div className="kv"><span>Place source</span><a href={preview.intakeData.location_source_url} rel="noreferrer" target="_blank">OpenStreetMap</a></div>}
              {preview.intakeData?.current_location_source_url && <div className="kv"><span>Current place source</span><a href={preview.intakeData.current_location_source_url} rel="noreferrer" target="_blank">OpenStreetMap</a></div>}

              {(preview.missingFields ?? []).length > 0 && (
                <div className="kv"><span>Still needed</span><strong>{preview.missingFields.map(intakeFieldLabel).join(", ")}</strong></div>
              )}

              {ticket && (
                <>
                  <div className="kv"><span>Ticket</span><strong>{ticket.ticket_code}</strong></div>
                  <div className="kv"><span>Status</span><strong>{statusLabel(ticket.ticket_status)}</strong></div>
                </>
              )}
            </div>

            <div className={`preview-status ${["acknowledged", "in_progress", "resolved", "closed"].includes(ticket?.ticket_status || "") ? "acknowledged" : ""}`}>
              {ticket
                ? ticket.ticket_status === "resolved" || ticket.ticket_status === "closed"
                  ? <><CheckCircle2 size={16} /> {ticket.institution_name || preview.institutionName} marked this ticket as solved.</>
                  : ticket.ticket_status === "in_progress"
                    ? <><CheckCircle2 size={16} /> {ticket.institution_name || preview.institutionName} is working on this ticket.</>
                    : ticket.ticket_status === "acknowledged"
                      ? <><CheckCircle2 size={16} /> {ticket.institution_name || preview.institutionName} acknowledged this ticket.</>
                      : <>Submitted to {ticket.institution_name || preview.institutionName}. Waiting for acknowledgement.</>
                : preview.readyToConfirm
                  ? "Nothing is submitted until you confirm these details."
                  : "Continue the conversation so Sauti1 can complete the report."}
            </div>
            {!ticket && (
              <div className="preview-actions">
                {preview.readyToConfirm && (
                  <button className="pill-action primary" disabled={submitting} onClick={confirmReport} type="button"><CheckCircle2 size={15} /> {submitting ? "Submitting..." : "Confirm and submit"}</button>
                )}
                <button className="pill-action" onClick={() => inputRef.current?.focus()} type="button"><Pencil size={15} /> Change or add details</button>
                <button className="pill-action danger" onClick={() => setCancelConfirming(true)} type="button"><Trash2 size={15} /> Discard draft</button>
              </div>
            )}
          </>
        ) : (
          <div className="preview-empty">
            Your report summary will appear here when Sauti1 identifies a reportable issue.
          </div>
        )}
      </aside>
    </div>
  );
}
