import {
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
} from "@google/genai";
import { NextResponse } from "next/server";

import { isCitizenWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";

const liveModel = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";

const liveSystemInstruction = `You are the realtime voice interface for SAUTI1 AI, a Ugandan citizen service reporting assistant.

You hold a natural, low-latency spoken conversation. Listen patiently, allow interruption, use short clear sentences, and understand Ugandan English and place names. Never redirect the citizen to text chat.

For every substantive citizen utterance, call process_citizen_turn exactly once with a faithful transcript of what the citizen said. The trusted SAUTI1 backend will return assistantReply and report state. Do not answer the citizen from your own knowledge before making this call. After the tool result arrives, speak the assistantReply naturally and accurately. Do not expose JSON, tool names, internal categories, confidence calculations, or implementation details.

When the citizen corrects an institution, service, place, amount, or other detail, send the full correction through process_citizen_turn. When the backend says the report is ready, tell the citizen they can confirm either by speaking or by using the confirmation control. If the citizen then says confirm, submit it, send it, go ahead, or clearly agrees that the details are correct, call process_citizen_turn with that exact confirmation. If its result says submitted, speak assistantReply exactly once, without introducing it, paraphrasing it, or repeating any part of it. Finish the complete receipt before ending your turn and do not continue the conversation. Never claim a report was submitted unless the tool result explicitly says so.`;

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
    const token = await ai.authTokens.create({
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
              automaticActivityDetection: {
                startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                prefixPaddingMs: 80,
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

    if (!token.name) throw new Error("Gemini did not return a Live session token.");
    return NextResponse.json({ token: token.name, model: liveModel });
  } catch (error) {
    console.error("Could not create Gemini Live token", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Voice Sauti1." },
      { status: 502 }
    );
  }
}
