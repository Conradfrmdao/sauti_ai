export function reportSourceLabel(source: string | null | undefined) {
  switch (source) {
    case "voice": return "Voice Sauti1";
    case "phone": return "Phone call";
    case "sms": return "SMS";
    default: return "Text Sauti1";
  }
}
