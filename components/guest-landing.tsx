"use client";

import { ArrowUp, AudioLines, LogIn, Mic, MicOff, UserPlus } from "lucide-react";
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

type SpeechRecognitionResultLike = {
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

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
  const [listening, setListening] = useState(false);
  const [suggestionPage, setSuggestionPage] = useState(0);
  const [error, setError] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

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

  async function sendMessage(rawMessage: string, speakReply = false) {
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

      if (speakReply && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(payload.reply);
        utterance.lang = "en-UG";
        utterance.rate = 0.98;
        window.speechSynthesis.speak(utterance);
      }
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

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Voice input is not available in this browser. You can still message Sauti1.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-UG";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (result) {
        setInput(result);
        void sendMessage(result, true);
      }
    };
    recognition.onerror = () => {
      setListening(false);
      setError("I could not hear that clearly. Try again or type your message.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  }

  return (
    <div className="guest-app">
      <header className="guest-header">
        <Link href="/" className="guest-brand" aria-label="SAUTI1 AI home">
          SAUTI<span>1</span><small>AI</small>
        </Link>
        <nav className="guest-auth-actions" aria-label="Account">
          <Link href="/login" className="guest-signin"><LogIn size={16} /> Sign in</Link>
          <Link href="/login?mode=signup" className="guest-signup"><UserPlus size={16} /> Create account</Link>
        </nav>
      </header>

      <main className={`guest-main ${messages.length ? "has-conversation" : ""}`}>
        <section className="guest-thread" aria-live="polite" aria-label="Conversation with Sauti1">
          {messages.length === 0 ? (
            <div className="guest-empty">
              <div className="guest-mark" aria-hidden="true"><AudioLines size={24} /></div>
              <h1>What can Sauti1 help with?</h1>
              <div aria-live="off" className="guest-suggestions" key={suggestionPage}>
                {visibleSuggestions.map((suggestion, index) => (
                  <button className={`tone-${index + 1}`} key={suggestion} onClick={() => void sendMessage(suggestion)} type="button">
                    {suggestion}
                  </button>
                ))}
              </div>
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
              placeholder={listening ? "Listening..." : "Message Sauti1"}
              maxLength={1200}
              disabled={pending}
              aria-label="Message Sauti1"
            />
            <button className="guest-send" type="submit" disabled={pending || !input.trim()} aria-label="Send message" title="Send message">
              <ArrowUp size={20} />
            </button>
          </form>
          <div className="guest-or" aria-hidden="true"><span>OR</span></div>
          <button
            className={`guest-voice-cta ${listening ? "active" : ""}`}
            type="button"
            onClick={toggleVoice}
            disabled={pending}
          >
            <span>{listening ? <MicOff size={21} /> : <Mic size={21} />}</span>
            <div>
              <strong>{listening ? "Listening..." : "Talk to our AI using your voice"}</strong>
            </div>
          </button>
          <p className="guest-privacy"><strong>Guest conversations are not saved or submitted.</strong> Sign in or create an account to securely submit and track a report.</p>
        </div>
      </main>
    </div>
  );
}
