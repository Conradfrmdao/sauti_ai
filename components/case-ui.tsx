import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileText,
  MessageSquareText,
  PhoneCall,
  Radio,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";

export function titleCase(value: string | null | undefined, fallback = "Not available") {
  return (value || fallback).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const resolvedStatuses = new Set(["resolved_confirmed", "closed"]);
const attentionStatuses = new Set(["critical", "needs_review", "reopened", "cancelled", "rejected"]);
const activeStatuses = new Set(["routed", "submitted", "acknowledged", "assigned", "in_progress", "resolution_proposed"]);

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const normalized = status || "draft";
  const tone = resolvedStatuses.has(normalized)
    ? "resolved"
    : attentionStatuses.has(normalized)
      ? "attention"
      : activeStatuses.has(normalized)
        ? "active"
        : "neutral";
  const Icon = tone === "resolved"
    ? CheckCircle2
    : tone === "attention"
      ? ShieldAlert
      : tone === "active"
        ? Clock3
        : CircleDashed;
  return <span className={`status-badge is-${tone}`}><Icon aria-hidden="true" size={13} />{titleCase(normalized)}</span>;
}

export function SourceBadge({ source }: { source: string | null | undefined }) {
  const normalized = source || "text";
  const Icon = normalized === "voice" ? Radio : normalized === "phone" ? PhoneCall : normalized === "sms" ? MessageSquareText : FileText;
  const label = normalized === "text" ? "Web" : titleCase(normalized);
  return <span className="source-badge"><Icon aria-hidden="true" size={13} />{label}</span>;
}

export function PriorityMarker({ priority }: { priority: string | null | undefined }) {
  const normalized = priority || "medium";
  return <span className={`priority-marker is-${normalized}`}><AlertTriangle aria-hidden="true" size={13} />{titleCase(normalized)}</span>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-state-icon">{icon}</span>}
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
