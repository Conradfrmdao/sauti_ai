import {
  ArrowRight,
  FileText,
  Mic2,
  Send,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { EmptyState, SourceBadge, StatusBadge, titleCase } from "@/components/case-ui";
import { LowTechAccessServer } from "@/components/low-tech-access-server";

export type RecentActivity = {
  id: string;
  status: string;
  source: string;
  title: string;
  institutionName: string;
  ticketCode: string | null;
  time: string;
};

export type CitizenSummary = {
  total: number;
  active: number;
  resolved: number;
};

const prompts = [
  "We have had no water since Monday",
  "There is a dangerous pothole near my home",
  "I sent money but it never arrived",
];

export function CitizenHome({
  recentActivity = [],
  summary,
}: {
  recentActivity?: RecentActivity[];
  summary: CitizenSummary;
}) {
  return (
    <div className="citizen-home">
      <header className="citizen-home-intro">
        <p className="eyebrow">Signal → Trust → Action</p>
        <h1>Tell us what happened.</h1>
        <p>SAUTI1 builds a clear case, finds the responsible institution, and lets you review every detail before anything is sent.</p>
      </header>

      <section className="report-composer-panel" aria-labelledby="report-composer-title">
        <div className="report-composer-heading">
          <span className="report-composer-icon"><FileText aria-hidden="true" size={20} /></span>
          <div>
            <h2 id="report-composer-title">Start a civic report</h2>
            <p>Use your own words. Dates, places and reference numbers help.</p>
          </div>
        </div>
        <form action="/chat" className="report-composer-form" method="get">
          <textarea aria-label="Describe what happened" maxLength={4000} name="prompt" placeholder="For example: Our area has had no running water since Monday morning…" required rows={4} />
          <div className="report-composer-actions">
            <p><ShieldCheck aria-hidden="true" size={15} /> Nothing is submitted until you confirm.</p>
            <div>
              <Link className="secondary-action" href="/voice"><Mic2 aria-hidden="true" size={17} /> Use voice</Link>
              <button type="submit">Build my case <Send aria-hidden="true" size={17} /></button>
            </div>
          </div>
        </form>
        <div className="report-prompt-row" aria-label="Example issues">
          {prompts.map((prompt) => (
            <Link href={{ pathname: "/chat", query: { prompt } }} key={prompt} prefetch={false}>{prompt}</Link>
          ))}
        </div>
      </section>

      <section className="citizen-summary" aria-label="Your report summary">
        <div><strong>{summary.total}</strong><span>Total reports</span></div>
        <div><strong>{summary.active}</strong><span>Being handled</span></div>
        <div><strong>{summary.resolved}</strong><span>Citizen-confirmed</span></div>
        <Link href="/reports">Open all reports <ArrowRight aria-hidden="true" size={16} /></Link>
      </section>

      <section className="recent-cases">
        <div className="section-heading">
          <div><p className="eyebrow">Accountability</p><h2>Recent cases</h2></div>
          <Link href="/track">Track tickets <ArrowRight aria-hidden="true" size={16} /></Link>
        </div>

        {recentActivity.length === 0 ? (
          <EmptyState
            action={<Link className="text-action" href="/chat">Start your first report</Link>}
            description="When you start a report, its draft, routing and institution response will appear here."
            icon={<FileText size={19} />}
            title="No reports yet"
          />
        ) : (
          <div className="recent-case-list">
            {recentActivity.map((activity) => (
              <Link href={`/reports/${activity.id}`} key={activity.id} prefetch={false}>
                <div className="recent-case-main">
                  <span>{activity.ticketCode || "Draft report"}</span>
                  <strong>{titleCase(activity.title, "Citizen service issue")}</strong>
                  <small>{activity.institutionName}</small>
                </div>
                <div className="recent-case-meta">
                  <SourceBadge source={activity.source} />
                  <StatusBadge status={activity.status} />
                  <time>{activity.time}</time>
                </div>
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <LowTechAccessServer />
    </div>
  );
}
