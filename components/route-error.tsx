"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export function RouteError({
  error,
  reset,
  scope = "this page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope?: string;
}) {
  return (
    <main className="route-error" role="alert">
      <span className="route-error-icon"><AlertTriangle aria-hidden="true" size={22} /></span>
      <p className="eyebrow">Something went wrong</p>
      <h1>We could not load {scope}.</h1>
      <p>Your data has not been changed. Check your connection and try again.</p>
      <button onClick={reset} type="button"><RotateCcw aria-hidden="true" size={17} /> Try again</button>
      {error.digest && <small>Reference {error.digest}</small>}
    </main>
  );
}
