"use client";

import { RouteError } from "@/components/route-error";

export default function InstitutionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} scope="the institution workspace" />;
}
