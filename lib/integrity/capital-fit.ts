// Capital criteria vs integrity decision (phase 23). Thematic similarity is never commitment: the investor ladder states
// how far a relationship has actually gone, and a profile's exclusions or safeguard standard can rule a project out.
export const INVESTOR_STATUS = {
  potential_eligibility: "Potential eligibility", preliminary_fit: "Preliminary fit", investor_interest: "Investor interest",
  confirmed_mandate: "Confirmed mandate", approved_investment: "Approved investment",
} as const;

export type ImpactCriteria = { environmental?: string[]; exclusions?: string[]; safeguardStandard?: string; impactReporting?: string; catalytic?: boolean; technicalAssistance?: boolean };

/** Pure: does a capital profile's impact criteria fit a project's integrity decision and text? */
export function capitalFit(criteria: ImpactCriteria | null | undefined, decision: { state: string; classification: string } | null, projectText: string) {
  const notes: string[] = [];
  if (!decision) return { fit: "unknown" as const, notes: ["Project not screened for integrity yet"] };
  if (decision.state === "excluded" || decision.state === "human_review") return { fit: "no" as const, notes: [`Integrity decision: ${decision.state.replace(/_/g, " ")}`] };
  const hit = (criteria?.exclusions ?? []).find(x => x && projectText.toLowerCase().includes(x.toLowerCase()));
  if (hit) return { fit: "no" as const, notes: [`Profile excludes "${hit}"`] };
  if (criteria?.safeguardStandard) notes.push(`Requires ${criteria.safeguardStandard}: confirm the project's E&S documentation meets it`);
  if (decision.state === "redesign_required" || decision.state === "enhanced_due_diligence") notes.push(`Integrity: ${decision.state.replace(/_/g, " ")} before approaching this capital`);
  if (criteria?.technicalAssistance && decision.state !== "eligible") notes.push("Profile offers technical assistance: may fund the readiness work");
  if ((criteria?.environmental ?? []).length) notes.push(`Environmental objectives: ${criteria!.environmental!.join(", ")}`);
  return { fit: decision.state === "eligible" || decision.state === "conditionally_eligible" ? "possible" as const : "conditional" as const, notes };
}
