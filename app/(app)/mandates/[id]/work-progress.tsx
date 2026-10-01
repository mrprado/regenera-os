"use client";

// Drives a mandate's queued background work (queue sync, universe slices) while the page is open, and shows progress.
// Each call runs a few seconds of work on the server; the scheduler finishes anything left if the page is closed.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MandateWork } from "@/lib/mandates/engine";
import { continueMandateWorkAction } from "../../origination-actions";
import f from "../../funding/funding.module.css";

export function WorkProgress({ id, initial }: { id: string; initial: MandateWork }) {
  const router = useRouter();
  const [w, setW] = useState<MandateWork | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const run = async () => {
      while (alive.current) {
        try {
          const next = await continueMandateWorkAction(id);
          if (!alive.current) return;
          setW(next);
          if (!next || next.phase === "done" || next.phase === "failed") { router.refresh(); return; }
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Background work could not continue");
          return;
        }
        await new Promise(r => setTimeout(r, 400));
      }
    };
    void run();
    return () => { alive.current = false; };
  }, [id, router]);

  if (!w) return null;
  const pct = w.total ? Math.round((w.done / w.total) * 100) : 0;
  return (
    <div role="status" aria-live="polite" style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", padding: "10px 0", margin: "0 0 14px" }}>
      <div className={f.inline} style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 13 }}>{w.phase === "failed" ? `Background work stopped: ${w.error ?? ""}` : w.phase === "done" ? `Universe up to date: ${w.total.toLocaleString("en-US")} screened (${w.created} new, ${w.updated} refreshed).` : `${w.label}${w.total ? `: ${w.done.toLocaleString("en-US")} of ${w.total.toLocaleString("en-US")} screened` : "…"}`}</span>
        {w.phase !== "done" && w.phase !== "failed" && <span className={f.muted} style={{ fontSize: 12 }}>Runs in the background; you can leave this page.</span>}
      </div>
      {w.phase !== "done" && w.phase !== "failed" && <div className={f.bar} style={{ marginTop: 8 }}><i style={{ width: `${Math.max(3, pct)}%` }} /></div>}
      {err && <p className={f.warn} style={{ fontSize: 12, margin: "6px 0 0" }}>{err}</p>}
    </div>
  );
}
