// The one next step for a project (UX audit 2026-10-10; docs/ux-laws.md laws 1, 9 and 19): the project page has 33 tabs,
// so its Overview opens with the single action that moves this project forward now, and where to take it. Rules run in
// order of what blocks progress first; nothing here changes a record.

export type NextStepInput = {
  id: string;
  stage: string;
  integrity: string | null;             // current policy decision state, null when not screened
  highConstraints: number;              // open constraints rated critical or high
  blockedReadiness: string[];           // labels of readiness dimensions marked blocked
  openFundingMatches: number;           // funding matches still "suggested" (no decision recorded)
  sponsorContact: boolean;              // a sponsor party with an organization or person recorded
  deals: { id: string; stage: string }[];
  capitalNeeds: number;                 // capital requirement lines recorded
};
export type NextStep = { title: string; why: string; href: string; action: string };

const LATE = new Set(["development", "structuring", "capital_alignment", "diligence", "financial_close", "engineering", "procurement", "construction", "commissioning", "cod", "operations", "repowering"]);
const OPEN_DEAL = new Set(["lead", "contacted", "engaged", "call_booked", "proposal", "nurture"]);

export function nextStep(p: NextStepInput): NextStep {
  const at = (q: string) => `/projects/${p.id}${q}`;
  if (!p.integrity) return { title: "Screen the project's integrity", why: "No integrity decision yet. Screening decides whether Regenera may pursue it before anyone is contacted.", href: at("?tab=capital#integrity"), action: "Open integrity screening" };
  if (p.integrity === "excluded" || p.integrity === "human_review") return { title: "An owner must decide on this project", why: `Integrity screening: ${p.integrity === "excluded" ? "excluded" : "human review"}. Proposals, outreach and capital introductions stay blocked until an owner decides with a written reason.`, href: at("?tab=capital#integrity"), action: "Review the decision" };
  if (p.integrity === "redesign_required") return { title: "Review the redesign scenarios", why: "Integrity screening asks for a redesign before the project advances. Compare the original, lower-impact and regenerative versions.", href: at("?tab=capital#integrity"), action: "Open redesign" };
  if (p.highConstraints) return { title: `Resolve ${p.highConstraints} high-severity constraint${p.highConstraints === 1 ? "" : "s"}`, why: "Critical or high constraints block stage movement and diligence.", href: at("?tab=constraints"), action: "Open constraints" };
  if (p.blockedReadiness.length) return { title: `Unblock readiness: ${p.blockedReadiness[0]}`, why: `${p.blockedReadiness.length} readiness dimension${p.blockedReadiness.length === 1 ? " is" : "s are"} marked blocked.`, href: at("?tab=readiness"), action: "Open readiness" };
  if (p.openFundingMatches) return { title: `Decide on ${p.openFundingMatches} funding match${p.openFundingMatches === 1 ? "" : "es"}`, why: "A funding call fits this project. Answer the eligibility questions and record whether it is eligible, with the basis.", href: at("?tab=capital#funding-matches"), action: "Open funding matches" };
  if (!p.sponsorContact) return { title: "Identify the sponsor and its decision maker", why: "No sponsor organization or person is recorded, so there is no one to propose to.", href: at("?tab=stakeholders"), action: "Open stakeholders" };
  const open = p.deals.find(d => OPEN_DEAL.has(d.stage));
  if (!p.deals.length) return { title: "Draft the diagnostic proposal", why: "Cleared and with a sponsor, but no Regenera engagement yet. The draft is integrity-checked and nothing is sent.", href: at("?tab=capital#readiness-rubric"), action: "Draft the proposal" };
  if (open) return { title: "Move the sales conversation forward", why: `The linked deal is at ${open.stage.replace(/_/g, " ")}.`, href: `/deals/${open.id}`, action: "Open the deal" };
  if (!p.capitalNeeds && LATE.has(p.stage)) return { title: "Record what the project must raise", why: "No capital needs are recorded, so capital partners cannot be matched.", href: at("?tab=capital"), action: "Open capital" };
  if (p.stage === "operations") return { title: "Keep stewardship current", why: "Record obligations and impact evidence for the operating asset.", href: at("?tab=capital#integrity"), action: "Open stewardship" };
  return { title: "Complete the readiness record", why: "Nothing is blocking. Recording the remaining readiness dimensions strengthens the case for capital.", href: at("?tab=readiness"), action: "Open readiness" };
}
