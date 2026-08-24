import Link from "next/link";
import {
  ArrowRight,
  MessageSquareText,
} from "lucide-react";
import { TextIcon, VoiceIcon } from "./icons";

export type RecentActivity = {
  id: string;
  status: string;
  title: string;
  ticketCode: string | null;
  time: string;
};

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export function CitizenHome({
  recentActivity = [],
}: {
  recentActivity?: RecentActivity[];
}) {
  return (
    <>
      <section className="hero">
        <h1>How can Sauti1 help you today?</h1>

        <p className="hero-sub">
          Speak or type naturally. Sauti1 understands the issue, finds the
          right institution, asks only what is needed, and confirms everything
          with you before a report is submitted.
        </p>

        <div className="mode-grid">
          <Link href="/voice" className="mode-card voice">
            <div>
              <div className="mode-icon">
                <VoiceIcon />
              </div>

              <div className="mode-title">Talk with our AI</div>

              <div className="mode-copy">
                Speak naturally with Sauti1 in a live voice conversation.
              </div>
            </div>

            <div className="card-arrow">
              <ArrowRight size={18} />
            </div>
          </Link>

          <Link href="/chat" className="mode-card text">
            <div>
              <div className="mode-icon">
                <TextIcon />
              </div>

              <div className="mode-title">Text our AI</div>

              <div className="mode-copy">
                Describe what happened, attach evidence, and let Sauti1 guide
                you.
              </div>
            </div>

            <div className="card-arrow">
              <ArrowRight size={18} />
            </div>
          </Link>
        </div>

        <div className="quick-section">
          <div className="section-head">
            <h2>Try asking</h2>
          </div>

          <div className="chips">
            <Link className="chip" href={{ pathname: "/chat", query: { prompt: "I sent money but it never arrived" } }}>
              I sent money but it never arrived
            </Link>

            <Link className="chip" href={{ pathname: "/chat", query: { prompt: "We have had no water since Monday" } }}>
              We have had no water since Monday
            </Link>

            <Link className="chip" href={{ pathname: "/chat", query: { prompt: "Is this message from my bank legitimate?" } }}>
              Is this message from my bank legitimate?
            </Link>

            <Link className="chip" href={{ pathname: "/chat", query: { prompt: "There is a dangerous pothole near me" } }}>
              There is a dangerous pothole near me
            </Link>
          </div>
        </div>

        <div className="quick-section activity-section">
          <div className="section-head">
            <h2>Recent activity</h2>

            <Link href="/reports">View all</Link>
          </div>

          <div className="activity-grid">
            {recentActivity.length === 0 ? (
              <div className="activity-card">
                <span className="activity-status">Ready</span>
                <div className="activity-title">No reports yet</div>
                <div className="activity-meta">Text Sauti1 to start a conversation</div>
              </div>
            ) : recentActivity.map((activity) => (
              <Link className="activity-card" href={`/reports/${activity.id}`} key={activity.id}>
                <span className="activity-status">{statusLabel(activity.status)}</span>
                <div className="activity-title">{activity.title}</div>
                <div className="activity-meta">
                  {activity.ticketCode || "Draft"} - {activity.time}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="composer">
        <Link className="composer-main" href="/chat" aria-label="Open Sauti1 text assistant">
          <span className="circle-btn" aria-hidden="true"><MessageSquareText size={20} /></span>
          <span className="composer-placeholder">Message Sauti1 AI...</span>
        </Link>
        <Link className="circle-btn voice" href="/voice" aria-label="Start Voice Sauti1" title="Start Voice Sauti1">
          <VoiceIcon />
        </Link>
      </div>
    </>
  );
}
