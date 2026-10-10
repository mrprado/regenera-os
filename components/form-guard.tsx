"use client";
// Shared form behaviour for every server-action form (UX audit 2026-10-10; docs/ux-laws.md):
//  · Law 6  — a submitted form shows it is working at once and ignores a second submit until the result arrives.
//  · Law 14 — Delete / Remove / Revoke buttons (or any button with data-confirm) need a second click within 5 s.
//  · Law 15 — what was typed is kept: if the save fails, the error page offers to return to the form with it refilled.
// It never changes React-owned text or disables a submitter before React reads the form data.
import { useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import { usePathname, useSearchParams } from "next/navigation";
import { formKey, isDestructiveLabel, isRestorable, snapshotUsable, type Snapshot } from "@/lib/form-guard";

const SNAPSHOT = "regenera:last-submit";
const RESTORE_EVENT = "regenera:restore-form";
// React server-action forms render as POST with an empty (or javascript:) action; downloads and new-tab forms are left alone.
const isActionForm = (form: HTMLFormElement) => { const a = form.getAttribute("action") ?? ""; return form.method === "post" && !form.target && (a === "" || a.startsWith("javascript:")); };
const page = () => location.pathname + location.search;

function keyOf(form: HTMLFormElement) {
  const index = [...document.querySelectorAll("form")].indexOf(form);
  const hidden = [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')].map(i => [i.name, i.value] as [string, string]);
  return formKey(page(), index, hidden);
}

function snapshot(form: HTMLFormElement): Snapshot {
  const fields = [...form.elements].flatMap(el => {
    const f = el as HTMLInputElement;
    if (!f.name || f.disabled || !isRestorable(f.type)) return [];
    if (f.type === "checkbox" || f.type === "radio") return [{ name: f.name, type: f.type, value: f.value, checked: f.checked }];
    if (f.type === "select-multiple") return [{ name: f.name, type: f.type, value: JSON.stringify([...(f as unknown as HTMLSelectElement).selectedOptions].map(o => o.value)) }];
    return [{ name: f.name, type: f.type, value: f.value }];
  });
  return { key: keyOf(form), page: page(), at: Date.now(), fields };
}

/** Sets a value the way a person would, so React-controlled fields keep it too. */
function setField(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, f: Snapshot["fields"][number]) {
  if (f.type === "checkbox" || f.type === "radio") { if (el instanceof HTMLInputElement && el.value === f.value && el.checked !== f.checked) el.click(); return; }
  if (f.type === "select-multiple" && el instanceof HTMLSelectElement) { const v = new Set(JSON.parse(f.value) as string[]); for (const o of el.options) o.selected = v.has(o.value); el.dispatchEvent(new Event("change", { bubbles: true })); return; }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, f.value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function restore(): boolean {
  let saved: Snapshot | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(SNAPSHOT) ?? "null"); } catch { return true; }
  if (!saved) return true;
  const form = [...document.querySelectorAll("form")].find(f => keyOf(f) === saved!.key);
  if (!form) return false;
  let first: HTMLElement | null = null;
  for (const f of saved.fields) {
    const els = [...form.elements].filter(e => (e as HTMLInputElement).name === f.name) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    for (const el of els) { setField(el, f); first ??= el as unknown as HTMLElement; }
  }
  first?.focus();
  first?.scrollIntoView({ block: "center" });
  try { sessionStorage.removeItem(SNAPSHOT); } catch { /* storage unavailable */ }
  return true;
}

export default function FormGuard({ viewOnly = false }: { viewOnly?: boolean }) {
  // View-only users (open access, read-only accounts) learn before submitting that changes need a sign-in (law 14).
  const [blockedNote, setBlockedNote] = useState(false);
  const pathname = usePathname(), params = useSearchParams();
  const live = useRef<HTMLParagraphElement>(null);
  const say = (text: string) => { if (live.current) { live.current.textContent = ""; requestAnimationFrame(() => { if (live.current) live.current.textContent = text; }); } };

  // A new page (the usual result of a save) ends every pending state; the saved input is no longer needed.
  useEffect(() => {
    document.querySelectorAll<HTMLFormElement>("form[data-pending]").forEach(f => { delete f.dataset.pending; f.removeAttribute("aria-busy"); });
    try { const s = JSON.parse(sessionStorage.getItem(SNAPSHOT) ?? "null") as Snapshot | null; if (s && s.page !== page()) sessionStorage.removeItem(SNAPSHOT); } catch { /* storage unavailable */ }
  }, [pathname, params]);

  useEffect(() => {
    const disarm = (b: HTMLElement) => { delete b.dataset.armed; };
    const onClick = (e: MouseEvent) => {
      const b = (e.target as Element | null)?.closest<HTMLButtonElement>("button");
      if (!b || !b.form || (b.type && b.type !== "submit")) return;
      if (!(b.dataset.confirm !== undefined || isDestructiveLabel(b.textContent ?? ""))) return;
      if (b.dataset.armed) { disarm(b); return; }
      e.preventDefault(); e.stopPropagation();
      b.dataset.armed = "1";
      say(`${(b.textContent ?? "").trim()}: press again within 5 seconds to confirm. This cannot be undone.`);
      window.setTimeout(() => disarm(b), 5000);
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement) || !isActionForm(form)) return;
      if (viewOnly) { e.preventDefault(); e.stopImmediatePropagation(); setBlockedNote(true); say("View only: sign in to make changes. Nothing was saved."); window.setTimeout(() => setBlockedNote(false), 8000); return; }
      if (form.dataset.pending) { e.preventDefault(); e.stopImmediatePropagation(); say("Still saving the previous submission."); return; }
      const snap = snapshot(form);
      try { if (snap.fields.length) sessionStorage.setItem(SNAPSHOT, JSON.stringify(snap)); } catch { /* storage unavailable */ }
      // After React has read the form data: mark it busy (styles show the state; a second submit is ignored).
      window.setTimeout(() => { form.dataset.pending = "1"; form.setAttribute("aria-busy", "true"); say("Saving…"); }, 0);
      window.setTimeout(() => { if (form.dataset.pending) { delete form.dataset.pending; form.removeAttribute("aria-busy"); } }, 20_000);
    };
    // React resets a form after a successful action that stays on the page.
    const onReset = (e: Event) => { const form = e.target as HTMLFormElement; if (form?.dataset?.pending) { delete form.dataset.pending; form.removeAttribute("aria-busy"); say("Saved."); } try { sessionStorage.removeItem(SNAPSHOT); } catch { /* storage unavailable */ } };
    const onRestore = () => { let tries = 0; const attempt = () => { if (!restore() && ++tries < 20) window.setTimeout(attempt, 100); }; attempt(); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("reset", onReset, true);
    window.addEventListener(RESTORE_EVENT, onRestore);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); document.removeEventListener("reset", onReset, true); window.removeEventListener(RESTORE_EVENT, onRestore); };
  }, [viewOnly]);

  return <>{blockedNote && <p role="alert" className="form-guard-note">View only: nothing was saved. <a href={withBase(`/signin?return_to=${encodeURIComponent(page())}`)}>Sign in</a> to make changes.</p>}<p ref={live} className="sr-only" aria-live="polite" role="status" /></>;
}

/** For error boundaries: whether a just-submitted form can be refilled, and the action that does it. */
export function lastSubmission(): Snapshot | null {
  try { const s = JSON.parse(sessionStorage.getItem(SNAPSHOT) ?? "null") as Snapshot | null; return snapshotUsable(s, page(), Date.now()) ? s : null; } catch { return null; }
}
export const requestRestore = () => window.setTimeout(() => window.dispatchEvent(new Event(RESTORE_EVENT)), 50);
