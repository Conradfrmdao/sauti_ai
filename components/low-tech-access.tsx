"use client";

import { Check, Copy, MessageSquareText, PhoneCall } from "lucide-react";
import { useState } from "react";

import type { PublicChannelAccess } from "@/lib/channels/access";

function readable(value: string) {
  if (value.startsWith("+256") && value.length === 13) {
    return `+256 ${value.slice(4, 7)} ${value.slice(7, 10)} ${value.slice(10)}`;
  }
  return value;
}

export function LowTechAccess({
  access,
  compact = false,
}: {
  access: PublicChannelAccess;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const entries = [
    access.callNumber && {
      key: "call",
      label: "Call SAUTI1",
      value: access.callNumber,
      href: `tel:${access.callNumber}`,
      icon: PhoneCall,
    },
    access.smsNumber && {
      key: "sms",
      label: "Text SAUTI1",
      value: access.smsNumber,
      href: `sms:${access.smsNumber}`,
      icon: MessageSquareText,
    },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: string;
    href: string;
    icon: typeof PhoneCall;
  }>;

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className={`channel-access ${compact ? "is-compact" : ""}`} aria-labelledby={compact ? undefined : "channel-access-title"}>
      {!compact && (
        <div className="channel-access-heading">
          <span>Works beyond smartphones</span>
          <h2 id="channel-access-title">Call or SMS from any phone</h2>
          <p>The same secure reporting flow is available without mobile data.</p>
        </div>
      )}
      {entries.length ? (
        <div className="channel-access-options">
          {entries.map(({ key, label, value, href, icon: Icon }) => (
            <div className="channel-access-option" key={key}>
              <a href={href}>
                <Icon aria-hidden="true" size={19} />
                <span><small>{label}</small><strong>{readable(value)}</strong></span>
              </a>
              <button aria-label={`Copy ${label.toLowerCase()} number`} onClick={() => void copy(value, key)} type="button">
                {copied === key ? <Check size={17} /> : <Copy size={17} />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="channel-access-unavailable">Call and SMS access is not configured for this deployment. You can still report securely by web text or voice.</p>
      )}
    </section>
  );
}
