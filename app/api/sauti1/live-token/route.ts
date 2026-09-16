import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
} from "@google/genai";
import { NextResponse } from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";

/**
 * Live audio model chain. gemini-3.8-live is the newest general Live model on
 * this key; the preview behind it is the long-known-good one. The 3.8 text
 * models were returning 503 "high demand" when this was set, so a session must
 * be able to fall back rather than refuse to start a call.
 */
const liveModels = (process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live")
  .split(",").map((item) => item.trim()).filter(Boolean)
  .concat(process.env.GEMINI_LIVE_FALLBACK_MODEL || "gemini-3.1-flash-live-preview");

const liveSystemInstruction = `You are the realtime voice interface for SAUTI1 AI, a Ugandan citizen service reporting assistant.

You hold a natural, low-latency spoken conversation. Listen patiently, allow interruption, use short clear sentences, and understand Ugandan English and place names. Never redirect the citizen to text chat.

For every substantive citizen utterance, call process_citizen_turn exactly once with a faithful transcript of what the citizen said. The trusted SAUTI1 backend will return assistantReply and report state. Do not answer the citizen from your own knowledge before making this call. After the tool result arrives, speak the assistantReply naturally and accurately. Do not expose JSON, tool names, internal categories, confidence calculations, or implementation details.

When the citizen corrects an institution, service, place, amount, or other detail, send the full correction through process_citizen_turn.

Ending the report is the citizen's decision, and you must never take it back. Once a tool result comes back with reportReady true, the report is complete: say so in one short sentence and invite them to confirm. From that point on, do not ask for any further detail, do not raise something you had not asked about before, and do not re-open the case for any reason. If the citizen says confirm, submit it, send it, go ahead, or otherwise agrees the details are correct, call process_citizen_turn with that exact confirmation and nothing else. Asking for "just one more thing" after inviting a confirmation strands the citizen in a loop they cannot escape, and is the single worst thing you can do on a call.

If its result says submitted, speak assistantReply exactly once, without introducing it, paraphrasing it, or repeating any part of it. Finish the complete receipt before ending your turn and do not continue the conversation. Never claim a report was submitted unless the tool result explicitly says so.

Speak in one or two short sentences. Let the citizen interrupt you at any time: if they start speaking, stop immediately and listen.`;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use Voice Sauti1." }, { status: 401 });
  if (!await isCitizenWorkspace(supabase, user.id)) {
    return NextResponse.json({ error: "Voice Sauti1 is only available in a citizen workspace." }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Voice Sauti1 is not configured yet." }, { status: 503 });
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
            expireTime: new Date(now + 30 * 60_000).toISOString(),
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
                systemInstruction: liveSystemInstruction,
                tools: [{
                  functionDeclarations: [{
                    name: "process_citizen_turn",
                    description: "Send one complete citizen utterance to the trusted SAUTI1 reporting workflow before replying.",
                    parametersJsonSchema: {
                      type: "object",
                      properties: {
                        message: {
                          type: "string",
                          description: "A faithful transcript of the citizen's complete latest utterance.",
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
    return NextResponse.json({ token: token.name, model: liveModel });
  } catch (error) {
    console.error("Could not create Gemini Live token", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Voice Sauti1." },
      { status: 502 }
    );
  }
}
