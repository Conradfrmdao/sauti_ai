export function reportSourceLabel(source: string | null | undefined) {
  switch (source) {
    case "voice": return "Voice";
    case "phone": return "Phone";
    case "sms": return "SMS";
    default: return "Web";
  }
}
