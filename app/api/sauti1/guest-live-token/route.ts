import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
} from "@google/genai";
import { NextResponse } from "next/server";

/**
 * Live audio model chain.
 *
 * gemini-3.1-flash-live-preview is the trusted default: gemini-3.8-live was
 * tried in production and was slower and noticeably worse at following the
 * conversation, so newness is not the deciding factor here. The chain exists so
 * an overloaded model degrades to a working call rather than refusing to start
 * one; the fallback is always appended.
 */
const liveModels = (process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview")
  .split(",").map((item) => item.trim()).filter(Boolean)
  .concat(process.env.GEMINI_LIVE_FALLBACK_MODEL || "gemini-2.5-flash-native-audio-latest");
const guestWindowMs = 10 * 60 * 1000;
const guestSessionLimit = 4;
const guestSessionBuckets = new Map<string, { count: number; resetAt: number }>();

const guestLiveSystemInstruction = `You are the realtime guest voice interface for SAUTI1 AI, a Ugandan citizen service reporting assistant.

Hold a natural, low-latency spoken conversation. Listen patiently, use short clear sentences, and understand Ugandan English, abbreviations and place names. Never redirect the guest to text chat.

For every substantive guest utterance, call process_citizen_turn exactly once with a faithful transcript of the complete utterance. The trusted SAUTI1 backend will return assistantReply and conversation context. Do not answer from your own knowledge before making this call. After the tool result arrives, speak assistantReply naturally and accurately. Do not expose JSON, tool names, internal categories, confidence calculations or implementation details.

This is a guest conversation. It is never saved or submitted. Never claim that a report was saved, submitted or routed. When the backend asks the guest to sign in, explain that signing in lets them securely continue, submit and track the report. Never ask for passwords, PINs, authentication codes, complete payment-card numbers or other secrets.

Speak in one or two short sentences. Let the guest interrupt you at any time: if they start speaking, stop immediately and listen. Never keep asking for more detail once the backend has stopped asking for it.`;

function noStoreJson(body: Record<string, string>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return process.env.NODE_ENV !== "production";

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(bytes).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withinGuestSessionLimit(request: Request) {
  const now = Date.now();
  const key = await requestFingerprint(request);
  const existing = guestSessionBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    guestSessionBuckets.set(key, { count: 1, resetAt: now + guestWindowMs });
    return true;
  }
  if (existing.count >= guestSessionLimit) return false;
  existing.count += 1;
  return true;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return noStoreJson({ error: "Guest Voice must start on SAUTI1." }, 403);
  }
  if (!await withinGuestSessionLimit(request)) {
    return noStoreJson({ error: "You have reached the guest voice limit. Sign in to continue with Sauti1." }, 429);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return noStoreJson({ error: "Guest Voice is not configured yet." }, 503);
  }

  try {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const now = Date.now();
    let token: Awaited<ReturnType<typeof ai.authTokens.create>> | undefined;
    let liveModel = liveModels[0];
    let lastError: unknown;

    for (const candidate of liveModels) {
      liveModel = candidate;
      try {
        token = await ai.authTokens.create({
          config: {
            uses: 1,
            newSessionExpireTime: new Date(now + 60_000).toISOString(),
            expireTime: new Date(now + 15 * 60_000).toISOString(),
            liveConnectConstraints: {
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
                realtimeInputConfig: {
                  // Barge-in. NO_INTERRUPTION made the assistant talk over the
                  // citizen and ignore them until it had finished its own turn.
                  activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
                  automaticActivityDetection: {
                    // HIGH on both ends: notice the citizen has started speaking
                    // sooner, and decide they have finished sooner. LOW added
                    // seconds of dead air before the turn even began.
                    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                    prefixPaddingMs: 200,
                    silenceDurationMs: 450,
                  },
                },
                systemInstruction: guestLiveSystemInstruction,
                tools: [{
                  functionDeclarations: [{
                    name: "process_citizen_turn",
                    description: "Send one complete guest utterance to the trusted SAUTI1 workflow before replying.",
                    parametersJsonSchema: {
                      type: "object",
                      properties: {
                        message: {
                          type: "string",
                          description: "A faithful transcript of the guest's complete latest utterance.",
                        },
                      },
                      required: ["message"],
                      additionalProperties: false,
                    },
                  }],
                }],
              },
            },
          },
        });

        break;
      } catch (error) {
        lastError = error;
        console.warn(`Live model ${candidate} unavailable; trying the next.`,
          error instanceof Error ? error.message.slice(0, 200) : String(error));
      }
    }

    if (!token?.name) throw lastError ?? new Error("Gemini did not return a Live session token.");
    return noStoreJson({ token: token.name, model: liveModel });
  } catch (error) {
    console.error("Could not create guest Gemini Live token", error);
    return noStoreJson(
      { error: error instanceof Error ? error.message : "Could not start Guest Voice." },
      502
    );
  }
}
