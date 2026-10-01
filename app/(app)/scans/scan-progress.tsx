"use client";

// Drives a queued or running scan while its page is open (a few seconds of bounded work per call) and refreshes the
// page as results land. The scheduler finishes anything left when the page is closed. No invented percentages: the
// total is unknown until discovery ends, so the bar only appears for stages with a known total.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { continueScanAction } from "../scan-actions";

export function ScanProgress({ id }: { id: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const run = async () => {
      while (alive.current) {
        try {
          const { more } = await continueScanAction(id);
          if (!alive.current) return;
          router.refresh();
          if (!more) return;
        } catch (e) { setErr(e instanceof Error ? e.message : "The scan could not continue from this page; the scheduler will resume it."); return; }
        await new Promise(r => setTimeout(r, 800));
      }
    };
    void run();
    return () => { alive.current = false; };
  }, [id, router]);
  return err ? <p role="status" style={{ fontSize: 12.5, color: "var(--warning)" }}>{err}</p> : <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--text-3)" }}>Running in the background; you can leave this page.</p>;
}
