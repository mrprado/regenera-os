"use client";

// Reports uncaught browser errors to /api/client-errors (phase 20 §10), at most 8 per page load and never the same
// message twice. Other code (e.g. the Atlas map) can call reportClientError for errors it catches itself.
import { useEffect } from "react";
import { withBase } from "@/lib/base-path";

let sent = 0;
const seen = new Set<string>();

export function reportClientError(kind: "error" | "unhandledrejection" | "map", message: string, stack = "") {
  if (typeof window === "undefined" || sent >= 8 || !message || seen.has(message)) return;
  seen.add(message); sent++;
  void fetch(withBase("/api/client-errors"), { method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
    body: JSON.stringify({ path: location.pathname + location.search.slice(0, 120), kind, message: message.slice(0, 1000), stack: stack.slice(0, 4000) }) }).catch(() => undefined);
}

export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError("error", e.message || String(e.error), e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
    const onRejection = (e: PromiseRejectionEvent) => { const r = e.reason as Error | undefined; reportClientError("unhandledrejection", r?.message ?? String(e.reason), r?.stack ?? ""); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
