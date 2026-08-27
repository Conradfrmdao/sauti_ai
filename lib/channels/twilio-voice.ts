import { createHmac, timingSafeEqual } from "node:crypto";

type StreamTokenPayload = {
  callSid: string;
  from: string;
  exp: number;
};

function secret() {
  return process.env.TWILIO_STREAM_SECRET || process.env.TWILIO_AUTH_TOKEN || "";
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createTwilioStreamToken(callSid: string, from: string, lifetimeSeconds = 7200) {
  if (!secret()) throw new Error("Twilio stream signing is not configured.");
  const payload: StreamTokenPayload = {
    callSid,
    from,
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function validateTwilioStreamToken(token: string, callSid: string, from: string) {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !secret()) return false;
  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StreamTokenPayload;
    return payload.callSid === callSid && payload.from === from &&
      Number.isFinite(payload.exp) && payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
