"use client";

// Module error boundary: a failing page keeps the shell, navigation and every other module usable.
import Link from "next/link";
import s from "@/components/skeleton.module.css";

export default function ModuleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={s.error} role="alert">
      <b>This section could not load.</b>
      <span>The rest of Regenera OS is unaffected. It is usually a temporary data-source or connection problem.</span>
      {error.digest ? <small>Reference {error.digest}</small> : null}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn--primary" type="button" onClick={() => reset()}>Try again</button><Link className="btn" href="/today">Today</Link></div>
    </div>
  );
}
