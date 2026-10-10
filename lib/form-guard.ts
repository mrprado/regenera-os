// Pure helpers for components/form-guard.tsx (UX audit 2026-10-10, docs/ux-laws.md laws 6, 14 and 15).

/** Button labels that remove or revoke something: they need a second, deliberate click. */
const DESTRUCTIVE = /^(delete|remove|revoke)\b/i;
export const isDestructiveLabel = (label: string) => DESTRUCTIVE.test(label.trim());

/** Fields worth restoring after a failed save: what a person typed or chose, never hidden ids, passwords or files. */
export const RESTORABLE_TYPES = new Set(["text", "search", "email", "url", "tel", "number", "date", "datetime-local", "month", "time", "week", "textarea", "select-one", "select-multiple", "checkbox", "radio", "range", "color"]);
export const isRestorable = (type: string) => RESTORABLE_TYPES.has(type);

/** Identifies a form on a page across a re-render: page address, its position among forms and its hidden values. */
export function formKey(page: string, index: number, hidden: [string, string][]) {
  return `${page}#${index}|${hidden.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

export type Snapshot = { key: string; page: string; at: number; fields: { name: string; type: string; value: string; checked?: boolean }[] };
/** A saved submission is only offered back for the same page, within two minutes. */
export const snapshotUsable = (s: Snapshot | null, page: string, now: number) => !!s && s.page === page && now - s.at < 120_000 && s.fields.length > 0;
