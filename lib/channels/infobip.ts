import { createHash, timingSafeEqual } from "node:crypto";

import {
  DEFAULT_COUNTRY_CALLING_CODE,
  normalizeE164PhoneNumber,
} from "./phone";

export class InfobipPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfobipPayloadError";
  }
}

export class InfobipConfigurationError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing Infobip configuration: ${missing.join(", ")}.`);
    this.name = "InfobipConfigurationError";
    this.missing = missing;
  }
}

export class InfobipApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(status: number, responseBody: unknown) {
    super(`Infobip SMS API returned HTTP ${status}.`);
    this.name = "InfobipApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export type InfobipInboundSms = {
  messageId: string;
  from: string;
  to: string;
  text: string;
  cleanText: string | null;
  keyword: string | null;
  receivedAt: string | null;
  smsCount: number | null;
  callbackData: string | null;
};

export type InfobipStatus = {
  id: number | null;
  groupId: number | null;
  groupName: string | null;
  name: string | null;
  description: string | null;
};

export type InfobipErrorStatus = InfobipStatus & {
  permanent: boolean | null;
};

export type InfobipDeliveryReport = {
  messageId: string;
  bulkId: string | null;
  to: string;
  sender: string | null;
  status: InfobipStatus;
  error: InfobipErrorStatus | null;
  sentAt: string | null;
  doneAt: string | null;
  smsCount: number | null;
  callbackData: string | null;
};

export type PreparedSmsText = {
  text: string;
  encoding: "GSM-7" | "UCS-2";
  units: number;
  truncated: boolean;
};

export type InfobipSmsV3Request = {
  messages: [
    {
      sender: string;
      destinations: [
        {
          to: string;
          messageId?: string;
        },
      ];
      content: { text: string };
      webhooks?: {
        delivery?: { url: string };
        contentType: "application/json";
        callbackData?: string;
      };
    },
  ];
};

export type SendInfobipSmsOptions = {
  to: string;
  text: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  sender?: string | null;
  deliveryReportUrl?: string | null;
  callbackData?: string | null;
  messageId?: string | null;
  defaultCountryCallingCode?: string;
  developmentFallback?: boolean;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "info">;
};

export type InfobipSmsSendResult =
  | {
      mode: "live";
      sent: true;
      to: string;
      text: string;
      encoding: PreparedSmsText["encoding"];
      truncated: boolean;
      messageId: string | null;
      bulkId: string | null;
      status: InfobipStatus | null;
    }
  | {
      mode: "development";
      sent: false;
      reason: "missing_configuration";
      missing: string[];
      to: string;
      text: string;
      encoding: PreparedSmsText["encoding"];
      truncated: boolean;
      payload: InfobipSmsV3Request;
    };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonPayload(payload: unknown): unknown {
  if (typeof payload !== "string") {
    return payload;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new InfobipPayloadError("Infobip webhook body is not valid JSON.");
  }
}

function payloadResults(payload: unknown, label: string): UnknownRecord[] {
  const decoded = parseJsonPayload(payload);
  if (!isRecord(decoded)) {
    throw new InfobipPayloadError(`${label} payload must be a JSON object.`);
  }

  // Current SMS webhook formats wrap one or more events in `results`. Accept a
  // single event object too, which makes the parser usable with subscription
  // profiles that unwrap the standard envelope.
  if ("results" in decoded && !Array.isArray(decoded.results)) {
    throw new InfobipPayloadError(label + " results must be an array.");
  }
  const results = Array.isArray(decoded.results) ? decoded.results : [decoded];
  if (results.length === 0 || !results.every(isRecord)) {
    throw new InfobipPayloadError(`${label} payload has no valid results.`);
  }

  return results;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InfobipPayloadError(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeProviderPhone(value: unknown, path: string): string {
  const raw = requiredString(value, path);
  const candidate = /^\d+$/.test(raw) ? `+${raw}` : raw;
  const normalized = normalizeE164PhoneNumber(candidate);
  if (!normalized) {
    throw new InfobipPayloadError(`${path} is not a valid international phone number.`);
  }
  return normalized;
}

function parseStatus(value: unknown, path: string): InfobipStatus {
  if (!isRecord(value)) {
    throw new InfobipPayloadError(`${path} must be an object.`);
  }

  const status: InfobipStatus = {
    id: optionalNumber(value.id),
    groupId: optionalNumber(value.groupId),
    groupName: optionalString(value.groupName),
    name: optionalString(value.name),
    description: optionalString(value.description),
  };

  if (!status.groupName && !status.name) {
    throw new InfobipPayloadError(`${path} must include groupName or name.`);
  }
  return status;
}

/** Parses the official Infobip inbound SMS `results` webhook envelope. */
export function parseInfobipInboundPayload(payload: unknown): InfobipInboundSms[] {
  return payloadResults(payload, "Infobip inbound SMS").map((item, index) => {
    const text = requiredString(item.text, `results[${index}].text`);
    return {
      messageId: requiredString(item.messageId, `results[${index}].messageId`),
      from: normalizeProviderPhone(item.from, `results[${index}].from`),
      to: normalizeProviderPhone(item.to, `results[${index}].to`),
      text,
      cleanText: optionalString(item.cleanText),
      keyword: optionalString(item.keyword),
      receivedAt: optionalString(item.receivedAt),
      smsCount: optionalNumber(item.smsCount),
      callbackData: optionalString(item.callbackData),
    };
  });
}

/** Parses Infobip SMS delivery-status webhook results from v3 or legacy shapes. */
export function parseInfobipStatusPayload(payload: unknown): InfobipDeliveryReport[] {
  return payloadResults(payload, "Infobip SMS status").map((item, index) => {
    let error: InfobipErrorStatus | null = null;
    if (item.error != null) {
      const parsed = parseStatus(item.error, `results[${index}].error`);
      error = {
        ...parsed,
        permanent: isRecord(item.error) ? optionalBoolean(item.error.permanent) : null,
      };
    }

    return {
      messageId: requiredString(item.messageId, `results[${index}].messageId`),
      bulkId: optionalString(item.bulkId),
      to: normalizeProviderPhone(item.to, `results[${index}].to`),
      sender: optionalString(item.sender) ?? optionalString(item.from),
      status: parseStatus(item.status, `results[${index}].status`),
      error,
      sentAt: optionalString(item.sentAt),
      doneAt: optionalString(item.doneAt),
      smsCount: optionalNumber(item.smsCount) ?? optionalNumber(item.messageCount),
      callbackData: optionalString(item.callbackData),
    };
  });
}

function strictBase64Decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")
    ? decoded
    : null;
}

/** Validates credentials configured on an Infobip webhook Basic-auth profile. */
export function validateInfobipBasicAuth(
  authorizationHeader: string | null | undefined,
  expectedUsername: string,
  expectedPassword: string
): boolean {
  const match = authorizationHeader?.trim().match(/^Basic\s+([^\s]+)$/i);
  const decoded = match ? strictBase64Decode(match[1]) : null;
  const configured = Boolean(expectedUsername && expectedPassword);
  const expected = Buffer.from(`${expectedUsername}:${expectedPassword}`, "utf8");

  // Comparing fixed-size hashes avoids leaking credential length and keeps the
  // comparison timing-safe even for malformed headers.
  const actualHash = createHash("sha256").update(decoded ?? Buffer.alloc(0)).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  const matches = timingSafeEqual(actualHash, expectedHash);
  return configured && decoded !== null && matches;
}

const GSM7_BASIC = new Set(
  Array.from(
    '@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\u001B\u00C6\u00E6\u00DF\u00C9 !"#\u00A4%&\'()*+,-./0123456789:;<=>?\u00A1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00C4\u00D6\u00D1\u00DC\u00A7\u00BFabcdefghijklmnopqrstuvwxyz\u00E4\u00F6\u00F1\u00FC\u00E0'
  )
);
const GSM7_EXTENSION = new Set(Array.from("\f^{}\\[~]|\u20AC"));

/** Removes formatting noise and converts common smart punctuation to GSM-safe text. */
export function normalizeSmsText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function gsm7Units(value: string): number | null {
  let units = 0;
  for (const character of value) {
    if (GSM7_BASIC.has(character)) {
      units += 1;
    } else if (GSM7_EXTENSION.has(character)) {
      units += 2;
    } else {
      return null;
    }
  }
  return units;
}

function unicodeUnits(value: string): number {
  let units = 0;
  for (const character of value) {
    units += character.length;
  }
  return units;
}

function truncateByUnits(
  value: string,
  maximumUnits: number,
  unitsForCharacter: (character: string) => number
): string {
  const suffix = "...";
  const targetUnits = maximumUnits - suffix.length;
  let usedUnits = 0;
  let prefix = "";

  for (const character of value) {
    const characterUnits = unitsForCharacter(character);
    if (usedUnits + characterUnits > targetUnits) {
      break;
    }
    usedUnits += characterUnits;
    prefix += character;
  }

  const lastSpace = prefix.lastIndexOf(" ");
  if (lastSpace >= Math.floor(prefix.length * 0.6)) {
    prefix = prefix.slice(0, lastSpace);
  }

  return `${prefix.trimEnd()}${suffix}`;
}

/** Normalizes and limits a reply to one 160-septet GSM-7 or 70-unit UCS-2 SMS. */
export function prepareSingleSms(input: string): PreparedSmsText {
  const normalized = normalizeSmsText(input);
  const gsmUnits = gsm7Units(normalized);

  if (gsmUnits !== null) {
    if (gsmUnits <= 160) {
      return { text: normalized, encoding: "GSM-7", units: gsmUnits, truncated: false };
    }
    const text = truncateByUnits(normalized, 160, (character) =>
      GSM7_EXTENSION.has(character) ? 2 : 1
    );
    return {
      text,
      encoding: "GSM-7",
      units: gsm7Units(text) ?? 160,
      truncated: true,
    };
  }

  const units = unicodeUnits(normalized);
  if (units <= 70) {
    return { text: normalized, encoding: "UCS-2", units, truncated: false };
  }
  const text = truncateByUnits(normalized, 70, (character) => character.length);
  return {
    text,
    encoding: "UCS-2",
    units: unicodeUnits(text),
    truncated: true,
  };
}

/** Convenience helper when callers only need the single-segment text. */
export function fitSmsToSingleSegment(input: string): string {
  return prepareSingleSms(input).text;
}

function safeHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new TypeError(`${label} must be a valid HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new TypeError(`${label} must be a safe HTTPS URL.`);
  }
  return parsed.toString();
}

function infobipEndpoint(baseUrl: string): string {
  const url = new URL(safeHttpsUrl(baseUrl, "Infobip base URL"));
  url.pathname = "/sms/3/messages";
  url.search = "";
  return url.toString();
}

function buildSmsV3Payload(
  sender: string,
  to: string,
  text: string,
  options: Pick<
    SendInfobipSmsOptions,
    "deliveryReportUrl" | "callbackData" | "messageId"
  >
): InfobipSmsV3Request {
  const destination: InfobipSmsV3Request["messages"][0]["destinations"][0] = { to };
  const customMessageId = options.messageId?.trim();
  if (customMessageId) {
    destination.messageId = customMessageId;
  }

  const message: InfobipSmsV3Request["messages"][0] = {
    sender,
    destinations: [destination],
    content: { text },
  };

  const deliveryReportUrl = options.deliveryReportUrl?.trim();
  const callbackData = options.callbackData?.trim();
  if (callbackData && callbackData.length > 4000) {
    throw new TypeError("Infobip callbackData cannot exceed 4000 characters.");
  }
  if (deliveryReportUrl || callbackData) {
    message.webhooks = {
      ...(deliveryReportUrl
        ? { delivery: { url: safeHttpsUrl(deliveryReportUrl, "Delivery report URL") } }
        : {}),
      contentType: "application/json",
      ...(callbackData ? { callbackData } : {}),
    };
  }

  return { messages: [message] };
}

function responseStatus(value: unknown): InfobipStatus | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: optionalNumber(value.id),
    groupId: optionalNumber(value.groupId),
    groupName: optionalString(value.groupName),
    name: optionalString(value.name),
    description: optionalString(value.description),
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 2000);
  }
}

/**
 * Sends one concise SMS using Infobip SMS API v3. In development only, missing
 * credentials produce a logged `sent: false` result instead of a fake success.
 */
export async function sendInfobipSms(
  options: SendInfobipSmsOptions
): Promise<InfobipSmsSendResult> {
  const countryCode =
    options.defaultCountryCallingCode ?? DEFAULT_COUNTRY_CALLING_CODE;
  const normalizedTo = normalizeE164PhoneNumber(options.to, countryCode);
  if (!normalizedTo) {
    throw new TypeError("Infobip SMS destination must be a valid phone number.");
  }

  const prepared = prepareSingleSms(options.text);
  if (!prepared.text) {
    throw new TypeError("Infobip SMS text cannot be empty.");
  }

  const apiKey = (options.apiKey ?? process.env.INFOBIP_API_KEY ?? "").trim();
  const baseUrl = (options.baseUrl ?? process.env.INFOBIP_BASE_URL ?? "").trim();
  const sender = (options.sender ?? process.env.INFOBIP_SENDER_NUMBER ?? "").trim();
  const missing = [
    !apiKey ? "INFOBIP_API_KEY" : null,
    !baseUrl ? "INFOBIP_BASE_URL" : null,
    !sender ? "INFOBIP_SENDER_NUMBER" : null,
  ].filter((value): value is string => value !== null);

  // Infobip's examples use international destination digits without a plus.
  const providerTo = normalizedTo.slice(1);
  const payload = buildSmsV3Payload(sender || "[sender not configured]", providerTo, prepared.text, options);
  const useDevelopmentFallback =
    options.developmentFallback ?? process.env.NODE_ENV === "development";

  if (missing.length > 0) {
    if (!useDevelopmentFallback) {
      throw new InfobipConfigurationError(missing);
    }
    (options.logger ?? console).info(
      "[SMS] Development fallback: outgoing Infobip SMS was not sent.",
      { to: normalizedTo, text: prepared.text, missing }
    );
    return {
      mode: "development",
      sent: false,
      reason: "missing_configuration",
      missing,
      to: normalizedTo,
      text: prepared.text,
      encoding: prepared.encoding,
      truncated: prepared.truncated,
      payload,
    };
  }

  const response = await (options.fetchImpl ?? fetch)(infobipEndpoint(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `App ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    throw new InfobipApiError(response.status, responseBody);
  }

  const responseRecord = isRecord(responseBody) ? responseBody : null;
  const firstMessage =
    responseRecord && Array.isArray(responseRecord.messages) && isRecord(responseRecord.messages[0])
      ? responseRecord.messages[0]
      : null;

  return {
    mode: "live",
    sent: true,
    to: normalizedTo,
    text: prepared.text,
    encoding: prepared.encoding,
    truncated: prepared.truncated,
    messageId: firstMessage ? optionalString(firstMessage.messageId) : null,
    bulkId: responseRecord ? optionalString(responseRecord.bulkId) : null,
    status: firstMessage ? responseStatus(firstMessage.status) : null,
  };
}
