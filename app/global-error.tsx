"use client";

import { RouteError } from "@/components/route-error";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body><RouteError error={error} reset={reset} scope="SAUTI1" /></body>
    </html>
  );
}
