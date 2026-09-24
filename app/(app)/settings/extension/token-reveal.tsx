"use client";

import { useEffect, useState } from "react";
import ui from "@/components/ui.module.css";

/** Reads a just-issued token from the URL fragment (never sent to the server), shows it once, then clears it. */
export default function TokenReveal() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const m = window.location.hash.match(/^#token=((?:rox|mcpp)_[A-Za-z0-9_-]+)$/);
    if (!m) return;
    history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL fragment on mount
    setToken(m[1]);
  }, []);
  if (!token) return null;
  return (
    <div className={ui.notice}>
      <p style={{ margin: "0 0 6px" }}><b>Your new token.</b> Copy it now. It is not shown again.</p>
      <code style={{ display: "block", wordBreak: "break-all", fontSize: 13, marginBottom: 8 }}>{token}</code>
      <button type="button" className={ui.miniBtn} onClick={() => navigator.clipboard.writeText(token)}>Copy</button>
    </div>
  );
}
