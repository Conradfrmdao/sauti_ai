import type { Metadata, Viewport } from "next";

import { SessionBoundary } from "@/components/session-boundary";

import "./globals.css";

export const metadata: Metadata = {
  title: "SAUTI1 AI | Be heard",
  description: "Talk or type to SAUTI1 AI and find the right Ugandan institution for your issue.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><SessionBoundary>{children}</SessionBoundary></body>
    </html>
  );
}
