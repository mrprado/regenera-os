// Shared labels for the Contracts pages (page files may only export their component).
export { CONTRACT_KIND_LABEL } from "./templates";

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
