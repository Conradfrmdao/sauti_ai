import { createHmac, timingSafeEqual } from "node:crypto";

export type TwilioFormValue = string | readonly string[] | null | undefined;
export type TwilioFormParams =
  | Readonly<Record<string, TwilioFormValue>>
  | URLSearchParams;

export type TwilioStreamTwiMLOptions = {
  customParameters?: Readonly<Record<string, string>>;
  statusCallbackUrl?: string;
};

function sortedFormEntries(params: TwilioFormParams): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  if (params instanceof URLSearchParams) {
    const names = Array.from(new Set(params.keys())).sort();
    for (const name of names) {
      const values = Array.from(new Set(params.getAll(name))).sort();
      for (const value of values) {
        entries.push([name, value]);
      }
    }
    return entries;
  }

  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    if (value == null) {
      continue;
    }

    const values = Array.isArray(value)
      ? Array.from(new Set(value)).sort()
      : [value as string];

    for (const item of values) {
      entries.push([name, item]);
    }
  }

  return entries;
}

function signatureData(url: string, params: TwilioFormParams): string {
  return sortedFormEntries(params).reduce(
    (data, [name, value]) => data + name + value,
    url
  );
}

function signatureDigest(
  authToken: string,
  url: string,
  params: TwilioFormParams
): Buffer {
  return createHmac("sha1", authToken)
    .update(Buffer.from(signatureData(url, params), "utf8"))
    .digest();
}

/** Implements Twilio's documented URL + sorted form-field HMAC-SHA1 scheme. */
export function createTwilioSignature(
  authToken: string,
  url: string,
  params: TwilioFormParams = {}
): string {
  if (!authToken || !url) {
    throw new TypeError("Twilio auth token and exact webhook URL are required.");
  }

  return signatureDigest(authToken, url, params).toString("base64");
}

function decodeBase64Signature(signature: string, expectedLength: number) {
  const encoded = signature.trim();
  const hasValidShape = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
  const decoded = hasValidShape ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
  const canonical = decoded.toString("base64");
  const isCanonical =
    hasValidShape &&
    canonical.replace(/=+$/, "") === encoded.replace(/=+$/, "");
  const candidate = Buffer.alloc(expectedLength);

  if (decoded.length === expectedLength) {
    decoded.copy(candidate);
  }

  return {
    candidate,
    valid: isCanonical && decoded.length === expectedLength,
  };
}

/**
 * Validates X-Twilio-Signature without a provider SDK. The signature bytes are
 * compared in constant time; callers must pass the exact externally visible
 * webhook URL (including its query string) that Twilio signed.
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string | null | undefined,
  url: string,
  params: TwilioFormParams = {}
): boolean {
  if (!authToken || !signature || !url) {
    return false;
  }

  try {
    const expected = signatureDigest(authToken, url, params);
    const provided = decodeBase64Signature(signature, expected.length);
    const matches = timingSafeEqual(expected, provided.candidate);
    return provided.valid && matches;
  } catch {
    return false;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function validateAbsoluteUrl(
  value: string,
  protocol: "wss:" | "https:",
  label: string
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute ${protocol.slice(0, -1)} URL.`);
  }

  if (
    parsed.protocol !== protocol ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new TypeError(`${label} must be a safe absolute ${protocol.slice(0, -1)} URL.`);
  }

  return parsed.toString();
}

/** Builds escaped TwiML for a bidirectional <Connect><Stream> voice session. */
export function buildTwilioStreamTwiML(
  streamUrl: string,
  options: TwilioStreamTwiMLOptions = {}
): string {
  const safeStreamUrl = validateAbsoluteUrl(streamUrl, "wss:", "Twilio stream URL");
  const parsedStreamUrl = new URL(safeStreamUrl);

  // Twilio Media Streams do not support query strings. Per-call data belongs
  // in nested <Parameter> elements instead.
  if (parsedStreamUrl.search) {
    throw new TypeError(
      "Twilio stream URL cannot contain a query string; use customParameters instead."
    );
  }

  const attributes = [`url="${escapeXml(safeStreamUrl)}"`];
  if (options.statusCallbackUrl) {
    const statusCallbackUrl = validateAbsoluteUrl(
      options.statusCallbackUrl,
      "https:",
      "Twilio stream status callback URL"
    );
    attributes.push(`statusCallback="${escapeXml(statusCallbackUrl)}"`);
    attributes.push('statusCallbackMethod="POST"');
  }

  const parameters = Object.entries(options.customParameters ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      if (!name.trim()) {
        throw new TypeError("Twilio stream parameter names cannot be empty.");
      }
      if (typeof value !== "string") {
        throw new TypeError("Twilio stream parameter " + name + " must be a string.");
      }
      if (name.length + value.length > 500) {
        throw new TypeError(
          `Twilio stream parameter ${name} exceeds the 500-character limit.`
        );
      }
      return `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`;
    })
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response><Connect><Stream ${attributes.join(" ")}>` +
    `${parameters}</Stream></Connect></Response>`
  );
}
