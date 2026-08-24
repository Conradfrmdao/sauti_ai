import Link from "next/link";
import { Building2, FileText, MessageSquareText } from "lucide-react";

import { AppShell } from "@/components/app-shell";

export default function HelpPage() {
  return (
    <AppShell>
      <div className="simple-page">
        <h1 className="page-title">Help</h1>
        <p className="page-subtitle">Choose the part of Sauti1 you need.</p>
        <div className="service-directory">
          <Link href="/chat"><MessageSquareText size={18} /><h2>Describe an issue</h2><p>Text Sauti1 naturally and review everything before submission.</p></Link>
          <Link href="/track"><FileText size={18} /><h2>Track a report</h2><p>See routing, acknowledgement and resolution progress.</p></Link>
          <Link href="/institutions"><Building2 size={18} /><h2>Find an institution</h2><p>View official contact details and services in the Sauti1 catalogue.</p></Link>
        </div>
      </div>
    </AppShell>
  );
}
