"use client";

import { ArrowUp, LogIn, Mic, UserPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type GuestMessage = {
  role: "user" | "assistant";
  text: string;
};

type GuestContext = {
  description?: string;
  summary?: string;
  category?: string;
  institutionSlug?: string | null;
  institutionName?: string;
  priority?: string;
  confidence?: number;
  locationText?: string | null;
  intakeData?: Record<string, string>;
};

const suggestions = [
  "My water meter was stolen",
  "I sent money but it never arrived",
  "There is a dangerous pothole near my home",
  "We have had no water since Monday",
  "My Yaka meter stopped working",
  "I lost my national ID",
  "My exam results have the wrong name",
  "A streetlight has been broken for weeks",
  "There is illegal dumping near our school",
  "My mobile money account was charged twice",
  "A power line is hanging dangerously low",
  "My SIM card was registered without permission",
  "The road floods whenever it rains",
  "I need help reporting a missing person",
  "A health centre turned away an emergency",
  "My passport application has stalled",
  "There is sewage flowing into the road",
  "I received a suspicious message from my bank",
  "A public bus is operating dangerously",
  "My land title details appear incorrect",
];

export function GuestLanding() {
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [context, setContext] = useState<GuestContext>();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [suggestionPage, setSuggestionPage] = useState(0);
  const [error, setError] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    if (messages.length) return;
    const interval = window.setInterval(() => {
      setSuggestionPage((page) => (page + 1) % suggestions.length);
    }, 5600);
    return () => window.clearInterval(interval);
  }, [messages.length]);

  const visibleSuggestions = Array.from({ length: 3 }, (_, index) =>
    suggestions[(suggestionPage * 3 + index) % suggestions.length]
  );

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || pending) return;

    const history = messages.slice(-10);
    setMessages((current) => [...current, { role: "user", text: message }]);
    setInput("");
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/sauti1/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, context }),
      });
      const payload = await response.json() as {
        reply?: string;
        context?: GuestContext;
        error?: string;
      };
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || "Sauti1 could not respond right now.");
      }

      setMessages((current) => [...current, { role: "assistant", text: payload.reply! }]);
      setContext(payload.context);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sauti1 could not respond right now.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <div className="guest-app">
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

      <main className={`guest-main ${messages.length ? "has-conversation" : ""}`}>
        <section className="guest-thread" aria-live="polite" aria-label="Conversation with Sauti1">
          {messages.length === 0 ? (
            <div className="guest-empty">
              <div className="guest-mark" aria-hidden="true">
                <Image src="/brand/sauti1-mark.png" alt="" width={64} height={64} />
              </div>
              <h1>What can Sauti1 help with?</h1>
            </div>
          ) : (
            <div className="guest-messages">
              {messages.map((message, index) => (
                <div className={`guest-message ${message.role}`} key={`${message.role}-${index}`}>
                  {message.role === "assistant" && <span className="guest-message-mark" aria-hidden="true">S1</span>}
                  <p>{message.text}</p>
                </div>
              ))}
              {pending && (
                <div className="guest-message assistant" aria-label="Sauti1 is thinking">
                  <span className="guest-message-mark" aria-hidden="true">S1</span>
                  <span className="guest-thinking" aria-hidden="true"><i /><i /><i /></span>
                </div>
              )}
              <div ref={threadEndRef} />
            </div>
          )}
        </section>

        <div className="guest-input-region">
          {messages.some((message) => message.role === "assistant") && (
            <div className="guest-upgrade">
              <span>Sign in to save this conversation, attach evidence, submit reports and track progress.</span>
              <div>
                <Link href="/login">Sign in</Link>
                <Link href="/login?mode=signup">Create account</Link>
              </div>
            </div>
          )}
          {error && <p className="guest-error" role="alert">{error}</p>}
          <form className="guest-composer" onSubmit={submit}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Message Sauti1"
              maxLength={1200}
              disabled={pending}
              aria-label="Message Sauti1"
            />
            <button className="guest-send" type="submit" disabled={pending || !input.trim()} aria-label="Send message" title="Send message">
              <ArrowUp size={20} />
            </button>
          </form>
          <div className="guest-or" aria-hidden="true"><span>OR</span></div>
          <Link className="guest-voice-cta" href="/guest/voice">
            <span><Mic size={21} /></span>
            <div>
              <strong>Talk to our AI using your voice</strong>
            </div>
          </Link>
          {messages.length === 0 && (
            <div aria-live="off" className="guest-suggestions" key={suggestionPage}>
              {visibleSuggestions.map((suggestion, index) => (
                <button className={`tone-${index + 1}`} key={suggestion} onClick={() => void sendMessage(suggestion)} type="button">
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
      <footer className="guest-footer">
        <p className="guest-privacy"><strong>Guest conversations are not saved or submitted.</strong> Sign in or create an account to securely submit and track a report.</p>
      </footer>
    </div>
  );
}
