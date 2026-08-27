import { Buffer } from "node:buffer";

export const TWILIO_MULAW_SAMPLE_RATE = 8_000;
export const GEMINI_INPUT_PCM_SAMPLE_RATE = 16_000;
export const GEMINI_OUTPUT_PCM_SAMPLE_RATE = 24_000;

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32_635;
const PCM16_MIN = -32_768;
const PCM16_MAX = 32_767;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeCanonicalBase64(value: string, label: string): Buffer {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a base64 string.`);
  }

  if (value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) {
    throw new TypeError(`${label} must be canonical RFC 4648 base64.`);
  }

  const bytes = Buffer.from(value, "base64");

  // Buffer's decoder is intentionally permissive, so verify the canonical
  // representation to reject invalid padding bits and other ambiguous input.
  if (bytes.toString("base64") !== value) {
    throw new TypeError(`${label} must be canonical RFC 4648 base64.`);
  }

  return bytes;
}

function saturatePcm16(sample: number): number {
  if (!Number.isFinite(sample)) {
    throw new TypeError("PCM sample must be a finite number.");
  }

  return Math.max(PCM16_MIN, Math.min(PCM16_MAX, Math.round(sample)));
}

function decodeMulawSample(encoded: number): number {
  const value = (~encoded) & 0xff;
  const sign = value & 0x80;
  const exponent = (value >>> 4) & 0x07;
  const mantissa = value & 0x0f;
  const magnitude = ((mantissa << 3) + MULAW_BIAS) * (1 << exponent) - MULAW_BIAS;

  return sign === 0 ? magnitude : -magnitude;
}

function encodeMulawSample(sample: number): number {
  const saturated = saturatePcm16(sample);
  const sign = saturated < 0 ? 0x80 : 0;
  const magnitude = Math.min(Math.abs(saturated), MULAW_CLIP) + MULAW_BIAS;
  const exponent = Math.max(0, Math.min(7, Math.floor(Math.log2(magnitude)) - 7));
  const mantissa = (magnitude >>> (exponent + 3)) & 0x0f;

  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

/**
 * Converts Twilio Media Streams audio (headerless G.711 mu-law, 8 kHz, mono)
 * to Gemini input audio (headerless signed PCM16 LE, 16 kHz, mono).
 *
 * Linear interpolation doubles the sample rate. Each input sample is emitted
 * first, followed by its midpoint with the next input sample. The final sample
 * is repeated because this stateless converter cannot inspect the next frame.
 */
export function twilioMulaw8kToGeminiPcm16k(base64Audio: string): string {
  const mulaw = decodeCanonicalBase64(base64Audio, "Twilio audio");
  const pcm = Buffer.allocUnsafe(mulaw.length * 2 * Int16Array.BYTES_PER_ELEMENT);

  for (let inputIndex = 0; inputIndex < mulaw.length; inputIndex += 1) {
    const current = decodeMulawSample(mulaw[inputIndex]);
    const next =
      inputIndex + 1 < mulaw.length
        ? decodeMulawSample(mulaw[inputIndex + 1])
        : current;
    const outputIndex = inputIndex * 2;

    pcm.writeInt16LE(saturatePcm16(current), outputIndex * 2);
    pcm.writeInt16LE(saturatePcm16((current + next) / 2), (outputIndex + 1) * 2);
  }

  return pcm.toString("base64");
}

/**
 * Converts Gemini output audio (headerless signed PCM16 LE, 24 kHz, mono) to
 * Twilio Media Streams audio (headerless G.711 mu-law, 8 kHz, mono).
 *
 * A three-sample box filter provides deterministic 3:1 downsampling and basic
 * anti-aliasing. A final group of one or two samples is averaged rather than
 * silently discarded; complete 20 ms frames contain exactly 480 input samples.
 */
export function geminiPcm24kToTwilioMulaw8k(base64Audio: string): string {
  const pcm = decodeCanonicalBase64(base64Audio, "Gemini audio");

  if (pcm.length % Int16Array.BYTES_PER_ELEMENT !== 0) {
    throw new RangeError("Gemini PCM16 audio must contain a whole number of 16-bit samples.");
  }

  const inputSamples = pcm.length / Int16Array.BYTES_PER_ELEMENT;
  const mulaw = Buffer.alloc(Math.ceil(inputSamples / 3));

  for (let inputIndex = 0, outputIndex = 0; inputIndex < inputSamples; inputIndex += 3) {
    const samplesInGroup = Math.min(3, inputSamples - inputIndex);
    let sum = 0;

    for (let offset = 0; offset < samplesInGroup; offset += 1) {
      sum += pcm.readInt16LE((inputIndex + offset) * 2);
    }

    mulaw[outputIndex] = encodeMulawSample(sum / samplesInGroup);
    outputIndex += 1;
  }

  return mulaw.toString("base64");
}
