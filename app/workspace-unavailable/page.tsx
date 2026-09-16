import { Building2, LogOut } from "lucide-react";

import { Brand } from "@/components/brand";

export default function WorkspaceUnavailablePage() {
  return (
    <main className="route-error">
      <Brand />
      <span className="route-error-icon"><Building2 aria-hidden="true" size={22} /></span>
      <p className="eyebrow">Workspace unavailable</p>
      <h1>Your institution workspace is not active.</h1>
      <p>Access is paused while the institution’s operational status is reviewed. Contact your institution administrator or SAUTI1 platform operations.</p>
      <form action="/auth/signout" method="post">
        <button type="submit"><LogOut aria-hidden="true" size={17} /> Sign out</button>
      </form>
    </main>
  );
}
