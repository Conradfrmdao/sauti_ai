import "server-only";

export type PublicChannelAccess = {
  callNumber: string | null;
  smsNumber: string | null;
};

function publicPhone(value: string | undefined) {
  const normalized = value?.trim().replace(/[\s()-]/g, "") ?? "";
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function getPublicChannelAccess(): PublicChannelAccess {
  return {
    callNumber: publicPhone(process.env.TWILIO_PHONE_NUMBER),
    smsNumber: publicPhone(process.env.INFOBIP_SENDER_NUMBER),
  };
}

export function displayPhone(value: string) {
  if (value.startsWith("+256") && value.length === 13) {
    return `+256 ${value.slice(4, 7)} ${value.slice(7, 10)} ${value.slice(10)}`;
  }
  return value;
}
