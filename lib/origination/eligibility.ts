// Funding eligibility engine (phase 22 §5). Hard checks first, on the rules the source states; the outcome is one of five
// states, never a score. Soft factors are listed separately and never change the state. Every unknown becomes a
// diligence question. "Eligible" means: every stated hard rule passes on recorded project facts — still to be confirmed
// with the funder, because published criteria are summaries.
import { applicantGroups } from "@/lib/funding/engine";
import { fundingCovers } from "@/lib/site-intel/opportunity";
import { SECTORS } from "@/lib/vocab";

export const ELIGIBILITY = {
  eligible: "Eligible on stated criteria (confirm with funder)",
  potentially_eligible: "Potentially eligible — requires verification",
  ineligible: "Ineligible",
  insufficient_evidence: "Insufficient evidence",
  expired_or_closed: "Expired or closed",
} as const;
export type Eligibility = keyof typeof ELIGIBILITY;
export type Check = { rule: string; result: "pass" | "fail" | "unknown"; basis: string };
export type CapitalStage = "development" | "construction" | "long_term";

export const CAPITAL_STAGES: Record<CapitalStage, string> = {
  development: "Development capital (land control, studies, permits, engineering, early team)",
  construction: "Project / construction capital (equipment, construction, commissioning)",
  long_term: "Long-term capital (refinancing, operating portfolios, expansion)",
};
const DEV = new Set(["opportunity", "screening", "diagnostic", "readiness"]);
const LONG = new Set(["commissioning", "cod", "operations", "decommissioning"]);
/** Pure: which capital the project needs now, from its recorded stage. */
export const capitalStageOf = (stage: string): CapitalStage => (DEV.has(stage) ? "development" : LONG.has(stage) ? "long_term" : "construction");

export type FundingRules = {
  status: string; deadline: string | null; countries: string[] | null; sectors: string[] | null; applicantTypes: string[] | null;
  amountMin: number | null; amountMax: number | null; currency: string | null; type: string; source: string;
};
export type ProjectFacts = {
  country: string | null; sector: string | null; stage: string; capexUsd: number | null; capitalNeedUsd: number | null;
  sponsorGroups: string[]; // segment groups of sponsor / operator organizations (public, community, corporate, capital, channel)
};

/** Pure: eligibility of one project for one funding record. */
export function assessEligibility(r: FundingRules, p: ProjectFacts, today: string) {
  const checks: Check[] = [];
  if (r.status === "closed" || (r.deadline && r.deadline < today)) {
    return { eligibility: "expired_or_closed" as Eligibility, checks: [{ rule: "Application window", result: "fail" as const, basis: r.deadline ? `Deadline ${r.deadline} has passed` : "Source lists it as closed" }], soft: [], questions: [], capitalStage: capitalStageOf(p.stage) };
  }
  checks.push({ rule: "Application window", result: r.deadline ? "pass" : "unknown", basis: r.deadline ? `Open until ${r.deadline} (${r.source})` : "No deadline stated by the source (unverified)" });

  const geo = p.country ? fundingCovers(r.countries, p.country) : null;
  checks.push({ rule: "Geography", result: geo === "listed" || geo === "global" ? "pass" : geo === "no" ? "fail" : "unknown",
    basis: !p.country ? "Project country not recorded" : geo === "listed" ? `Lists ${p.country}` : geo === "global" ? "States global / developing-country eligibility" : geo === "no" ? `Lists ${(r.countries ?? []).slice(0, 4).join(", ")} only` : "Eligible geography not stated" });

  const os = r.sectors ?? [];
  checks.push({ rule: "Sector", result: !p.sector || !os.length ? "unknown" : os.includes(p.sector) ? "pass" : "fail",
    basis: !p.sector ? "Project sector not recorded" : !os.length ? "Sector not stated by the source" : os.includes(p.sector) ? `${SECTORS[p.sector as keyof typeof SECTORS] ?? p.sector} is listed` : `Source lists ${os.join(", ")}` });

  const groups = applicantGroups(r.applicantTypes ?? []);
  const sponsor = p.sponsorGroups;
  checks.push({ rule: "Applicant type", result: !groups ? "unknown" : !sponsor.length ? "unknown" : sponsor.some(g => groups.has(g)) ? "pass" : "fail",
    basis: !groups ? "Applicant types not stated" : !sponsor.length ? `Source accepts ${[...groups].join(", ")}; the sponsor's type is not recorded` : sponsor.some(g => groups.has(g)) ? `Sponsor type (${sponsor.join(", ")}) is accepted` : `Accepts ${[...groups].join(", ")}; sponsor is ${sponsor.join(", ")}` });

  const need = p.capitalNeedUsd ?? null;
  const usd = !r.currency || r.currency === "USD";
  checks.push({ rule: "Ticket size", result: !need || (!r.amountMin && !r.amountMax) || !usd ? "unknown" : (r.amountMin && need < r.amountMin * 0.5) ? "fail" : "pass",
    basis: !need ? "Project capital need not recorded" : (!r.amountMin && !r.amountMax) ? "Amount not stated by the source" : !usd ? `Amount in ${r.currency}: conversion not applied` : `Need ≈ US$${Math.round(need).toLocaleString("en-US")} vs ${r.amountMin ? `min ${r.amountMin.toLocaleString("en-US")}` : ""}${r.amountMax ? ` max ${r.amountMax.toLocaleString("en-US")}` : ""}` });

  const fail = checks.some(c => c.result === "fail");
  const unknown = checks.filter(c => c.result === "unknown");
  const core = checks.filter(c => c.rule === "Geography" || c.rule === "Applicant type");
  const eligibility: Eligibility = fail ? "ineligible"
    : !p.country || core.every(c => c.result === "unknown") ? "insufficient_evidence"
    : checks.filter(c => ["Geography", "Sector", "Applicant type"].includes(c.rule)).every(c => c.result === "pass") ? "eligible" : "potentially_eligible";

  const soft = [
    r.deadline ? { factor: "Time to deadline", note: `${Math.round((Date.parse(r.deadline) - Date.parse(today)) / 86_400_000)} days` } : null,
    { factor: "Instrument", note: r.type === "tender" ? "Procurement (a contract for services/works, not project financing)" : r.type },
    { factor: "Capital stage", note: CAPITAL_STAGES[capitalStageOf(p.stage)] },
  ].filter((x): x is { factor: string; note: string } => !!x);
  const questions = unknown.map(c => QUESTION[c.rule] ?? `Confirm: ${c.rule}`);
  return { eligibility, checks, soft, questions, capitalStage: capitalStageOf(p.stage) };
}

const QUESTION: Record<string, string> = {
  "Application window": "What is the current application deadline and is the call still open?",
  Geography: "Is the project's country / region eligible under the programme rules?",
  Sector: "Does the programme fund this technology / sector?",
  "Applicant type": "Can the sponsor's legal entity type apply (or must a public body / consortium lead)?",
  "Ticket size": "What are the minimum and maximum amounts, currency and co-financing requirements?",
};
