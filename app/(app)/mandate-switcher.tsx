"use client";

import { usePathname } from "next/navigation";
import { useRef } from "react";
import { setMandateFocusAction } from "./mandate-actions";
import styles from "./shell.module.css";

/** Shown only to people in more than one mandate. Narrows every screen to one mandate, or all. */
export default function MandateSwitcher({ options, current }: { options: { id: string; name: string }[]; current: string }) {
  const form = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  return (
    <form ref={form} action={setMandateFocusAction} className={styles.switcher}>
      <input type="hidden" name="back" value={pathname} />
      <select name="mandate" aria-label="Mandate" defaultValue={current} onChange={() => form.current?.requestSubmit()}>
        <option value="all">All mandates</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </form>
  );
}
