"use client";

// Module error boundary: a failing page keeps the shell, navigation and every other module usable.
// When the failure follows a form submission (docs/ux-laws.md law 15), say so plainly and offer the form back with
// everything that was typed refilled (components/form-guard.tsx keeps a copy for two minutes).
import Link from "next/link";
import { useSyncExternalStore } from "react";
import s from "@/components/skeleton.module.css";
import { lastSubmission, requestRestore } from "@/components/form-guard";

export default function ModuleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Read once on the client; the server render (no browser storage) shows the general message.
  const saved = useSyncExternalStore(() => () => {}, () => !!lastSubmission(), () => false);
  if (saved) return (
    <div className={s.error} role="alert">
      <b>Your changes were not saved.</b>
      <span>The save did not go through. Usual causes: a value the form could not accept (a required field, a date or a number format), an action your access does not allow, or a brief connection problem. What you typed is kept.</span>
      <span>Return to the form, check the values and save again. If it keeps failing, note the reference below.</span>
      {error.digest ? <small>Reference {error.digest}</small> : null}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn--primary" type="button" onClick={() => { reset(); requestRestore(); }}>Return to the form</button><Link className="btn" href="/today">Command</Link></div>
    </div>
  );
  return (
    <div className={s.error} role="alert">
      <b>This section could not load.</b>
      <span>The rest of Regenera OS is unaffected. It is usually a temporary data-source or connection problem.</span>
      {error.digest ? <small>Reference {error.digest}</small> : null}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn--primary" type="button" onClick={() => reset()}>Try again</button><Link className="btn" href="/today">Command</Link></div>
    </div>
  );
}
