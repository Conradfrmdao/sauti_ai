import type { Metadata, Viewport } from "next";

import { SessionBoundary } from "@/components/session-boundary";
import { createClient } from "@/lib/supabase/server";

import "./globals.css";

export const metadata: Metadata = {
  title: "SAUTI1 AI",
  description: "One intelligent gateway between citizens and institutions.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const initialUserId = typeof claimsData?.claims?.sub === "string"
    ? claimsData.claims.sub
    : null;

  return (
    <html lang="en">
      <body><SessionBoundary initialUserId={initialUserId}>{children}</SessionBoundary></body>
    </html>
  );
}
