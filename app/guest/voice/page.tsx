import { LogIn, UserPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { VoiceView } from "@/components/voice-view";

export default function GuestVoicePage() {
  return (
    <div className="guest-app guest-voice-shell">
      <header className="guest-header">
        <Link href="/" className="guest-brand" aria-label="SAUTI1 AI home">
          <Image className="guest-brand-mark" src="/brand/sauti1-mark.png" alt="" width={36} height={36} />
          <span className="guest-brand-name">SAUTI<span>1</span><small>AI</small></span>
        </Link>
        <nav className="guest-auth-actions" aria-label="Account">
          <Link href="/login" className="guest-signin"><LogIn size={16} /> <span>Sign in</span></Link>
          <Link href="/login?mode=signup" className="guest-signup" aria-label="Create account"><UserPlus size={16} /><span className="guest-signup-full">Create account</span><span className="guest-signup-short">Create</span></Link>
        </nav>
      </header>
      <main className="guest-voice-main">
        <VoiceView guestMode />
      </main>
      <footer className="guest-footer">
        <p className="guest-privacy"><strong>Guest conversations are not saved or submitted.</strong> Sign in or create an account to securely submit and track a report.</p>
      </footer>
    </div>
  );
}
