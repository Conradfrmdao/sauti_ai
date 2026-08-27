import {
  ActivityHandling,
  EndSensitivity,
  type FunctionCall,
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  type Session,
  StartSensitivity,
} from "@google/genai";
import { experimental_upgradeWebSocket, type WebSocket } from "@vercel/functions";

import { geminiPcm24kToTwilioMulaw8k, twilioMulaw8kToGeminiPcm16k } from "@/lib/channels/audio-codecs";
import { publicHttpsUrl, publicWebSocketUrl } from "@/lib/channels/public-url";
import { validateTwilioSignature } from "@/lib/channels/twilio";
import {
  parseTwilioMediaEvent,
  twilioClearAudio,
  twilioOutboundMedia,
  twilioPlaybackMark,
} from "@/lib/channels/twilio-media";
import { validateTwilioStreamToken } from "@/lib/channels/twilio-voice";
import { processChannelTurn, updateChannelSessionStatus } from "@/lib/sauti1/channel-conversation";

export const runtime = "nodejs";
export const maxDuration = 300;

const liveModel = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const systemInstruction = `You are SAUTI1's telephone voice interface. Speak briefly and clearly. On [CALL_START], greet the caller and ask what public-service problem they want to report; do not call a tool for that control message. For every real caller utterance, call process_citizen_turn exactly once with a faithful transcript before answering. Speak only the returned assistantReply. Never invent submission. If the tool returns submitted, speak the complete receipt once.`;

function sendWhenOpen(ws: WebSocket, body: string) {
  if (ws.readyState === 1) ws.send(body);
}

export async function GET(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const signature = request.headers.get("x-twilio-signature");
  const wssUrl = publicWebSocketUrl(request, "/api/voice/twilio/media", process.env.TWILIO_WEBHOOK_BASE_URL);
  const httpsUrl = publicHttpsUrl(request, "/api/voice/twilio/media", process.env.TWILIO_WEBHOOK_BASE_URL);
  if (!authToken || !process.env.GEMINI_API_KEY || !wssUrl || !httpsUrl) {
    return new Response("Voice media is not configured.", { status: 503 });
  }
  if (!signature || (!validateTwilioSignature(authToken, signature, wssUrl) &&
      !validateTwilioSignature(authToken, signature, httpsUrl))) {
    return new Response("Unauthorized.", { status: 403 });
  }

  return experimental_upgradeWebSocket(async (ws) => {
    let gemini: Session | null = null;
    let streamSid = "";
    let callSid = "";
    let caller = "";
    let authenticated = false;
    let closeAfterReply = false;
    let stopped = false;
    const queuedAudio: string[] = [];
    let turnQueue = Promise.resolve();
    const handleToolCall = async (call: FunctionCall) => {
      if (call.name !== "process_citizen_turn" || !authenticated) return;
      const args = call.args as Record<string, unknown> | undefined;
      const message = typeof args?.message === "string" ? args.message.trim() : "";
      if (!message) {
        gemini?.sendToolResponse({ functionResponses: [{
          id: call.id, name: call.name, response: { error: "No caller transcript was received." },
        }] });
        return;
      }
      const callId = call.id || crypto.randomUUID();
      try {
        const result = await processChannelTurn({
          phoneE164: caller,
          channel: "phone",
          provider: "twilio",
          providerConversationId: callSid,
          providerMessageId: `gemini:${callId}`,
          message,
          eventId: `turn:${callSid}:${callId}`,
          eventType: "voice.turn",
          rawEvent: { callId, message },
        });
        closeAfterReply = Boolean(result.ticket);
        gemini?.sendToolResponse({ functionResponses: [{
          id: call.id, name: call.name,
          response: { output: {
            assistantReply: result.assistantReply || "That turn was already processed.",
            reportReady: Boolean(result.report?.readyToConfirm),
            submitted: Boolean(result.ticket),
          } },
        }] });
      } catch (error) {
        gemini?.sendToolResponse({ functionResponses: [{
          id: call.id, name: call.name,
          response: { error: error instanceof Error ? error.message : "SAUTI1 could not process the caller." },
        }] });
      }
    };
    const handleGeminiMessage = (message: LiveServerMessage) => {
      const content = message.serverContent;
      if (content?.interrupted && streamSid) {
        sendWhenOpen(ws, twilioClearAudio(streamSid));
      }
      for (const part of content?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
          const audio = geminiPcm24kToTwilioMulaw8k(part.inlineData.data);
          sendWhenOpen(ws, twilioOutboundMedia(streamSid, audio));
        }
      }
      for (const call of message.toolCall?.functionCalls ?? []) {
        turnQueue = turnQueue.then(() => handleToolCall(call)).catch(() => undefined);
      }
      if (content?.turnComplete && closeAfterReply && streamSid) {
        sendWhenOpen(ws, twilioPlaybackMark(streamSid, "submitted"));
      }
    };
    const connectGemini = async () => {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { apiVersion: "v1alpha" },
      });
      gemini = await ai.live.connect({
        model: liveModel,
        config: {
          responseModalities: [Modality.AUDIO],
          temperature: 0.35,
          speechConfig: {
            languageCode: "en-US",
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
          realtimeInputConfig: {
            activityHandling: ActivityHandling.NO_INTERRUPTION,
            automaticActivityDetection: {
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 300,
              silenceDurationMs: 650,
            },
          },
          tools: [{ functionDeclarations: [{
            name: "process_citizen_turn",
            description: "Send one complete caller utterance to SAUTI1 before replying.",
            parametersJsonSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
              additionalProperties: false,
            },
          }] }],
        },
        callbacks: {
          onmessage: handleGeminiMessage,
          onerror: () => { if (!stopped) ws.close(1011, "Voice AI connection failed"); },
          onclose: () => { if (!stopped) ws.close(1011, "Voice AI connection closed"); },
        },
      });
      for (const audio of queuedAudio.splice(0)) {
        gemini.sendRealtimeInput({
          audio: { data: audio, mimeType: "audio/pcm;rate=16000" },
        });
      }
      gemini.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "[CALL_START]" }] }],
        turnComplete: true,
      });
    };
    ws.on("message", (raw) => {
      try {
        const event = parseTwilioMediaEvent(raw);
        if (event.event === "start") {
          if (authenticated) throw new Error("Duplicate Twilio start event.");
          const params = event.start.customParameters;
          const parameterCallSid = params.CallSid || "";
          const parameterCaller = params.Caller || "";
          const accountSid = process.env.TWILIO_ACCOUNT_SID || event.start.accountSid;
          const format = event.start.mediaFormat;
          if (event.start.accountSid !== accountSid || event.start.callSid !== parameterCallSid ||
              format.encoding !== "audio/x-mulaw" || format.sampleRate !== 8000 || format.channels !== 1 ||
              !validateTwilioStreamToken(params.SessionToken || "", parameterCallSid, parameterCaller)) {
            throw new Error("Twilio start authentication failed.");
          }
          streamSid = event.start.streamSid;
          callSid = parameterCallSid;
          caller = parameterCaller;
          authenticated = true;
          void updateChannelSessionStatus({
            provider: "twilio", providerConversationId: callSid, status: "streaming",
          });
          void connectGemini().catch(() => ws.close(1011, "Voice AI unavailable"));
          return;
        }
        if (!authenticated) throw new Error("Twilio stream was not authenticated.");
        if (event.event === "media" && event.media.track !== "outbound") {
          const audio = twilioMulaw8kToGeminiPcm16k(event.media.payload);
          if (gemini) gemini.sendRealtimeInput({
            audio: { data: audio, mimeType: "audio/pcm;rate=16000" },
          });
          else if (queuedAudio.length < 50) queuedAudio.push(audio);
        }
        if (event.event === "mark" && closeAfterReply) ws.close(1000, "Report submitted");
        if (event.event === "stop") ws.close(1000, "Call stopped");
      } catch {
        ws.close(1008, "Invalid media event");
      }
    });
    ws.on("close", () => {
      stopped = true;
      if (gemini) {
        try { gemini.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* already closed */ }
        try { gemini.close(); } catch { /* already closed */ }
      }
      if (callSid) void updateChannelSessionStatus({
        provider: "twilio",
        providerConversationId: callSid,
        status: closeAfterReply ? "submitted" : "ended",
        close: true,
      });
    });
    ws.on("error", () => {
      if (ws.readyState === 1) ws.close(1011, "Media stream error");
    });
  }, { maxPayload: 64 * 1024 });
}
