export type TwilioMediaEvent =
  | { event: "connected" }
  | { event: "start"; start: {
      accountSid: string;
      streamSid: string;
      callSid: string;
      customParameters: Record<string, string>;
      mediaFormat: { encoding?: string; sampleRate?: number; channels?: number };
    } }
  | { event: "media"; streamSid: string; media: { track?: string; payload: string } }
  | { event: "stop"; streamSid: string }
  | { event: "dtmf" | "mark"; streamSid?: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTwilioMediaEvent(raw: unknown): TwilioMediaEvent {
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Invalid Twilio media JSON."); }
  if (!record(value) || typeof value.event !== "string") throw new Error("Invalid Twilio media event.");
  if (value.event === "connected") return { event: "connected" };
  if (value.event === "start" && record(value.start)) {
    const start = value.start;
    if (![start.accountSid, start.streamSid, start.callSid].every((item) => typeof item === "string")) {
      throw new Error("Invalid Twilio start event.");
    }
    const custom = record(start.customParameters) ? start.customParameters : {};
    const format = record(start.mediaFormat) ? start.mediaFormat : {};
    if (!Object.values(custom).every((item) => typeof item === "string")) throw new Error("Invalid Twilio parameters.");
    return { event: "start", start: { accountSid: start.accountSid as string,
      streamSid: start.streamSid as string, callSid: start.callSid as string,
      customParameters: custom as Record<string, string>,
      mediaFormat: {
        encoding: typeof format.encoding === "string" ? format.encoding : undefined,
        sampleRate: typeof format.sampleRate === "number" ? format.sampleRate : undefined,
        channels: typeof format.channels === "number" ? format.channels : undefined,
      } } };
  }
  if (value.event === "media" && record(value.media) &&
      typeof value.streamSid === "string" && typeof value.media.payload === "string") {
    return { event: "media", streamSid: value.streamSid,
      media: { payload: value.media.payload,
        track: typeof value.media.track === "string" ? value.media.track : undefined } };
  }
  if (value.event === "stop" && typeof value.streamSid === "string") {
    return { event: "stop", streamSid: value.streamSid };
  }
  if ((value.event === "dtmf" || value.event === "mark")) {
    return { event: value.event,
      streamSid: typeof value.streamSid === "string" ? value.streamSid : undefined };
  }
  throw new Error("Unsupported Twilio media event.");
}

export function twilioOutboundMedia(streamSid: string, payload: string) {
  if (!streamSid || !payload) throw new Error("Twilio outbound media requires stream and audio.");
  return JSON.stringify({ event: "media", streamSid, media: { payload } });
}

export function twilioClearAudio(streamSid: string) {
  if (!streamSid) throw new Error("Twilio clear requires a stream id.");
  return JSON.stringify({ event: "clear", streamSid });
}

export function twilioPlaybackMark(streamSid: string, name: string) {
  if (!streamSid || !name) throw new Error("Twilio mark requires stream and name.");
  return JSON.stringify({ event: "mark", streamSid, mark: { name } });
}
