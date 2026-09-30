// Evidence-based capital fit (hardening prompt §13): no percentage "investor fit". Each dimension is shown as
// Confirmed, Conflict or Unknown from the recorded mandate, and the match as a whole gets an evidence basis.
// The numeric commercialScore stays internal (ordering only) and is never displayed.
// Parses the fixed reason templates written by commercialFit (lib/capital/engine.ts), so stored matches need no migration.

export const FIT_DIMENSIONS = ["Geography", "Sector", "Stage", "Instrument", "Ticket"] as const;
export type FitDimension = (typeof FIT_DIMENSIONS)[number];
export type DimStatus = "confirmed" | "conflict" | "unknown";
export const DIM_STATUS: Record<DimStatus, string> = { confirmed: "Confirmed", conflict: "Conflict", unknown: "Unknown" };

export const FIT_BASIS = {
  known_mandate: "Known mandate fit",
  partial: "Partial evidence",
  unverified: "Unverified",
  conflict: "Conflict",
} as const;
export type FitBasis = keyof typeof FIT_BASIS;

function dimensionOf(reason: string): FitDimension | null {
  const r = reason.toLowerCase();
  if (r.startsWith("geography")) return "Geography";
  if (r.startsWith("sector")) return "Sector";
  if (r.startsWith("stage") || r.startsWith("invests at") || r.startsWith("does not invest at")) return "Stage";
  if (r.startsWith("instrument") || r.startsWith("uses ") || r.startsWith("does not use")) return "Instrument";
  if (r.startsWith("ticket")) return "Ticket";
  return null;
}

function statusOf(reason: string): DimStatus {
  const r = reason.toLowerCase();
  if (r.includes("not known")) return "unknown";
  if (r.includes("does not") || r.includes("not in mandate")) return "conflict";
  return "confirmed";
}

export function fitEvidence(reasons: string[]) {
  const dims = FIT_DIMENSIONS.map(d => {
    const reason = reasons.find(x => dimensionOf(x) === d);
    return { dimension: d, status: reason ? statusOf(reason) : "unknown" as DimStatus, text: reason ?? `${d} not assessed` };
  });
  const confirmed = dims.filter(d => d.status === "confirmed").length;
  const basis: FitBasis = dims.some(d => d.status === "conflict") ? "conflict" : confirmed === dims.length ? "known_mandate" : confirmed >= 2 ? "partial" : "unverified";
  const rationale = basis === "conflict"
    ? `Conflict on ${dims.filter(d => d.status === "conflict").map(d => d.dimension.toLowerCase()).join(", ")}.`
    : basis === "known_mandate" ? "Every dimension is confirmed by the recorded mandate."
    : `${confirmed} of ${dims.length} dimensions confirmed; ${dims.filter(d => d.status === "unknown").map(d => d.dimension.toLowerCase()).join(", ")} not known.`;
  return { dims, basis, rationale };
}
