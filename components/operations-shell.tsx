"use client";

import {
  Activity,
  BookOpenCheck,
  Building2,
  FileSearch,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  RadioTower,
  Route,
  ShieldCheck,
  TicketCheck,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { Brand } from "@/components/brand";

type WorkspaceKind = "admin" | "institution";

const adminNavigation = [
  { href: "/admin", label: "Network overview", icon: LayoutDashboard },
  { href: "/admin/reports", label: "Reports & tickets", icon: FileSearch },
  { href: "/admin/routing", label: "Routing review", icon: Route },
  { href: "/admin/institutions", label: "Institutions", icon: Building2 },
  { href: "/admin/channels", label: "Channel operations", icon: RadioTower },
];

const institutionNavigation = [
  { href: "/institution", label: "Priority queue", icon: Inbox },
  { href: "/institution/tickets", label: "All tickets", icon: TicketCheck },
  { href: "/institution/knowledge", label: "Routing knowledge", icon: BookOpenCheck },
  { href: "/institution/team", label: "Team", icon: UsersRound },
];

function selected(pathname: string, href: string) {
  return href.endsWith("/admin") || href.endsWith("/institution")
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function OperationsShell({
  children,
  kind,
  workspaceName,
  personName,
  roleLabel,
}: {
  children: ReactNode;
  kind: WorkspaceKind;
  workspaceName: string;
  personName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navigation = kind === "admin" ? adminNavigation : institutionNavigation;

  return (
    <div className="operations-shell">
      <aside className={`operations-sidebar ${open ? "is-open" : ""}`}>
        <div className="operations-sidebar-head">
          <Brand compact href={kind === "admin" ? "/admin" : "/institution"} />
          <button aria-label="Close workspace menu" onClick={() => setOpen(false)} type="button"><X size={20} /></button>
        </div>

        <div className="workspace-identity">
          <span>{kind === "admin" ? <ShieldCheck size={15} /> : <Building2 size={15} />}</span>
          <div><small>{kind === "admin" ? "Platform operations" : "Institution workspace"}</small><strong>{workspaceName}</strong></div>
        </div>

        <nav aria-label={kind === "admin" ? "Platform operations" : "Institution operations"}>
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link aria-current={selected(pathname, href) ? "page" : undefined} className={selected(pathname, href) ? "is-active" : ""} href={href} key={href} onClick={() => setOpen(false)} prefetch={false}>
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="workspace-account">
          <div><strong>{personName}</strong><span>{roleLabel}</span></div>
          <form action="/auth/signout" method="post">
            <button type="submit"><LogOut aria-hidden="true" size={16} /> Sign out</button>
          </form>
        </div>
      </aside>

      {open && <button aria-label="Close workspace menu" className="operations-backdrop" onClick={() => setOpen(false)} type="button" />}

      <div className="operations-main">
        <header className="operations-mobile-bar">
          <button aria-expanded={open} aria-label="Open workspace menu" onClick={() => setOpen(true)} type="button"><Menu size={21} /></button>
          <Brand compact href={kind === "admin" ? "/admin" : "/institution"} />
          <span aria-hidden="true"><Activity size={18} /></span>
        </header>
        {children}
      </div>
    </div>
  );
}
