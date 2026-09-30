"use client";

import { usePathname } from "next/navigation";
import { useRef } from "react";
import { setMandateFocusAction } from "./mandate-actions";
import styles from "./shell.module.css";

/** Workspace switcher (the `mandates` table), grouped by organization. Shown only to people in more than one. Narrows every screen to one workspace, or all. */
export default function MandateSwitcher({ options, current }: { options: { id: string; name: string; group?: string }[]; current: string }) {
  const form = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const groups = [...new Set(options.map(o => o.group ?? ""))];
  return (
    <form ref={form} action={setMandateFocusAction} className={styles.switcher}>
      <input type="hidden" name="back" value={pathname} />
      <select name="mandate" aria-label="Workspace" defaultValue={current} onChange={() => form.current?.requestSubmit()}>
        <option value="all">All workspaces</option>
        {groups.length > 1
          ? groups.map(g => <optgroup key={g} label={g}>{options.filter(o => (o.group ?? "") === g).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>)
          : options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </form>
  );
}
