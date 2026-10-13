"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import ui from "./ui.module.css";

const read = (form: HTMLFormElement) => {
    const active: {name: string; value: string}[] = [];
    for (const el of Array.from(form.elements)) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
      if (!el.name || el.disabled || (el instanceof HTMLInputElement && (el.type === "hidden" || ((el.type === "checkbox" || el.type === "radio") && !el.checked)))) continue;
      if (el.value.trim()) active.push({name: el.labels?.[0]?.textContent?.trim() || el.name, value: el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent || el.value : el.value});
    }
    return active;
  };

/** Shareable GET filters; show the applied values and keep view context on clear. */
export default function FilterForm({ action, children, className }: { action: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [filters, setFilters] = useState<{name: string; value: string}[]>([]);
  const attach = useCallback((node: HTMLFormElement | null) => {
    ref.current = node;
    if (node) setFilters(read(node));
  }, []);
  const push = () => {
    const form = ref.current;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries()) if (typeof v === "string" && v.trim() !== "") params.append(k, v.trim());
    setFilters(read(form));
    router.push(`${withBase(action)}${params.size ? `?${params}` : ""}`);
  };
  const clear = () => {
    const form = ref.current;
    if (!form) return;
    for (const el of Array.from(form.elements)) {
      if (el instanceof HTMLInputElement && el.type !== "hidden" && !["submit", "button"].includes(el.type)) {
        if (el.type === "checkbox" || el.type === "radio") el.checked = false;
        else el.value = "";
      } else if (el instanceof HTMLSelectElement) {
        el.value = "";
        if (el.selectedIndex < 0) el.selectedIndex = 0;
      } else if (el instanceof HTMLTextAreaElement) el.value = "";
    }
    push();
  };
  return (
    <form ref={attach} className={className} action={withBase(action)}
      onSubmit={e => { e.preventDefault(); push(); }}
      onChange={e => { if ((e.target as HTMLElement).tagName === "SELECT") push(); }}>
      {children}
      {filters.length > 0 && <div className={ui.activeFilters} aria-label="Applied filters">
        <span className={ui.sub}>Applied filters</span>
        {filters.map((f, i) => <span className={ui.chip} key={`${f.name}-${i}`}>{f.name}: {f.value}</span>)}
        <button type="button" className={ui.miniBtn} onClick={clear}>Clear filters</button>
      </div>}
    </form>
  );
}
