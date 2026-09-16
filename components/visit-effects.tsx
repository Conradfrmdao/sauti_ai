"use client";

import { useEffect } from "react";

export function MarkDraftsRead({ reportId }: { reportId?: string }) {
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/sauti1/read-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportId ? { reportId } : { all: true }),
      signal: controller.signal,
    }).then((response) => {
      if (response.ok) {
        window.dispatchEvent(new CustomEvent("sauti1:attention-change", { detail: { reset: true } }));
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [reportId]);
  return null;
}
