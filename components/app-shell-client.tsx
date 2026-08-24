"use client";

import {
  Bell,
  CircleHelp,
  Compass,
  FileText,
  Home,
  Landmark,
  MessageSquareText,
  SearchCheck,
  UserRound,
  X,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { AccountMenu } from "@/components/account-menu";

type Identity = {
  name: string;
  role: string;
  initials: string;
};

const citizenNav = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/reports", label: "My reports", icon: FileText },
  { href: "/track", label: "Track a ticket", icon: SearchCheck },
  { href: "/explore", label: "Explore issues", icon: Compass },
];

const discoverNav = [
  { href: "/institutions", label: "Institutions", icon: Landmark },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/help", label: "Help", icon: CircleHelp },
];

const mobileTabs = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/chat", label: "Ask", icon: MessageSquareText, primary: true },
  { href: "/track", label: "Track", icon: SearchCheck },
  { href: "/explore", label: "Explore", icon: Compass },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationPendingHint() {
  const { pending } = useLinkStatus();
  return <span className={`navigation-pending ${pending ? "is-pending" : ""}`} aria-hidden="true" />;
}

function AttentionBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return <span className="attention-badge" aria-label={`${count} draft ${count === 1 ? "report needs" : "reports need"} attention`}>{count > 99 ? "99+" : count}</span>;
}

function NavigationLinks({ pathname, attentionCount }: { pathname: string; attentionCount: number }) {
  return (
    <>
      <div className="nav-section">Citizen</div>
      {citizenNav.map(({ href, label, icon: Icon }) => (
        <Link className={`nav-link ${isActive(pathname, href) ? "active" : ""}`} href={href} key={href} prefetch>
          <Icon size={18} strokeWidth={1.85} />
          <span>{label}</span>
          {href === "/reports" && <AttentionBadge count={attentionCount} />}
          <NavigationPendingHint />
        </Link>
      ))}

      <div className="nav-section">Discover</div>
      {discoverNav.map(({ href, label, icon: Icon }) => (
        <Link className={`nav-link ${isActive(pathname, href) ? "active" : ""}`} href={href} key={href} prefetch>
          <Icon size={18} strokeWidth={1.85} />
          <span>{label}</span>
          {href === "/notifications" && <AttentionBadge count={attentionCount} />}
          <NavigationPendingHint />
        </Link>
      ))}
    </>
  );
}

export function AppShellClient({ children, identity, attentionCount: initialAttentionCount }: { children: ReactNode; identity: Identity; attentionCount: number }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [attentionCount, setAttentionCount] = useState(initialAttentionCount);

  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => setAttentionCount(initialAttentionCount), [initialAttentionCount]);
  useEffect(() => {
    const updateAttention = (event: Event) => {
      const delta = Number((event as CustomEvent<{ delta?: number }>).detail?.delta ?? 0);
      setAttentionCount((count) => Math.max(0, count + delta));
    };
    window.addEventListener("sauti1:attention-change", updateAttention);
    return () => window.removeEventListener("sauti1:attention-change", updateAttention);
  }, []);

  return (
    <div className="shell">
      <div className="app-grid">
        <aside className="sidebar">
          <Link href="/dashboard" className="brand">SAUTI<span className="brand-one">1</span><span className="brand-ai">AI</span></Link>
          <NavigationLinks attentionCount={attentionCount} pathname={pathname} />
          <AccountMenu name={identity.name} role={identity.role} initials={identity.initials} />
        </aside>

        <main className="main">
          <div className="mobile-topbar">
            <Link href="/dashboard" className="mobile-brand">SAUTI<span className="brand-one">1</span><span className="brand-ai">AI</span></Link>
            <div className="mobile-topbar-actions">
              <Link className="mobile-topbar-button" href="/notifications" aria-label="Notifications" title="Notifications">
                <Bell size={19} />
                <AttentionBadge count={attentionCount} />
              </Link>
              <button className="mobile-topbar-button" aria-expanded={moreOpen} aria-label={moreOpen ? "Close account menu" : "Open account menu"} onClick={() => setMoreOpen((open) => !open)} type="button">
                {moreOpen ? <X size={19} /> : <UserRound size={19} />}
              </button>
            </div>
          </div>

          {moreOpen && (
            <>
              <button className="mobile-more-backdrop" aria-label="Close account menu" onClick={() => setMoreOpen(false)} type="button" />
              <aside className="mobile-more-sheet" aria-label="More navigation">
                <div className="mobile-more-head">
                  <div>
                    <strong>More</strong>
                    <span>Account and support</span>
                  </div>
                  <button aria-label="Close account menu" onClick={() => setMoreOpen(false)} type="button"><X size={18} /></button>
                </div>
                <nav className="mobile-more-links">
                  {discoverNav.map(({ href, label, icon: Icon }) => (
                    <Link className={`mobile-more-link ${isActive(pathname, href) ? "active" : ""}`} href={href} key={href} prefetch>
                      <Icon size={18} strokeWidth={1.85} />
                      <span>{label}</span>
                      {href === "/notifications" && <AttentionBadge count={attentionCount} />}
                      <NavigationPendingHint />
                    </Link>
                  ))}
                </nav>
                <AccountMenu name={identity.name} role={identity.role} initials={identity.initials} />
              </aside>
            </>
          )}

          {children}

          <nav className="mobile-tabbar" aria-label="Primary navigation">
            {mobileTabs.map(({ href, label, icon: Icon, primary }) => {
              const active = primary
                ? pathname === "/chat" || pathname === "/voice"
                : isActive(pathname, href);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`mobile-tab ${active ? "active" : ""} ${primary ? "primary" : ""}`}
                  href={href}
                  key={href}
                  prefetch
                >
                  <span className="mobile-tab-icon"><Icon size={primary ? 20 : 19} strokeWidth={primary ? 2 : 1.9} /></span>
                  <span>{label}</span>
                  {href === "/reports" && <AttentionBadge count={attentionCount} />}
                  <NavigationPendingHint />
                </Link>
              );
            })}
          </nav>
        </main>
      </div>
    </div>
  );
}
