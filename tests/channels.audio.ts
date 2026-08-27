import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  GEMINI_INPUT_PCM_SAMPLE_RATE,
  GEMINI_OUTPUT_PCM_SAMPLE_RATE,
  TWILIO_MULAW_SAMPLE_RATE,
  geminiPcm24kToTwilioMulaw8k,
  twilioMulaw8kToGeminiPcm16k,
} from "../lib/channels/audio-codecs";

function pcm16Base64(samples: readonly number[]): string {
  const buffer = Buffer.alloc(samples.length * 2);

  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer.toString("base64");
}

function pcm16Samples(base64Audio: string): number[] {
  const buffer = Buffer.from(base64Audio, "base64");
  const samples: number[] = [];

  for (let offset = 0; offset < buffer.length; offset += 2) {
    samples.push(buffer.readInt16LE(offset));
  }

  return samples;
}

assert.equal(TWILIO_MULAW_SAMPLE_RATE, 8_000);
assert.equal(GEMINI_INPUT_PCM_SAMPLE_RATE, 16_000);
assert.equal(GEMINI_OUTPUT_PCM_SAMPLE_RATE, 24_000);

// Canonical G.711 mu-law vectors and the exact 2:1 interpolation rule.
const decodedKnownValues = twilioMulaw8kToGeminiPcm16k(
  Buffer.from([0x00, 0x80, 0xff, 0x7f]).toString("base64")
);
assert.deepEqual(pcm16Samples(decodedKnownValues), [
  -32_124,
  0,
  32_124,
  16_062,
  0,
  0,
  0,
  0,
]);

// A Twilio 20 ms frame has 160 samples and becomes 320 headerless PCM samples.
const twilioSilence = Buffer.alloc(160, 0xff).toString("base64");
const geminiSilence = Buffer.from(
  twilioMulaw8kToGeminiPcm16k(twilioSilence),
  "base64"
);
assert.equal(geminiSilence.length, 320 * 2);
assert.ok(geminiSilence.every((byte) => byte === 0));

// Saturation at both PCM16 limits maps to the standard mu-law endpoints.
assert.deepEqual(
  [
    ...Buffer.from(
      geminiPcm24kToTwilioMulaw8k(
        pcm16Base64([
          32_767,
          32_767,
          32_767,
          -32_768,
          -32_768,
          -32_768,
          0,
          0,
          0,
        ])
      ),
      "base64"
    ),
  ],
  [0x80, 0x00, 0xff]
);

// A Gemini 20 ms frame has 480 samples and becomes 160 headerless mu-law bytes.
const pcmSilence = pcm16Base64(new Array<number>(480).fill(0));
const twilioSilenceResult = Buffer.from(
  geminiPcm24kToTwilioMulaw8k(pcmSilence),
  "base64"
);
assert.equal(twilioSilenceResult.length, 160);
assert.ok(twilioSilenceResult.every((byte) => byte === 0xff));

// Downsampling averages each group instead of selecting an alias-prone sample.
const averaged = Buffer.from(
  geminiPcm24kToTwilioMulaw8k(pcm16Base64([3_000, -3_000, 0])),
  "base64"
);
assert.deepEqual([...averaged], [0xff]);

// A partial terminal group is preserved, which is useful for a final short chunk.
const partial = Buffer.from(
  geminiPcm24kToTwilioMulaw8k(pcm16Base64([0, 0, 0, 1_000])),
  "base64"
);
assert.equal(partial.length, 2);
assert.equal(partial[0], 0xff);
assert.notEqual(partial[1], 0xff);

// Every mu-law code survives decode/re-encode; 0x7f canonicalizes to 0xff
// because G.711 defines both as zero and the encoder emits positive silence.
const everyMulawCode = Buffer.from(Array.from({ length: 256 }, (_, code) => code));
const everyDecodedSample = pcm16Samples(
  twilioMulaw8kToGeminiPcm16k(everyMulawCode.toString('base64'))
).filter((_, index) => index % 2 === 0);
const expandedFor24k = everyDecodedSample.flatMap((sample) => [sample, sample, sample]);
const everyReencodedCode = Buffer.from(
  geminiPcm24kToTwilioMulaw8k(pcm16Base64(expandedFor24k)),
  'base64'
);
const canonicalCodes = Buffer.from(
  Array.from({ length: 256 }, (_, code) => (code === 0x7f ? 0xff : code))
);
assert.deepEqual(everyReencodedCode, canonicalCodes);

// Conversion is stateless and deterministic.
assert.equal(
  geminiPcm24kToTwilioMulaw8k(pcmSilence),
  geminiPcm24kToTwilioMulaw8k(pcmSilence)
);
assert.equal(twilioMulaw8kToGeminiPcm16k(""), "");
assert.equal(geminiPcm24kToTwilioMulaw8k(""), "");

for (const invalid of [
  "not base64",
  "AA",
  "AA=A",
  "AB==",
  "data:audio/basic;base64,/w==",
]) {
  assert.throws(
    () => twilioMulaw8kToGeminiPcm16k(invalid),
    /canonical RFC 4648 base64/
  );
}

assert.throws(
  () => twilioMulaw8kToGeminiPcm16k(undefined as unknown as string),
  /base64 string/
);
assert.throws(
  () => geminiPcm24kToTwilioMulaw8k(Buffer.from([0]).toString("base64")),
  /whole number of 16-bit samples/
);

console.log("Channel audio codec checks passed.");
