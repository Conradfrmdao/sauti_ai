import { AlertTriangle, Check, Circle, XCircle } from "lucide-react";

const stages = [
  { label: "Submitted", statuses: ["submitted", "routed"] },
  { label: "Received", statuses: ["acknowledged", "assigned"] },
  { label: "In progress", statuses: ["in_progress", "reopened"] },
  { label: "Confirm", statuses: ["resolution_proposed", "resolved_confirmed"] },
  { label: "Closed", statuses: ["closed"] },
];

function stageIndex(status: string) {
  return stages.findIndex((stage) => stage.statuses.includes(status));
}

export function TicketLifecycle({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const current = stageIndex(status);
  const cancelled = ["cancelled", "rejected"].includes(status);
  const needsReview = status === "needs_review";
  return (
    <ol className={`ticket-lifecycle ${compact ? "is-compact" : ""} ${cancelled ? "is-rejected" : ""}`}>
      {stages.map((stage, index) => {
        const complete = !cancelled && !needsReview && current >= index;
        const active = !cancelled && !needsReview && current === index;
        return (
          <li className={`${complete ? "is-complete" : ""} ${active ? "is-current" : ""}`} key={stage.label}>
            <span>{complete ? <Check aria-hidden="true" size={13} /> : <Circle aria-hidden="true" size={12} />}</span>
            <small>{stage.label}</small>
          </li>
        );
      })}
      {needsReview && (
        <li className="rejected-marker"><span><AlertTriangle aria-hidden="true" size={14} /></span><small>Routing review</small></li>
      )}
      {cancelled && (
        <li className="rejected-marker"><span><XCircle aria-hidden="true" size={14} /></span><small>Cancelled</small></li>
      )}
    </ol>
  );
}
