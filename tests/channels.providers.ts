import assert from "node:assert/strict";

import {
  InfobipConfigurationError,
  InfobipPayloadError,
  normalizeSmsText,
  parseInfobipInboundPayload,
  parseInfobipStatusPayload,
  prepareSingleSms,
  sendInfobipSms,
  validateInfobipBasicAuth,
} from "../lib/channels/infobip";
import { isE164PhoneNumber, normalizeE164PhoneNumber } from "../lib/channels/phone";
import {
  buildTwilioStreamTwiML,
  createTwilioSignature,
  validateTwilioSignature,
} from "../lib/channels/twilio";

async function run() {
  assert.equal(normalizeE164PhoneNumber("0772 123 456"), "+256772123456");
  assert.equal(normalizeE164PhoneNumber("772-123-456"), "+256772123456");
  assert.equal(normalizeE164PhoneNumber("256772123456"), "+256772123456");
  assert.equal(normalizeE164PhoneNumber("00256 772 123 456"), "+256772123456");
  assert.equal(normalizeE164PhoneNumber("+256 (0) 772 123 456"), "+256772123456");
  assert.equal(normalizeE164PhoneNumber("020 7946 0018", "+44"), "+442079460018");
  assert.equal(normalizeE164PhoneNumber("not-a-phone"), null);
  assert.equal(normalizeE164PhoneNumber("+0123"), null);
  assert.equal(isE164PhoneNumber("+256772123456"), true);
  assert.equal(isE164PhoneNumber("256772123456"), false);

  const twilioUrl = "https://example.com/myapp.php?foo=1&bar=2";
  const twilioParams = {
    Digits: "1234",
    To: "+18005551212",
    From: "+14158675310",
    Caller: "+14158675310",
    CallSid: "CA1234567890ABCDE",
  };
  const officialSignature = "L/OH5YylLD5NRKLltdqwSvS0BnU=";
  assert.equal(createTwilioSignature("12345", twilioUrl, twilioParams), officialSignature);
  assert.equal(
    validateTwilioSignature("12345", officialSignature, twilioUrl, twilioParams),
    true
  );
  assert.equal(
    validateTwilioSignature("12345", officialSignature, twilioUrl + "/", twilioParams),
    false
  );
  assert.equal(validateTwilioSignature("12345", "not-base64", twilioUrl, twilioParams), false);

  const repeatedParams = new URLSearchParams();
  repeatedParams.append("Tag", "z");
  repeatedParams.append("Tag", "a");
  repeatedParams.append("Tag", "a");
  const repeatedSignature = createTwilioSignature(
    "token",
    "https://example.test/hook",
    { Tag: ["z", "a", "a"] }
  );
  assert.equal(
    createTwilioSignature("token", "https://example.test/hook", repeatedParams),
    repeatedSignature
  );

  const twiml = buildTwilioStreamTwiML(
    "wss://voice.example.test/api/voice/twilio/stream",
    {
      customParameters: { "call&sid": "<CA'123>" },
      statusCallbackUrl:
        "https://voice.example.test/api/voice/twilio/status?source=voice&attempt=1",
    }
  );
  assert.match(twiml, /<Response><Connect><Stream /);
  assert.match(twiml, /name="call&amp;sid"/);
  assert.match(twiml, /value="&lt;CA&apos;123&gt;"/);
  assert.match(twiml, /source=voice&amp;attempt=1/);
  assert.doesNotMatch(twiml, /<Say/i);
  assert.throws(() => buildTwilioStreamTwiML("ws://example.test/stream"), /wss URL/);
  assert.throws(
    () => buildTwilioStreamTwiML("wss://example.test/stream?secret=no"),
    /query string/
  );

  const authorization =
    "Basic " + Buffer.from("sauti-webhook:correct horse", "utf8").toString("base64");
  assert.equal(
    validateInfobipBasicAuth(authorization, "sauti-webhook", "correct horse"),
    true
  );
  assert.equal(validateInfobipBasicAuth(authorization, "sauti-webhook", "wrong"), false);
  assert.equal(validateInfobipBasicAuth("Bearer token", "user", "password"), false);

  const inbound = parseInfobipInboundPayload({
    results: [
      {
        messageId: "inbound-1",
        from: "256772123456",
        to: "256700111222",
        text: "ROAD The road is flooded",
        cleanText: "The road is flooded",
        keyword: "ROAD",
        receivedAt: "2026-08-27T10:30:00.000+0300",
        smsCount: 1,
      },
    ],
  });
  assert.equal(inbound[0].from, "+256772123456");
  assert.equal(inbound[0].to, "+256700111222");
  assert.equal(inbound[0].text, "ROAD The road is flooded");
  assert.equal(inbound[0].messageId, "inbound-1");

  const delivery = parseInfobipStatusPayload({
    results: [
      {
        bulkId: "bulk-1",
        messageId: "outbound-1",
        to: "256772123456",
        sender: "ServiceSMS",
        status: {
          id: 5,
          groupId: 3,
          groupName: "DELIVERED",
          name: "DELIVERED_TO_HANDSET",
          description: "Message delivered to handset",
        },
        error: {
          id: 0,
          groupId: 0,
          groupName: "OK",
          name: "NO_ERROR",
          description: "No Error",
          permanent: false,
        },
        messageCount: 1,
      },
    ],
  });
  assert.equal(delivery[0].status.name, "DELIVERED_TO_HANDSET");
  assert.equal(delivery[0].error?.permanent, false);
  assert.equal(delivery[0].smsCount, 1);
  assert.throws(
    () => parseInfobipInboundPayload({ results: [{ messageId: "bad" }] }),
    InfobipPayloadError
  );
  assert.throws(() => parseInfobipStatusPayload({ results: "bad" }), InfobipPayloadError);

  assert.equal(
    normalizeSmsText("  SAUTI1:\nIt\u2019s blocked \u2014 reply YES\u2026  "),
    "SAUTI1: It's blocked - reply YES..."
  );
  const gsmMessage = prepareSingleSms("SAUTI1: " + "road blocked ".repeat(20));
  assert.equal(gsmMessage.encoding, "GSM-7");
  assert.equal(gsmMessage.truncated, true);
  assert.ok(gsmMessage.units <= 160);

  const unicodeMessage = prepareSingleSms("\u4F60".repeat(100));
  assert.equal(unicodeMessage.encoding, "UCS-2");
  assert.equal(unicodeMessage.truncated, true);
  assert.ok(unicodeMessage.units <= 70);

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        bulkId: "bulk-123",
        messages: [
          {
            messageId: "provider-message-123",
            status: { groupName: "PENDING", name: "PENDING_ACCEPTED" },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const sendResult = await sendInfobipSms({
    to: "0772 123 456",
    text: "SAUTI1: Is the road blocked? Reply YES or NO.",
    apiKey: "api-key-for-test",
    baseUrl: "tenant.api.infobip.com/",
    sender: "ServiceSMS",
    deliveryReportUrl: "https://sauti.example/api/sms/infobip/status",
    callbackData: "conversation-123",
    messageId: "client-message-123",
    fetchImpl: mockFetch,
  });
  assert.equal(capturedUrl, "https://tenant.api.infobip.com/sms/3/messages");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("Authorization"), "App api-key-for-test");
  const requestPayload = JSON.parse(String(capturedInit?.body)) as {
    messages: Array<{
      sender: string;
      destinations: Array<{ to: string; messageId?: string }>;
      content: { text: string };
      webhooks: { delivery: { url: string }; contentType: string };
    }>;
  };
  assert.equal(requestPayload.messages[0].sender, "ServiceSMS");
  assert.equal(requestPayload.messages[0].destinations[0].to, "256772123456");
  assert.equal(requestPayload.messages[0].destinations[0].messageId, "client-message-123");
  assert.equal(requestPayload.messages[0].content.text, sendResult.text);
  assert.equal(requestPayload.messages[0].webhooks.contentType, "application/json");
  assert.equal(sendResult.mode, "live");
  assert.equal(sendResult.sent, true);
  assert.equal(sendResult.messageId, "provider-message-123");

  let fallbackLogged = false;
  const fallback = await sendInfobipSms({
    to: "0772 123 456",
    text: "Development test only",
    apiKey: "",
    baseUrl: "",
    sender: "",
    developmentFallback: true,
    logger: {
      info: () => {
        fallbackLogged = true;
      },
    },
  });
  assert.equal(fallback.mode, "development");
  assert.equal(fallback.sent, false);
  assert.equal(fallbackLogged, true);
  assert.ok(fallback.missing.includes("INFOBIP_API_KEY"));

  await assert.rejects(
    () =>
      sendInfobipSms({
        to: "0772 123 456",
        text: "Must not fake success",
        apiKey: "",
        baseUrl: "",
        sender: "",
        developmentFallback: false,
      }),
    InfobipConfigurationError
  );

  console.log("Channel provider tests passed.");
}

void run();
