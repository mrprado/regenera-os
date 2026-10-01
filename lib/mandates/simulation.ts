// §17 Counterparty simulation: how an opportunity looks to each counterparty, from the facts the OS holds.
// Rule-based and explicit: every objection names the missing fact or readiness dimension behind it. It is a
// preparation aid, never a substitute for legal, engineering, financial or community professional review.
export type SimFacts = {
  readiness: Partial<Record<string, string>>;   // project readiness dimension → status
  stage?: string | null; sponsorKnown?: boolean; epcAwarded?: boolean | null; ppa?: string | null; gridStatus?: string | null;
  permits?: { name: string; status: string }[]; constraints?: { category: string; severity: string; status: string; title: string }[];
  community?: { consent?: string | null; benefitModel?: boolean }; capex?: number | null; country?: string | null; isDemo?: boolean;
};
export const LENSES = {
  investor: { label: "Investor / IC", question: "What will the investment committee object to?", dims: ["financial", "commercial", "capital", "legal", "land", "grid"] },
  lender: { label: "Lender", question: "What makes this unbankable?", dims: ["commercial", "financial", "legal", "grid", "construction", "environmental"] },
  epc: { label: "EPC contractor", question: "What creates construction or pricing risk?", dims: ["engineering", "technical", "grid", "procurement", "construction", "land"] },
  developer: { label: "Developer", question: "What prevents the site from advancing?", dims: ["land", "permitting", "grid", "environmental", "stakeholder"] },
  offtaker: { label: "Offtaker", question: "What makes the contract unattractive?", dims: ["commercial", "operations", "technical"] },
  grant: { label: "Grant reviewer", question: "Why could the funding application fail?", dims: ["stakeholder", "environmental", "financial", "legal"] },
  permitting: { label: "Permitting authority", question: "What approvals or studies will be requested?", dims: ["permitting", "environmental", "land", "stakeholder"] },
  community: { label: "Community", question: "Where may benefit alignment, consent, trust or access fail?", dims: ["stakeholder", "land", "environmental"] },
  insurer: { label: "Insurer", question: "What risks will materially affect coverage?", dims: ["construction", "technical", "environmental", "operations"] },
} as const;
export type Lens = keyof typeof LENSES;
export const SIM_READINGS = { ready: "Ready to engage", conditional: "Engage with conditions", not_ready: "Not ready", unknown: "Insufficient information" } as const;

const GOOD = new Set(["ready", "substantially_ready", "not_applicable"]);
const BAD = new Set(["blocked"]);
const DOCS: Record<string, string> = {
  financial: "Financial model and assumptions book", commercial: "PPA / offtake term sheet or executed PPA", capital: "Capital stack and sources / uses", legal: "Corporate and title documents",
  land: "Land control evidence (lease, option, title)", grid: "Interconnection agreement / studies", engineering: "Design report and single-line diagram", technical: "Energy yield report",
  environmental: "Environmental impact assessment", permitting: "Permit register with status", stakeholder: "Stakeholder engagement record", procurement: "Procurement plan / equipment quotes",
  construction: "Construction schedule and EPC scope", operations: "O&M plan",
};

export function simulate(lens: Lens, f: SimFacts) {
  const l = LENSES[lens];
  const objections: string[] = [], missing: string[] = [], risks: string[] = [], actions: string[] = [], documents: string[] = [];
  let known = 0, good = 0, bad = 0;
  for (const d of l.dims) {
    const s = f.readiness[d] ?? "unknown";
    if (s === "unknown" || s === "not_started") { missing.push(`${d}: status ${s.replace("_", " ")}`); documents.push(DOCS[d]); continue; }
    known++;
    if (GOOD.has(s)) good++;
    else if (BAD.has(s)) { bad++; objections.push(`${d} is blocked`); actions.push(`Resolve the ${d} blocker before engaging this counterparty.`); }
    else { objections.push(`${d} is ${s.replace("_", " ")}`); documents.push(DOCS[d]); }
  }
  for (const c of (f.constraints ?? []).filter(c => c.status !== "resolved" && (c.severity === "high" || c.severity === "critical"))) {
    if (l.dims.some(d => c.category === d || (d === "commercial" && c.category === "offtake") || (d === "stakeholder" && c.category === "community"))) risks.push(`${c.severity}: ${c.title}`);
  }
  if (!f.sponsorKnown && (lens === "investor" || lens === "lender" || lens === "epc")) { objections.push("Sponsor not identified"); actions.push("Identify the sponsor and its track record."); }
  if ((lens === "lender" || lens === "investor") && !f.ppa) { missing.push("Offtake / PPA status"); documents.push(DOCS.commercial); }
  if (lens === "epc" && f.epcAwarded) objections.push("An EPC appears to be awarded already.");
  if (lens === "community" && !f.community?.consent) { missing.push("Consent status recorded by the community record"); actions.push("Record consent status through the community module (governed knowledge stays governed)."); }
  if (lens === "community" && !f.community?.benefitModel) actions.push("Define a community benefit model before engagement.");
  if (lens === "lender" && f.country && !/^(US|USA|GB|GBR|DE|DEU|ES|ESP|FR|FRA|CA|CAN|AU|AUS)$/i.test(f.country)) risks.push("Country and currency risk: confirm political-risk and FX mitigation.");
  const reading: keyof typeof SIM_READINGS = known === 0 ? "unknown" : bad > 0 || risks.some(r => r.startsWith("critical")) ? "not_ready" : good === l.dims.length && !objections.length ? "ready" : known < l.dims.length / 2 ? "unknown" : "conditional";
  return { lens, label: l.label, question: l.question, reading, basis: `${good} of ${l.dims.length} relevant readiness dimensions ready, ${known} assessed${f.isDemo ? " (DEMO record)" : ""}.`, objections, missing, risks, actions: [...new Set(actions)], documents: [...new Set(documents.filter(Boolean))] };
}

export const simulateAll = (f: SimFacts) => (Object.keys(LENSES) as Lens[]).map(l => simulate(l, f));
