import assert from "node:assert/strict";

import {
  parseTwilioMediaEvent,
  twilioClearAudio,
  twilioOutboundMedia,
  twilioPlaybackMark,
} from "../lib/channels/twilio-media";
import {
  createTwilioStreamToken,
  validateTwilioStreamToken,
} from "../lib/channels/twilio-voice";

process.env.TWILIO_STREAM_SECRET = "test-stream-secret";
const callSid = `CA${"a".repeat(32)}`;
const caller = "+256772123456";
const token = createTwilioStreamToken(callSid, caller);
assert.equal(validateTwilioStreamToken(token, callSid, caller), true);
assert.equal(validateTwilioStreamToken(token, callSid, "+256700000000"), false);
assert.equal(validateTwilioStreamToken(token + "x", callSid, caller), false);

assert.deepEqual(parseTwilioMediaEvent(JSON.stringify({ event: "connected" })), {
  event: "connected",
});
const start = parseTwilioMediaEvent(JSON.stringify({
  event: "start",
  start: {
    accountSid: `AC${"b".repeat(32)}`,
    streamSid: `MZ${"c".repeat(32)}`,
    callSid,
    mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
    customParameters: { Caller: caller, SessionToken: token },
  },
}));
assert.equal(start.event, "start");
if (start.event === "start") {
  assert.equal(start.start.mediaFormat.encoding, "audio/x-mulaw");
  assert.equal(start.start.customParameters.SessionToken, token);
}
const media = parseTwilioMediaEvent(JSON.stringify({
  event: "media",
  streamSid: `MZ${"c".repeat(32)}`,
  media: { track: "inbound", payload: "/w==" },
}));
assert.equal(media.event, "media");
if (media.event === "media") assert.equal(media.media.payload, "/w==");

assert.equal(parseTwilioMediaEvent(JSON.stringify({
  event: "stop", streamSid: `MZ${"c".repeat(32)}`,
})).event, "stop");
assert.throws(() => parseTwilioMediaEvent("not-json"), /Invalid Twilio media JSON/);
assert.throws(() => parseTwilioMediaEvent(JSON.stringify({ event: "start", start: {} })),
  /Invalid Twilio start event/);

assert.deepEqual(JSON.parse(twilioOutboundMedia("MZ1", "/w==")), {
  event: "media", streamSid: "MZ1", media: { payload: "/w==" },
});
assert.deepEqual(JSON.parse(twilioClearAudio("MZ1")), {
  event: "clear", streamSid: "MZ1",
});
assert.deepEqual(JSON.parse(twilioPlaybackMark("MZ1", "submitted")), {
  event: "mark", streamSid: "MZ1", mark: { name: "submitted" },
});

console.log("Twilio media protocol checks passed.");
