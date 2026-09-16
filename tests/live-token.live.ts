/**
 * Checks that each Live audio model actually accepts SAUTI1's session config
 * (barge-in, transcription, the process_citizen_turn tool). Creating the
 * ephemeral token is the same call the voice routes make, so a model that
 * fails here would fail a real call. Opt-in: uses live quota.
 */
import { readFileSync } from "node:fs";
import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
} from "@google/genai";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "gemini-3.8-live",
      "gemini-3.1-flash-live-preview",
      "gemini-2.5-flash-native-audio-latest",
      "gemini-3.8-live-extended-thinking",
    ];

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: "v1alpha" },
});

for (const model of candidates) {
  const started = Date.now();
  const now = Date.now();
  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        expireTime: new Date(now + 10 * 60_000).toISOString(),
        liveConnectConstraints: {
          model,
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
              activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
              automaticActivityDetection: {
                startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                prefixPaddingMs: 200,
                silenceDurationMs: 450,
              },
            },
            systemInstruction: "You are SAUTI1's voice interface.",
            tools: [{
              functionDeclarations: [{
                name: "process_citizen_turn",
                description: "Send one complete citizen utterance to the SAUTI1 workflow.",
                parametersJsonSchema: {
                  type: "object",
                  properties: { message: { type: "string" } },
                  required: ["message"],
                  additionalProperties: false,
                },
              }],
            }],
          },
        },
      },
    } as Parameters<typeof ai.authTokens.create>[0]);

    console.log(`OK    ${model.padEnd(42)} ${Date.now() - started}ms  token=${token.name ? "issued" : "MISSING"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${model.padEnd(42)} ${Date.now() - started}ms  ${message.replace(/\s+/g, " ").slice(0, 160)}`);
  }
}
