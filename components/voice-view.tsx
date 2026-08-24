"use client";

import { GoogleGenAI, LiveServerMessage, Session } from "@google/genai";
import {
  CheckCircle2,
  Loader2,
  Mic2,
  MicOff,
  PhoneOff,
  RotateCcw,
  ShieldCheck,
  TicketCheck,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatMessage, ReportPreview, RoutedTicket } from "@/components/chat-view";
import { intakeFieldLabel } from "@/lib/sauti1/intake-fields";

type VoiceState = "idle" | "connecting" | "listening" | "processing" | "speaking" | "ended" | "submitted" | "error";

type VoiceViewProps = {
  initialMessages?: ChatMessage[];
  initialConversationId?: string;
  initialReportId?: string;
  initialPreview?: ReportPreview;
};

type VoiceFunctionCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

const welcomeMessage: ChatMessage = {
  role: "assistant",
  text: "Start Voice Sauti1, then tell me what happened. You can interrupt me naturally while I speak.",
};

function decodeBase64(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return window.btoa(binary);
}

function pcm16FromFloat32(input: Float32Array, inputRate: number, outputRate = 16000) {
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(input.length, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) sum += input[inputIndex];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output.buffer;
}

function audioRate(mimeType?: string) {
  const match = mimeType?.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24000;
}

function relatedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isConfirmationPhrase(value: string) {
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\b(?:do not|don t|not yet|cancel|stop)\b/.test(text)) return false;
  if (/^(?:yes|yes please|ok|okay|go ahead|looks correct|that is correct|yes that is correct|the details are correct|everything is correct)$/.test(text)) return true;
  return text.length <= 80 && /\b(?:confirm|confirmed|submit|send)\b/.test(text);
}

async function requestMicrophone(timeoutMs = 12000) {
  let timedOut = false;
  let timeoutId: number | undefined;
  const request = navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).then((stream) => {
    if (timedOut) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Microphone permission timed out.");
    }
    return stream;
  });

  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          reject(new Error("Allow microphone access in your browser, then start Voice Sauti1 again."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function safelyCloseAudioContext(context?: AudioContext) {
  if (!context || context.state === "closed") return;
  void context.close().catch(() => {
    // Live callbacks and explicit controls can finish at the same time.
  });
}

export function VoiceView({
  initialMessages,
  initialConversationId,
  initialReportId,
  initialPreview,
}: VoiceViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages?.length ? initialMessages : [welcomeMessage]);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [reportId, setReportId] = useState(initialReportId);
  const [preview, setPreview] = useState(initialPreview);
  const [ticket, setTicket] = useState<RoutedTicket>();
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [inputCaption, setInputCaption] = useState("");
  const [outputCaption, setOutputCaption] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const sessionRef = useRef<Session | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const inputContextRef = useRef<AudioContext | undefined>(undefined);
  const outputContextRef = useRef<AudioContext | undefined>(undefined);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | undefined>(undefined);
  const processorRef = useRef<ScriptProcessorNode | undefined>(undefined);
  const silentGainRef = useRef<GainNode | undefined>(undefined);
  const outputSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextPlayTimeRef = useRef(0);
  const conversationIdRef = useRef(initialConversationId);
  const reportIdRef = useRef(initialReportId);
  const previewRef = useRef(initialPreview);
  const lastInputRef = useRef("");
  const handledCallsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const mutedRef = useRef(false);
  const submittingRef = useRef(false);
  const closeAfterReplyRef = useRef(false);
  const submissionTurnCompleteRef = useRef(false);
  const modelTurnCompleteRef = useRef(false);
  const submissionTimeoutRef = useRef<number | undefined>(undefined);
  const turnAbortRef = useRef<AbortController | undefined>(undefined);
  const ticketPollAbortRef = useRef<AbortController | undefined>(undefined);
  const conversationGenerationRef = useRef(0);

  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { reportIdRef.current = reportId; }, [reportId]);
  useEffect(() => { previewRef.current = preview; }, [preview]);

  const stopOutput = useCallback(() => {
    for (const source of outputSourcesRef.current) {
      try { source.stop(); } catch { /* The source may already have ended. */ }
    }
    outputSourcesRef.current.clear();
    nextPlayTimeRef.current = outputContextRef.current?.currentTime ?? 0;
  }, []);

  const releaseMicrophone = useCallback((signalEnd = true) => {
    if (signalEnd && sessionRef.current) {
      try { sessionRef.current.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* Session may already be closed. */ }
    }
    processorRef.current?.disconnect();
    inputSourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    processorRef.current = undefined;
    inputSourceRef.current = undefined;
    silentGainRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
  }, []);

  const endSession = useCallback((nextState: VoiceState = "ended") => {
    releaseMicrophone();
    closeAfterReplyRef.current = false;
    submissionTurnCompleteRef.current = false;
    modelTurnCompleteRef.current = false;
    if (submissionTimeoutRef.current) window.clearTimeout(submissionTimeoutRef.current);
    submissionTimeoutRef.current = undefined;

    const session = sessionRef.current;
    const inputContext = inputContextRef.current;
    const outputContext = outputContextRef.current;
    sessionRef.current = undefined;
    inputContextRef.current = undefined;
    outputContextRef.current = undefined;

    stopOutput();
    try { session?.close(); } catch { /* Already closed. */ }
    safelyCloseAudioContext(inputContext);
    safelyCloseAudioContext(outputContext);
    mutedRef.current = false;
    if (mountedRef.current) {
      setMuted(false);
      setState(nextState);
    }
  }, [releaseMicrophone, stopOutput]);

  const finishSpokenSubmission = useCallback(() => {
    if (
      closeAfterReplyRef.current &&
      submissionTurnCompleteRef.current &&
      outputSourcesRef.current.size === 0
    ) {
      endSession("submitted");
    }
  }, [endSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      endSession("ended");
    };
  }, [endSession]);

  const playAudio = useCallback(async (base64: string, mimeType?: string) => {
    const context = outputContextRef.current;
    if (!context) return;
    if (context.state === "suspended") await context.resume();

    const pcm = decodeBase64(base64);
    const view = new DataView(pcm);
    const length = Math.floor(view.byteLength / 2);
    const buffer = context.createBuffer(1, length, audioRate(mimeType));
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) channel[index] = view.getInt16(index * 2, true) / 32768;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, nextPlayTimeRef.current);
    nextPlayTimeRef.current = startAt + buffer.duration;
    outputSourcesRef.current.add(source);
    source.onended = () => {
      outputSourcesRef.current.delete(source);
      if (closeAfterReplyRef.current) {
        finishSpokenSubmission();
      } else if (
        outputSourcesRef.current.size === 0 &&
        modelTurnCompleteRef.current &&
        mountedRef.current &&
        sessionRef.current
      ) {
        modelTurnCompleteRef.current = false;
        setState("listening");
      }
    };
    source.start(startAt);
    if (mountedRef.current && !closeAfterReplyRef.current) setState("speaking");
  }, [finishSpokenSubmission]);

  const submitCurrentReport = useCallback(async (call?: VoiceFunctionCall) => {
    const activeReportId = reportIdRef.current;
    const activePreview = previewRef.current;
    if (!activeReportId || !activePreview?.readyToConfirm || submittingRef.current) {
      throw new Error("This report is not ready to submit yet.");
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/sauti1/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: activeReportId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Sauti1 could not submit this report.");

      const routedTicket = payload.ticket as RoutedTicket;
      const institutionName = routedTicket.institution_name || activePreview.institutionName;
      const assistantReply = `Submitted. Ticket ${routedTicket.ticket_code} was routed to ${institutionName}. This call is now closed.`;
      setTicket({ ...routedTicket, institution_name: institutionName });
      setMessages((current) => [...current, { role: "assistant", text: assistantReply }]);
      conversationIdRef.current = undefined;
      reportIdRef.current = undefined;
      setConversationId(undefined);
      setReportId(undefined);

      if (call && sessionRef.current) {
        releaseMicrophone();
        closeAfterReplyRef.current = true;
        submissionTurnCompleteRef.current = false;
        setOutputCaption("");
        setState("submitted");
        try {
          sessionRef.current.sendToolResponse({
            functionResponses: [{
              id: call.id,
              name: call.name,
              response: {
                output: {
                  assistantReply,
                  submitted: true,
                  closeAfterSpeaking: true,
                },
              },
            }],
          });
          // Normal closure is driven by turnComplete plus the drained audio
          // queue. This timeout only recovers a Live session that never ends.
          submissionTimeoutRef.current = window.setTimeout(() => endSession("submitted"), 30_000);
        } catch {
          endSession("submitted");
        }
      } else {
        setOutputCaption(assistantReply);
        endSession("submitted");
      }

      return routedTicket;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [endSession, releaseMicrophone]);

  const processCitizenTurn = useCallback(async (call: VoiceFunctionCall) => {
    const conversationGeneration = conversationGenerationRef.current;
    const callId = call.id || crypto.randomUUID();
    if (handledCallsRef.current.has(callId)) return;
    handledCallsRef.current.add(callId);

    const citizenText = (typeof call.args?.message === "string" ? call.args.message : lastInputRef.current).trim();
    if (!citizenText) {
      sessionRef.current?.sendToolResponse({
        functionResponses: [{ id: call.id, name: call.name, response: { error: "No citizen transcript was received." } }],
      });
      return;
    }

    setState("processing");
    setInputCaption(citizenText);
    setOutputCaption("");
    setMessages((current) => current.at(-1)?.role === "user" && current.at(-1)?.text === citizenText
      ? current
      : [...current, { role: "user", text: citizenText }]);

    try {
      if (
        isConfirmationPhrase(citizenText) &&
        reportIdRef.current &&
        previewRef.current?.readyToConfirm
      ) {
        await submitCurrentReport(call);
        return;
      }

      turnAbortRef.current?.abort();
      const turnController = new AbortController();
      turnAbortRef.current = turnController;
      const response = await fetch("/api/sauti1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: turnController.signal,
        body: JSON.stringify({
          conversationId: conversationIdRef.current,
          reportId: reportIdRef.current,
          message: citizenText,
          source: "voice",
        }),
      });
      const payload = await response.json();
      if (conversationGeneration !== conversationGenerationRef.current) return;
      if (!response.ok) throw new Error(payload.error || "Sauti1 could not process that voice turn.");

      conversationIdRef.current = payload.conversationId;
      setConversationId(payload.conversationId);
      if (payload.report) {
        reportIdRef.current = payload.reportId;
        previewRef.current = payload.report;
        setReportId(payload.reportId);
        setPreview(payload.report);
      }
      setMessages((current) => [...current, { role: "assistant", text: payload.assistantReply }]);

      sessionRef.current?.sendToolResponse({
        functionResponses: [{
          id: call.id,
          name: call.name,
          response: {
            output: {
              assistantReply: payload.assistantReply,
              reportReady: Boolean(payload.report?.readyToConfirm),
              institutionName: payload.report?.institutionName ?? null,
            },
          },
        }],
      });
    } catch (requestError) {
      if (
        conversationGeneration !== conversationGenerationRef.current ||
        (requestError instanceof DOMException && requestError.name === "AbortError")
      ) {
        return;
      }
      const messageText = requestError instanceof Error ? requestError.message : "Sauti1 could not process that voice turn.";
      setError(messageText);
      setState("error");
      sessionRef.current?.sendToolResponse({
        functionResponses: [{ id: call.id, name: call.name, response: { error: messageText } }],
      });
    } finally {
      if (conversationGeneration === conversationGenerationRef.current) {
        turnAbortRef.current = undefined;
      }
    }
  }, [submitCurrentReport]);

  const handleLiveMessage = useCallback((message: LiveServerMessage) => {
    const content = message.serverContent;
    if (content?.interrupted) {
      modelTurnCompleteRef.current = false;
      stopOutput();
      if (!closeAfterReplyRef.current) setState("listening");
      setOutputCaption("");
    }

    const interim = content?.interimInputTranscription?.text?.trim();
    const finalInput = content?.inputTranscription?.text?.trim();
    if (interim) setInputCaption(interim);
    if (finalInput) {
      lastInputRef.current = finalInput;
      setInputCaption(finalInput);
    }

    const output = content?.outputTranscription?.text?.trim();
    if (output) setOutputCaption((current) => `${current} ${output}`.trim());

    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        modelTurnCompleteRef.current = false;
        void playAudio(part.inlineData.data, part.inlineData.mimeType);
      }
    }

    for (const call of message.toolCall?.functionCalls ?? []) {
      if (call.name === "process_citizen_turn") void processCitizenTurn(call);
    }

    if (content?.turnComplete) {
      if (closeAfterReplyRef.current) {
        submissionTurnCompleteRef.current = true;
        finishSpokenSubmission();
      } else if (outputSourcesRef.current.size === 0) {
        modelTurnCompleteRef.current = false;
        setState("listening");
      } else {
        modelTurnCompleteRef.current = true;
      }
    }
  }, [finishSpokenSubmission, playAudio, processCitizenTurn, stopOutput]);

  const attachMicrophone = useCallback(async (stream?: MediaStream) => {
    const activeStream = stream || await requestMicrophone();
    streamRef.current = activeStream;
    const context = inputContextRef.current || new AudioContext({ latencyHint: "interactive" });
    inputContextRef.current = context;
    if (context.state === "suspended") await context.resume();

    const source = context.createMediaStreamSource(activeStream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!sessionRef.current || mutedRef.current) return;
      const pcm = pcm16FromFloat32(event.inputBuffer.getChannelData(0), context.sampleRate);
      sessionRef.current.sendRealtimeInput({ audio: { data: encodeBase64(pcm), mimeType: "audio/pcm;rate=16000" } });
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    inputSourceRef.current = source;
    processorRef.current = processor;
    silentGainRef.current = silentGain;
  }, []);

  async function startSession() {
    if (state === "connecting" || sessionRef.current) return;
    conversationGenerationRef.current += 1;
    setState("connecting");
    setError(undefined);
    setInputCaption("");
    setOutputCaption("");

    try {
      mutedRef.current = false;
      inputContextRef.current = new AudioContext({ latencyHint: "interactive" });
      outputContextRef.current = new AudioContext({ latencyHint: "interactive" });
      await Promise.all([
        inputContextRef.current.resume(),
        outputContextRef.current.resume(),
      ]);
      const stream = await requestMicrophone();
      streamRef.current = stream;

      const tokenResponse = await fetch("/api/sauti1/live-token", { method: "POST" });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenPayload.error || "Could not start Voice Sauti1.");

      const ai = new GoogleGenAI({ apiKey: tokenPayload.token, httpOptions: { apiVersion: "v1alpha" } });
      const session = await ai.live.connect({
        model: tokenPayload.model,
        callbacks: {
          onmessage: handleLiveMessage,
          onerror: () => {
            setError("The live voice connection was interrupted. Start a new voice conversation to continue.");
            endSession("error");
          },
          onclose: () => {
            if (sessionRef.current && mountedRef.current) endSession("ended");
          },
        },
      });
      sessionRef.current = session;
      await attachMicrophone(stream);
      setState("listening");
    } catch (startError) {
      releaseMicrophone(false);
      safelyCloseAudioContext(inputContextRef.current);
      safelyCloseAudioContext(outputContextRef.current);
      inputContextRef.current = undefined;
      outputContextRef.current = undefined;
      setError(startError instanceof Error ? startError.message : "Could not start Voice Sauti1.");
      setState("error");
    }
  }

  async function toggleMute() {
    if (!sessionRef.current) return;
    if (!muted) {
      releaseMicrophone();
      mutedRef.current = true;
      setMuted(true);
      return;
    }
    try {
      mutedRef.current = false;
      await attachMicrophone();
      setMuted(false);
      setState("listening");
    } catch {
      setError("Microphone access was not restored.");
      setState("error");
    }
  }

  async function confirmReport() {
    if (!reportIdRef.current || !previewRef.current?.readyToConfirm || submittingRef.current) return;
    try {
      await submitCurrentReport();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Sauti1 could not submit this report.");
    }
  }

  function clearConversationData() {
    ticketPollAbortRef.current?.abort();
    ticketPollAbortRef.current = undefined;
    setMessages([welcomeMessage]);
    setConversationId(undefined);
    setReportId(undefined);
    setPreview(undefined);
    setTicket(undefined);
    setInputCaption("");
    setOutputCaption("");
    setError(undefined);
    conversationIdRef.current = undefined;
    reportIdRef.current = undefined;
    previewRef.current = undefined;
    handledCallsRef.current.clear();
    submittingRef.current = false;
  }

  function resetConversation() {
    conversationGenerationRef.current += 1;
    turnAbortRef.current?.abort();
    turnAbortRef.current = undefined;
    endSession("idle");
    clearConversationData();
  }

  async function cancelConversation() {
    const activeConversationId = conversationIdRef.current;
    conversationGenerationRef.current += 1;
    const cancellationGeneration = conversationGenerationRef.current;
    turnAbortRef.current?.abort();
    turnAbortRef.current = undefined;
    endSession("ended");
    clearConversationData();

    if (!activeConversationId) return;

    try {
      const response = await fetch("/api/sauti1/cancel-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversationId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The voice conversation could not be cleared.");
    } catch (cancelError) {
      if (cancellationGeneration === conversationGenerationRef.current) {
        setError(cancelError instanceof Error ? cancelError.message : "The voice conversation could not be cleared.");
      }
    }
  }

  useEffect(() => {
    if (!ticket?.ticket_id || ["resolved", "closed", "rejected"].includes(ticket.ticket_status || "")) return;
    const ticketId = ticket.ticket_id;
    const conversationGeneration = conversationGenerationRef.current;
    const controller = new AbortController();
    ticketPollAbortRef.current?.abort();
    ticketPollAbortRef.current = controller;
    let timeoutId: number | undefined;

    async function refreshTicket() {
      try {
        const response = await fetch(`/api/sauti1/ticket-status?ticketId=${ticketId}`, {
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;
        const payload = await response.json();
        if (
          controller.signal.aborted ||
          conversationGeneration !== conversationGenerationRef.current
        ) {
          return;
        }

        const updated = payload.ticket;
        const institution = relatedRecord<{ name: string; short_name: string | null }>(updated.institutions);
        const latestEvent = relatedRecord<{ note: string | null }>(updated.ticket_events);
        setTicket((current) => current?.ticket_id === ticketId
          ? {
              ticket_id: updated.id,
              ticket_code: updated.ticket_code,
              ticket_status: updated.status,
              acknowledged_at: updated.acknowledged_at,
              institution_name: institution?.short_name || institution?.name,
              acknowledgement_note: latestEvent?.note,
            }
          : current);
      } catch (pollError) {
        if (!(pollError instanceof DOMException && pollError.name === "AbortError")) {
          console.warn("Could not refresh the voice ticket status.", pollError);
        }
      } finally {
        if (
          !controller.signal.aborted &&
          conversationGeneration === conversationGenerationRef.current
        ) {
          timeoutId = window.setTimeout(refreshTicket, 5000);
        }
      }
    }

    timeoutId = window.setTimeout(refreshTicket, 5000);
    return () => {
      controller.abort();
      if (timeoutId) window.clearTimeout(timeoutId);
      if (ticketPollAbortRef.current === controller) ticketPollAbortRef.current = undefined;
    };
  }, [ticket?.ticket_id, ticket?.ticket_status]);

  const statusText = state === "connecting" ? "Connecting securely"
    : state === "listening" ? (muted ? "Microphone muted" : "Sauti1 is listening")
      : state === "processing" ? "Understanding your request"
        : state === "speaking" ? "Sauti1 is speaking"
          : state === "submitted" ? "Report submitted"
            : state === "ended" ? "Voice conversation ended"
              : state === "error" ? "Voice needs attention"
                : "Voice Sauti1 is ready";

  return (
    <div className="voice-page">
      <div className="grid h-full w-full max-w-[1120px] min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
        <section className="flex min-h-0 flex-col items-center overflow-hidden rounded-[8px] border border-[#e3e7ef] bg-white px-4 py-4 sm:px-6">
          <div className="voice-status shrink-0"><span className={`online-dot ${state === "error" ? "!bg-[#d94b45]" : ""}`} />{statusText}</div>
          <p className="voice-hint shrink-0 text-center">Speak naturally. Sauti1 will finish each reply before listening for the next detail.</p>

          <div className="min-h-0 w-full flex-1 overflow-y-auto px-1">
            <div className={`sauti-core-wrap mx-auto !w-[min(300px,58vw)] ${["listening", "speaking", "processing"].includes(state) ? "is-active" : ""}`} aria-label={statusText}>
              <div className="sauti-core-ring2" /><div className="sauti-core-ring" />
              <div className="sauti-core"><div className="core-dots" /><div className="core-wave" /></div>
            </div>

            <div className="mx-auto -mt-3 max-w-[650px] space-y-2 text-center" aria-live="polite">
              {inputCaption && <p className="text-[12px] leading-5 text-[#66738a]"><span className="font-bold text-[#273650]">You:</span> {inputCaption}</p>}
              {outputCaption && <p className="text-[12px] leading-5 text-[#33425c]"><span className="font-bold text-[#1d5eff]">Sauti1:</span> {outputCaption}</p>}
              {!inputCaption && !outputCaption && <p className="text-[12px] text-[#8b95a6]">Your live conversation will appear here as you speak.</p>}
            </div>
          </div>

          {error && <div className="my-2 w-full max-w-[650px] rounded-[8px] bg-[#fff1f0] px-3 py-2 text-center text-[11px] font-semibold text-[#a53b35]" role="alert">{error}</div>}

          <div className="flex shrink-0 items-center justify-center gap-3 pt-3">
            {state === "idle" || state === "ended" || state === "error" ? (
              <button className="inline-flex h-12 items-center gap-2 rounded-[8px] bg-[#155dff] px-5 text-[12px] font-bold text-white" onClick={startSession} type="button"><Mic2 size={18} /> Start live voice</button>
            ) : state === "submitted" ? (
              <button className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-[#155dff] px-4 text-[11px] font-bold text-white" onClick={resetConversation} type="button"><RotateCcw size={16} /> Start a new call</button>
            ) : (
              <>
                <button aria-label={muted ? "Unmute microphone" : "Mute microphone"} className="grid h-11 w-11 place-items-center rounded-full border border-[#dbe2ec] bg-white text-[#24334f]" onClick={toggleMute} title={muted ? "Unmute microphone" : "Mute microphone"} type="button">{muted ? <MicOff size={19} /> : <Mic2 size={19} />}</button>
                <button aria-label="End and discard voice conversation" className="grid h-12 w-12 place-items-center rounded-full bg-[#d94b45] text-white" onClick={() => void cancelConversation()} title="End and discard voice conversation" type="button"><PhoneOff size={20} /></button>
                <span className="grid h-11 w-11 place-items-center rounded-full bg-[#edf3ff] text-[#1d5eff]" title="Full duplex audio">{state === "connecting" || state === "processing" ? <Loader2 className="animate-spin" size={19} /> : <Volume2 size={19} />}</span>
              </>
            )}
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto rounded-[8px] border border-[#e3e7ef] bg-white p-4">
          <h2 className="text-[14px] font-bold">Voice report</h2>
          {ticket ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-[8px] bg-[#edf8f3] p-3"><CheckCircle2 className="text-[#087a50]" size={20} /><p className="mt-2 text-[12px] font-bold">{ticket.ticket_code}</p><p className="mt-1 text-[10px] leading-4 text-[#567063]">Sent to {ticket.institution_name}. Status: {(ticket.ticket_status || "routed").replaceAll("_", " ")}.</p></div>
              {ticket.acknowledgement_note && <p className="rounded-[8px] border border-[#dce5df] p-3 text-[10px] leading-4 text-[#3f554a]">{ticket.acknowledgement_note}</p>}
              <Link className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-[#dbe2ec] text-[11px] font-bold text-[#33425c]" href={`/track/${ticket.ticket_id}`}><TicketCheck size={14} /> Track ticket</Link>
            </div>
          ) : preview ? (
            <div className="mt-4 space-y-3">
              <div><p className="text-[9px] font-bold uppercase text-[#7f8a9c]">SAUTI1 understanding</p><h3 className="mt-1 text-[15px] font-bold leading-5">{preview.title}</h3></div>
              <dl className="space-y-2.5 border-y border-[#edf0f4] py-3 text-[10px]">
                <div className="flex justify-between gap-3"><dt className="text-[#778399]">Institution</dt><dd className="text-right font-bold">{preview.institutionName}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#778399]">Priority</dt><dd className="font-bold">{preview.priority}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#778399]">Location</dt><dd className="max-w-[170px] text-right font-bold">{preview.locationText || "Not provided"}</dd></div>
                {Object.entries(preview.intakeData ?? {})
                  .filter(([key]) => ![
                    "location",
                    "incident_description",
                    "document_issue",
                    "location_verification",
                    "location_source_url",
                    "current_location_verification",
                    "current_location_source_url",
                    "current_location_latitude",
                    "current_location_longitude",
                  ].includes(key))
                  .map(([key, value]) => <div className="flex justify-between gap-3" key={key}><dt className="text-[#778399]">{intakeFieldLabel(key)}</dt><dd className="max-w-[170px] text-right font-bold">{value}</dd></div>)}
              </dl>
              <p className="text-[10px] leading-4 text-[#66738a]">{preview.summary}</p>
              {(preview.missingFields ?? []).length > 0 && <p className="rounded-[8px] bg-[#fff7e8] p-3 text-[9px] leading-4 text-[#76511f]">Still needed: {preview.missingFields.map(intakeFieldLabel).join(", ")}.</p>}
              {preview.readyToConfirm ? (
                <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-[#155dff] text-[11px] font-bold text-white disabled:opacity-60" disabled={submitting} onClick={confirmReport} type="button">{submitting ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />} {submitting ? "Submitting..." : "Confirm and submit"}</button>
              ) : <p className="rounded-[8px] bg-[#f5f7fa] p-3 text-[9px] leading-4 text-[#778399]">Keep speaking so Sauti1 can complete the report details.</p>}
            </div>
          ) : (
            <div className="mt-4 rounded-[8px] bg-[#f5f7fa] p-3 text-[10px] leading-5 text-[#748095]">Your report summary will appear here while the live conversation continues.</div>
          )}

          <div className="mt-5 border-t border-[#edf0f4] pt-4">
            <h3 className="text-[10px] font-bold uppercase text-[#7f8a9c]">Voice transcript</h3>
            <div className="mt-3 space-y-2">
              {messages.slice(-8).map((message, index) => <div className={`rounded-[8px] px-2.5 py-2 text-[9px] leading-4 ${message.role === "user" ? "bg-[#eaf1ff] text-[#24406e]" : "bg-[#f5f7fa] text-[#56647a]"}`} key={`${message.role}-${index}`}>{message.text}</div>)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
