// Canonical state machines. Existing stage enums stay authoritative (the tracker stages in lib/projects/vocab and
// lib/vocab); these machines name the allowed moves between them and which moves only a person may make. Nothing here
// removes a stored value: each machine's states are the stored keys.
import { PROJECT_STAGES } from "@/lib/projects/vocab";
import { PERMIT_STATUSES } from "@/lib/regulatory/vocab";

export type Machine = {
  label: string;
  states: Record<string, string>;
  /** Allowed forward moves; any state may also move back one step or to a terminal state listed in `exits`. */
  next: Record<string, string[]>;
  exits: string[];
  /** Moves into these states need a named person (isHuman): AI and automations may only propose them. */
  humanOnly: string[];
};

/** Project gates 0–8 over the 18 tracker stages: the gate is derived, the stage is stored. */
export const PROJECT_GATES = [
  { gate: 0, label: "Opportunity", stages: ["opportunity"], exit: "A signal or lead worth a first look." },
  { gate: 1, label: "Screened", stages: ["screening", "diagnostic"], exit: "Basic site and market viability checked at L1." },
  { gate: 2, label: "Qualified", stages: ["readiness"], exit: "Sponsor, land and grid plausible; land control recorded per parcel." },
  { gate: 3, label: "Development", stages: ["development", "structuring"], exit: "Diligence underway; permits mapped with dependencies." },
  { gate: 4, label: "Investment ready", stages: ["capital_alignment"], exit: "Data room folders filled; parties screened against sanctions lists." },
  { gate: 5, label: "Capital process", stages: ["diligence"], exit: "Financing underway with named counterparties." },
  { gate: 6, label: "Financial close", stages: ["financial_close"], exit: "Funding committed." },
  { gate: 7, label: "Execution", stages: ["engineering", "procurement", "construction", "commissioning"], exit: "Construction and deployment." },
  { gate: 8, label: "Operating", stages: ["cod", "operations", "repowering", "exit", "decommissioning"], exit: "Monitoring and stewardship." },
] as const;

export function gateOf(stage: string) {
  return PROJECT_GATES.find(g => (g.stages as readonly string[]).includes(stage)) ?? PROJECT_GATES[0];
}

const STAGE_KEYS = Object.keys(PROJECT_STAGES);
const linear = (keys: string[]) => Object.fromEntries(keys.map((k, i) => [k, keys.slice(i + 1, i + 2)]));

export const MACHINES: Record<string, Machine> = {
  project: {
    label: "Project", states: PROJECT_STAGES, exits: ["exit", "decommissioning"],
    // Stages may be skipped forward (a project can arrive already in development) but never past financial close
    // without passing through it.
    next: Object.fromEntries(STAGE_KEYS.map((k, i) => {
      const close = STAGE_KEYS.indexOf("financial_close");
      const ahead = STAGE_KEYS.slice(i + 1);
      return [k, i < close ? ahead.filter(s => STAGE_KEYS.indexOf(s) <= close) : ahead];
    })),
    humanOnly: ["capital_alignment", "financial_close", "cod", "exit", "decommissioning"],
  },
  capital_raise: {
    label: "Capital raise",
    states: { identified: "Identified", qualified: "Qualified", prepared: "Prepared", introduced: "Introduced", reviewing: "Reviewing", diligence: "Diligence", term_sheet: "Term sheet", committed: "Committed", closed: "Closed", declined: "Declined" },
    next: linear(["identified", "qualified", "prepared", "introduced", "reviewing", "diligence", "term_sheet", "committed", "closed"]),
    exits: ["declined"], humanOnly: ["introduced", "term_sheet", "committed", "closed"],
  },
  permit: {
    label: "Permit", states: PERMIT_STATUSES,
    next: { not_started: ["preparing"], preparing: ["submitted"], submitted: ["approved", "rejected"], approved: ["renewal", "expired"], renewal: ["approved", "expired"], rejected: ["preparing"], expired: ["renewal", "preparing"] },
    exits: [], humanOnly: ["submitted", "approved", "rejected"],
  },
  engagement: {
    label: "Engagement",
    states: { lead: "Lead", proposal: "Proposal", negotiation: "Negotiation", active: "Active", paused: "Paused", completed: "Completed", terminated: "Terminated" },
    next: { lead: ["proposal"], proposal: ["negotiation", "active"], negotiation: ["active"], active: ["paused", "completed"], paused: ["active", "completed"], completed: [], terminated: [] },
    exits: ["terminated"], humanOnly: ["active", "completed", "terminated"],
  },
  claim: {
    label: "Claim",
    states: { ai_inferred: "AI inferred", assumption: "Assumption", unverified: "Unverified", source_provided: "Source provided", calculated: "Calculated", verified: "Verified", disputed: "Disputed" },
    next: { ai_inferred: ["unverified", "source_provided", "verified"], assumption: ["unverified", "source_provided", "verified"], unverified: ["source_provided", "calculated", "verified"], source_provided: ["verified"], calculated: ["verified"], verified: [], disputed: ["unverified", "verified"] },
    exits: ["disputed"], humanOnly: ["verified", "disputed"],
  },
  signal: {
    label: "Signal",
    states: { new: "New", assessed: "Assessed", acted: "Acted on", dismissed: "Dismissed", expired: "Expired" },
    next: { new: ["assessed"], assessed: ["acted"], acted: [], dismissed: [], expired: [] },
    exits: ["dismissed", "expired"], humanOnly: ["acted", "dismissed"],
  },
};

/** Whether `from → to` is an allowed move in the machine, and whether it needs a person. */
export function transition(machine: string, from: string, to: string): { ok: boolean; humanOnly: boolean; reason?: string } {
  const m = MACHINES[machine];
  if (!m) return { ok: false, humanOnly: false, reason: `Unknown machine ${machine}` };
  if (!(to in m.states)) return { ok: false, humanOnly: false, reason: `Unknown state ${to}` };
  if (from === to) return { ok: true, humanOnly: false };
  const keys = Object.keys(m.states);
  const back = keys.indexOf(to) === keys.indexOf(from) - 1;
  const ok = back || m.exits.includes(to) || (m.next[from] ?? []).includes(to);
  return { ok, humanOnly: m.humanOnly.includes(to), reason: ok ? undefined : `${m.label}: ${m.states[from] ?? from} cannot move to ${m.states[to]}` };
}
