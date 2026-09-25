// Shared labels for the Contracts pages (page files may only export their component).
import { LIFECYCLE, typeLabel } from "./catalog";
import { CONTRACT_KIND_LABEL } from "./templates";

export { CONTRACT_KIND_LABEL };

/** Label for any stored contract: template kind, or the catalog type of a registered agreement. */
export const kindLabel = (c: { kind: string; category?: string | null; contractType?: string | null }) =>
  c.kind === "registered" ? typeLabel(c.category ?? null, c.contractType ?? null) : CONTRACT_KIND_LABEL[c.kind as keyof typeof CONTRACT_KIND_LABEL] ?? c.kind;

export const lifecycleLabel = (s: string) => LIFECYCLE[s as keyof typeof LIFECYCLE] ?? s;

export const CONTRACT_STATUS_LABEL = {
  draft: "Draft",
  sent: "Awaiting signature",
  signed: "Signed",
  completed: "Completed",
  terminated: "Terminated",
} as const;

export const MILESTONE_STATUS_LABEL = { pending: "Pending", invoiced: "Invoiced", paid: "Paid", waived: "Waived" } as const;

export const money = (n: number | null | undefined, currency = "USD") =>
  n === null || n === undefined ? "—" : `${currency} ${Math.round(n).toLocaleString("en-US")}`;
