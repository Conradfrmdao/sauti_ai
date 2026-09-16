import type { Metadata, Viewport } from "next";

import { SessionBoundary } from "@/components/session-boundary";

import "./globals.css";

import './product.css';

const description = "Report a public-service issue, reach the right Ugandan institution, and follow the response from submission to resolution.";

function configuredMetadataBase() {
  const candidate = process.env.APP_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL;
  if (!candidate?.trim()) return undefined;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined;
    url.pathname = "/";
    url.search = "";
    return url;
  } catch {
    return undefined;
  }
}

const metadataBase = configuredMetadataBase();
const socialImage = metadataBase ? new URL("/og.png", metadataBase) : undefined;

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "SAUTI1 | Civic reporting for Uganda",
    template: "%s | SAUTI1",
  },
  description,
  applicationName: "SAUTI1",
  openGraph: {
    type: "website",
    siteName: "SAUTI1",
    title: "SAUTI1 | Civic reporting for Uganda",
    description,
    images: socialImage ? [{
      url: socialImage,
      width: 1730,
      height: 909,
      alt: "SAUTI1 — Report civic issues. Reach the right institution.",
    }] : undefined,
  },
  twitter: {
    card: "summary_large_image",
    title: "SAUTI1 | Civic reporting for Uganda",
    description,
    images: socialImage ? [socialImage] : undefined,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#081a33",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><SessionBoundary>{children}</SessionBoundary></body>
    </html>
  );
}
