// Funding origination engine, pure part (docs/plans/phase-11-funding-origination.md). Readiness, evidence flags,
// the ideal applicant profile from the call metadata, engagement and practice economics, capacity and hiring
// guidance, consortium gaps and funding inside a capital stack. No function here outputs a probability of award or a
// 0–100 fit; the keyword count survives only as a discovery signal.
import type { ApplicantProfile, FundingDetails } from "@/db/funding";
import { APPLICANT_CLASSES, CONTINGENT_FLAG, FUNDING_KINDS, kindFromLegacy, READINESS_DIMENSIONS, type FundingKind, type FundingLine, type ReadinessDimension, type ReadinessState } from "./vocab";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

export type Cell = { status: string; note: string; source: string };

/** The opportunity's §16 kind: the recorded one, else derived (and labelled derived). */
export function kindOf(o: { kind: string | null; type: string; title: string }): { kind: FundingKind; derived: boolean } {
  if (o.kind && o.kind in FUNDING_KINDS) return { kind: o.kind as FundingKind, derived: false };
  return { kind: kindFromLegacy(o.type, o.title), derived: true };
}

// ---------- §11 readiness ----------
const SEVERITY: Record<ReadinessState, number> = { not_eligible: 5, blocked: 4, incomplete: 3, unknown: 2, ready_conditions: 1, ready: 0 };

/** Blank readiness: every dimension Unknown. */
export const blankReadiness = (): Record<ReadinessDimension, Cell> =>
  Object.fromEntries(Object.keys(READINESS_DIMENSIONS).map(k => [k, { status: "unknown", note: "", source: "" }])) as Record<ReadinessDimension, Cell>;

/** Summary of readiness without a score: counts per state, the dimensions that hold it back, and a headline state. */
export function readinessSummary(cells: Partial<Record<string, Cell>>) {
  const dims = Object.keys(READINESS_DIMENSIONS) as ReadinessDimension[];
  const state = (d: ReadinessDimension) => ((cells[d]?.status ?? "unknown") in SEVERITY ? cells[d]!.status : "unknown") as ReadinessState;
  const counts = Object.fromEntries(Object.keys(SEVERITY).map(k => [k, 0])) as Record<ReadinessState, number>;
  for (const d of dims) counts[state(d)]++;
  const worst = dims.reduce<ReadinessState>((w, d) => (SEVERITY[state(d)] > SEVERITY[w] ? state(d) : w), "ready");
  const holding = dims.filter(d => SEVERITY[state(d)] >= 3);
  // A "ready" claim needs a source on every dimension marked ready.
  const unsourced = dims.filter(d => ["ready", "ready_conditions"].includes(state(d)) && !cells[d]?.source?.trim());
  const headline: ReadinessState = worst === "unknown" && counts.unknown === dims.length ? "unknown" : worst;
  return { counts, headline, holding, unsourced, assessed: dims.length - counts.unknown, total: dims.length };
}

/** Readiness cell for timing, derived from the deadline (the only dimension the OS can compute). */
export function timingCell(deadline: string | null, today: string, workDays = 30): Cell {
  if (!deadline) return { status: "unknown", note: "No fixed deadline stated.", source: "call" };
  const d = Math.round((Date.parse(`${deadline}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (d < 0) return { status: "blocked", note: "Deadline has passed.", source: "call deadline" };
  if (d < Math.min(10, workDays / 3)) return { status: "blocked", note: `${d} days left: too short for a credible application.`, source: "call deadline" };
  if (d < workDays) return { status: "ready_conditions", note: `${d} days left: feasible only with a compressed workplan.`, source: "call deadline" };
  return { status: "ready", note: `${d} days left.`, source: "call deadline" };
}

// ---------- §65, §73 evidence flags and the executive strip ----------
export type StripItem = { label: string; value: string; tone: "ok" | "warn" | "risk" | "muted" };

export function executiveStrip(o: { deadline: string | null; applicantTypes: string[] | null; countries: string[] | null; cofinancingPct: number | null; matchRequirement: string | null },
  ctx: { today: string; prospects: { eligibility: string }[]; applicantAssigned: boolean; consortiumNeeded: boolean | null; consortiumGaps: number | null; alignment?: string }): StripItem[] {
  const days = o.deadline ? Math.round((Date.parse(`${o.deadline}T12:00:00Z`) - Date.parse(`${ctx.today}T12:00:00Z`)) / 86_400_000) : null;
  const confirmed = ctx.prospects.some(p => p.eligibility === "confirmed");
  const likely = ctx.prospects.some(p => p.eligibility === "likely");
  return [
    { label: "Eligibility", value: confirmed ? "Confirmed for an applicant" : likely ? "Likely; needs review" : "Needs review", tone: confirmed ? "ok" : "warn" },
    { label: "Applicant", value: ctx.applicantAssigned ? "Assigned" : "Not assigned", tone: ctx.applicantAssigned ? "ok" : "muted" },
    { label: "Strategic fit", value: ctx.alignment ?? "Potential", tone: "muted" },
    { label: "Timing", value: days === null ? "Rolling / not stated" : days < 0 ? "Closed" : `${days} days${days <= 21 ? " · high risk" : days <= 45 ? " · tight" : ""}`, tone: days === null ? "muted" : days <= 21 ? "risk" : days <= 45 ? "warn" : "ok" },
    { label: "Consortium", value: ctx.consortiumNeeded === null ? "Unknown" : !ctx.consortiumNeeded ? "Not required" : ctx.consortiumGaps === null ? "Required; not started" : ctx.consortiumGaps ? `${ctx.consortiumGaps} gap(s)` : "Complete", tone: ctx.consortiumNeeded && (ctx.consortiumGaps ?? 1) > 0 ? "warn" : "muted" },
    { label: "Match", value: o.matchRequirement || (o.cofinancingPct != null ? `${o.cofinancingPct}% co-finance` : "Not stated"), tone: o.cofinancingPct ? "warn" : "muted" },
  ];
}

export function evidenceFlags(input: { deadlineDays: number | null; eligibilityConfirmed: boolean; missingEvidence: number; consortiumGaps: number; matchGap: boolean; registrationGaps: number; competitive?: boolean }) {
  const f: string[] = [];
  if (input.eligibilityConfirmed) f.push("eligibility_confirmed");
  if (input.missingEvidence === 0 && input.eligibilityConfirmed) f.push("strong_evidence");
  if (input.missingEvidence > 0) f.push("missing_evidence");
  if (input.deadlineDays !== null && input.deadlineDays <= 21) f.push("deadline_risk");
  if (input.consortiumGaps > 0) f.push("partner_gap");
  if (input.matchGap) f.push("match_gap");
  if (input.registrationGaps > 0) f.push("registration_gap");
  if (input.competitive) f.push("high_competition");
  return f;
}

// ---------- §6 ideal applicant profile (deterministic; the AI version replaces it with basis call_text) ----------
const CLASS_PATTERNS: [keyof typeof APPLICANT_CLASSES, RegExp][] = [
  ["municipality", /municipal|city|county|local government|town/], ["public_sector", /government|state agenc|public (body|entit|sector)|ministr|authorit/],
  ["utility", /utilit|water district|electric cooperative/], ["nonprofit", /nonprofit|non-profit|ngo|501\(c\)|charit/], ["university", /universit|college|higher education|academ/],
  ["research", /research (institut|organi)|laborator/], ["community", /community|cooperative|civil society|grassroots/], ["tribal", /tribal|indigenous|first nation/],
  ["sme", /\bsme\b|small business|micro/], ["company", /business|compan|for-profit|private sector|enterprise|industry/], ["developer", /developer|project sponsor/], ["consortium", /consorti|partnership|coalition/],
];

export function classesFrom(text: string): (keyof typeof APPLICANT_CLASSES)[] {
  const t = text.toLowerCase();
  return CLASS_PATTERNS.filter(([, re]) => re.test(t)).map(([k]) => k);
}

const TITLES: Partial<Record<keyof typeof APPLICANT_CLASSES, string[]>> = {
  municipality: ["City manager", "Director of public works", "Grants manager", "Sustainability director"], public_sector: ["Program director", "Grants administrator"],
  utility: ["General manager", "Director of operations", "Grants / capital programs manager"], nonprofit: ["Executive director", "Development director", "Program director"],
  university: ["Office of sponsored programs", "Center director", "Dean of workforce / continuing education"], research: ["Principal investigator", "Research director"],
  community: ["Executive director", "Board chair"], tribal: ["Tribal administrator", "Environmental director"], company: ["CEO", "Head of business development", "CFO"],
  sme: ["Founder / CEO"], developer: ["Head of development", "CFO"], consortium: ["Consortium lead"],
};

export function inferredProfile(o: { applicantTypes: string[] | null; countries: string[] | null; sectors: string[] | null; description: string; cofinancingPct: number | null; details: FundingDetails; read: { consortium?: boolean } | null }, actor: string, now = new Date()): ApplicantProfile {
  const classes = classesFrom([...(o.applicantTypes ?? []), ...(o.details.eligibility?.orgTypes ?? [])].join(" ") || o.description.slice(0, 3000));
  const text = o.description.toLowerCase();
  const capabilities = [
    /training|workforce|apprentice/.test(text) && "Workforce training delivery", /employer|placement/.test(text) && "Employer partnerships and measurable placement outcomes",
    /monitor|report|evaluat/.test(text) && "Monitoring, evaluation and reporting", /infrastructure|construct|capital project/.test(text) && "Capital project delivery",
    /research|pilot|demonstrat/.test(text) && "Research / pilot delivery", /community|engagement|outreach/.test(text) && "Community engagement",
    "Program administration and financial management",
  ].filter((x): x is string => !!x);
  return {
    entityClasses: classes.map(c => APPLICANT_CLASSES[c]), geography: (o.countries ?? []).join(", ") || o.details.eligibility?.geography || "Not stated",
    sectors: o.sectors ?? [], capabilities, projectTypes: o.details.objectives?.priorities ?? [], minCapacity: "Not stated in the metadata; confirm against the call.",
    maturity: o.details.eligibility?.maturity ?? "Not stated", requiredPartners: o.details.requiredPartners ?? (o.read?.consortium ? ["Consortium partners (call indicates a consortium)"] : []),
    evidence: o.details.objectives?.kpis ?? [], matchCapacity: o.cofinancingPct ? `${o.cofinancingPct}% co-finance` : "Not stated",
    compliance: o.details.eligibility?.registrations ?? [], decisionMakerTitles: [...new Set(classes.flatMap(c => TITLES[c] ?? []))],
    basis: "inferred", generatedBy: actor, generatedAt: now.toISOString(), reviewedBy: null,
  };
}

/** How well an organization matches the profile: dimension by dimension, never a number. */
export function profileMatch(p: ApplicantProfile, org: { country: string | null; location: string | null; sector: string | null; industry: string | null; description: string | null; name: string }) {
  const orgText = `${org.name} ${org.industry ?? ""} ${org.description ?? ""}`;
  const orgClasses = classesFrom(orgText).map(c => APPLICANT_CLASSES[c]);
  const classMatch = p.entityClasses.length === 0 ? "unknown" : orgClasses.some(c => p.entityClasses.includes(c)) ? "match" : orgClasses.length ? "mismatch" : "unknown";
  const place = `${org.country ?? ""} ${org.location ?? ""}`.toLowerCase();
  const geo = /not stated|global|worldwide/i.test(p.geography) ? "unknown" : !place.trim() ? "unknown" : p.geography.toLowerCase().split(/,\s*/).some(g => g && place.includes(g.toLowerCase())) ? "match" : "mismatch";
  const sector = !p.sectors.length || !org.sector ? "unknown" : p.sectors.includes(org.sector) ? "match" : "mismatch";
  const eligibility = classMatch === "mismatch" || geo === "mismatch" ? "uncertain" : classMatch === "match" && geo === "match" ? "likely" : "uncertain";
  const missing = [classMatch === "unknown" && "Organization type", geo === "unknown" && "Location", sector === "unknown" && "Sector"].filter((x): x is string => !!x);
  return { classMatch, geo, sector, eligibility: eligibility as "likely" | "uncertain", orgClasses, missing };
}

// ---------- §18–19 consortium gaps ----------
export function consortiumGaps(required: string[], members: { role: string; name: string; status: string; capability: string }[]) {
  return required.map(req => {
    const k = req.toLowerCase();
    const hit = members.find(m => m.status !== "declined" && (`${m.role} ${m.capability} ${m.name}`.toLowerCase().includes(k.split(/\s+/)[0]) || k.includes(m.role)));
    return { requirement: req, member: hit?.name ?? null, status: hit ? (hit.status === "confirmed" ? "confirmed" : "in_discussion") : "missing" };
  });
}

// ---------- §31–35 engagement economics ----------
export type CostLine = { role: string; person?: string; hours: number; rate: number };

export function deliveryEconomics(input: { fee: number; lines: CostLine[]; otherCost?: number; months?: number }) {
  const labour = input.lines.reduce((a, l) => a + l.hours * l.rate, 0);
  const hours = input.lines.reduce((a, l) => a + l.hours, 0);
  const cost = labour + (input.otherCost ?? 0);
  const gp = input.fee - cost;
  const byRole = new Map<string, number>();
  for (const l of input.lines) byRole.set(l.role, (byRole.get(l.role) ?? 0) + l.hours * l.rate);
  return {
    fee: r2(input.fee), hours: r1(hours), labourCost: r2(labour), otherCost: r2(input.otherCost ?? 0), cost: r2(cost), grossProfit: r2(gp),
    grossMarginPct: input.fee > 0 ? r1((gp / input.fee) * 100) : null, effectiveRate: hours > 0 ? r2(input.fee / hours) : null,
    byRole: [...byRole.entries()].map(([role, c]) => ({ role, cost: r2(c) })),
    annualizedRevenue: input.months ? r2(input.fee * 12) : null,
  };
}

/** Planned vs actual for an engagement: planned from budget lines, actual from time entries at each person's rate. */
export function plannedVsActual(input: { fee: number; budget: CostLine[]; time: { person: string; hours: number }[]; rates: Map<string, number>; otherCost: number }) {
  const planned = deliveryEconomics({ fee: input.fee, lines: input.budget, otherCost: input.otherCost });
  const unknown = new Set<string>();
  const lines: CostLine[] = input.time.map(t => {
    const rate = input.rates.get(t.person.toLowerCase());
    if (rate == null) unknown.add(t.person);
    return { role: t.person, hours: t.hours, rate: rate ?? 0 };
  });
  const actual = deliveryEconomics({ fee: input.fee, lines, otherCost: input.otherCost });
  return { planned, actual, unratedPeople: [...unknown], hoursVariance: r1(actual.hours - planned.hours) };
}

export function contingentWarning(feeBasis: string | null | undefined, kind: FundingKind) {
  if (feeBasis !== "contingent") return null;
  return FUNDING_KINDS[kind].procurement ? `${CONTINGENT_FLAG} Procurement: contingent fees to the bidder's advisers are often prohibited.` : CONTINGENT_FLAG;
}

// ---------- §40–42 capacity ----------
export const mondayOf = (d: string) => { const t = new Date(`${d}T12:00:00Z`); const w = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - w); return t.toISOString().slice(0, 10); };
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type MemberLite = { id: string; name: string; role: string; weeklyHours: number; utilizationTarget: number; leave: { from: string; to: string }[] };
export type AllocationLite = { memberId: string; weekStart: string; hours: number; kind: "client" | "internal" | "leave" };

export function weekCapacity(m: MemberLite, allocs: AllocationLite[], week: string) {
  const mine = allocs.filter(a => a.memberId === m.id && a.weekStart === week);
  const leaveDays = m.leave.reduce((n, l) => { let c = 0; for (let i = 0; i < 5; i++) { const d = addDays(week, i); if (d >= l.from && d <= l.to) c++; } return n + c; }, 0);
  const available = Math.max(0, m.weeklyHours * (1 - leaveDays / 5) - mine.filter(a => a.kind === "leave").reduce((a, x) => a + x.hours, 0));
  const client = mine.filter(a => a.kind === "client").reduce((a, x) => a + x.hours, 0);
  const internal = mine.filter(a => a.kind === "internal").reduce((a, x) => a + x.hours, 0);
  const allocated = client + internal;
  return { week, available: r1(available), allocated: r1(allocated), client: r1(client), internal: r1(internal), utilizationPct: available > 0 ? r1((allocated / available) * 100) : allocated > 0 ? 999 : 0, free: r1(available - allocated) };
}

/** §41 Warnings for Command. The OS never accepts or declines work itself. */
export function capacityWarnings(members: MemberLite[], allocs: AllocationLite[], weeks: string[], deadlines: { date: string; label: string }[]) {
  const out: { key: string; issue: string; severity: "high" | "medium"; week: string }[] = [];
  for (const w of weeks) for (const m of members) {
    const c = weekCapacity(m, allocs, w);
    if (c.utilizationPct > m.utilizationTarget) out.push({ key: `util:${m.id}:${w}`, issue: `${m.name} (${m.role.replace("_", " ")}) at ${Math.round(c.utilizationPct)}% allocation week of ${w} (target ${m.utilizationTarget}%)`, severity: c.utilizationPct >= 100 ? "high" : "medium", week: w });
  }
  for (const role of ["proposal_manager", "analyst", "sme"]) {
    const team = members.filter(m => m.role === role);
    for (const w of weeks) {
      const cs = team.map(m => weekCapacity(m, allocs, w));
      const avail = cs.reduce((a, c) => a + c.available, 0), alloc = cs.reduce((a, c) => a + c.allocated, 0);
      if (team.length && avail > 0 && alloc / avail > 0.9) out.push({ key: `role:${role}:${w}`, issue: `${role === "proposal_manager" ? "Proposal team" : role === "sme" ? "Specialist capacity" : "Analyst capacity"} reaches ${Math.round((alloc / avail) * 100)}% allocation week of ${w}`, severity: "high", week: w });
    }
  }
  for (const w of weeks) {
    const n = deadlines.filter(d => d.date >= w && d.date <= addDays(w, 6)).length;
    if (n >= 3) out.push({ key: `cluster:${w}`, issue: `${n} application deadlines in the week of ${w}`, severity: "high", week: w });
  }
  return out;
}

/** §42 Guidance only: sustained utilization of a role's work over the weeks given. */
export function hiringGuidance(utilizationByWeek: number[]) {
  if (!utilizationByWeek.length) return { avg: null, guidance: "No allocation history yet." };
  const avg = utilizationByWeek.reduce((a, b) => a + b, 0) / utilizationByWeek.length;
  const sustained60 = utilizationByWeek.length >= 12 && utilizationByWeek.slice(-12).every(u => u >= 60);
  return {
    avg: r1(avg),
    guidance: sustained60 ? "Above 60% for about 3 months: consider a full-time hire." : avg < 30 ? "Below 30%: contract / freelance." : avg < 60 ? "30–60%: fractional or retainer." : "Around 60%+: watch for three sustained months before hiring.",
  };
}

// ---------- §36, §49–51 practice scenarios ----------
export type ScenarioInputs = Record<string, number>;
export const SCENARIO_FIELDS: { key: string; label: string; group: "volume" | "price" | "cost" | "people" }[] = [
  { key: "diagnosticsPerMonth", label: "Diagnostics / month", group: "volume" }, { key: "diagnosticFee", label: "Diagnostic fee", group: "price" },
  { key: "applicationsPerYear", label: "Applications / year", group: "volume" }, { key: "applicationFee", label: "Application fee", group: "price" },
  { key: "complexPerYear", label: "Complex applications / year", group: "volume" }, { key: "complexFee", label: "Complex application fee", group: "price" },
  { key: "retainers", label: "Funding retainers (active)", group: "volume" }, { key: "retainerMonthly", label: "Retainer / month", group: "price" },
  { key: "postAward", label: "Post-award programs (active)", group: "volume" }, { key: "postAwardMonthly", label: "Post-award / month", group: "price" },
  { key: "osClients", label: "OS clients", group: "volume" }, { key: "osAnnual", label: "OS / client / year", group: "price" },
  { key: "structuring", label: "Structuring assignments / year", group: "volume" }, { key: "structuringFee", label: "Structuring fee", group: "price" },
  { key: "directCostPct", label: "Direct delivery cost % (contractors, SMEs)", group: "cost" }, { key: "specialistSpend", label: "Specialist spend / year", group: "cost" },
  { key: "software", label: "Software & data / year", group: "cost" }, { key: "travel", label: "Travel / year", group: "cost" }, { key: "operations", label: "Operations / year", group: "cost" },
  { key: "coreFte", label: "Core delivery FTE", group: "people" }, { key: "loadedSalary", label: "Loaded cost / core FTE / year", group: "people" },
  { key: "hoursPerFte", label: "Billable hours / FTE / year", group: "people" }, { key: "hoursPerDiagnostic", label: "Hours / diagnostic", group: "people" },
  { key: "hoursPerApplication", label: "Hours / application", group: "people" }, { key: "hoursPerComplex", label: "Hours / complex application", group: "people" },
  { key: "hoursPerRetainerMonth", label: "Hours / retainer month", group: "people" }, { key: "hoursPerPostAwardMonth", label: "Hours / post-award month", group: "people" },
];

/** §50 Illustrative templates. Never Regenera's actual performance. */
export const SCENARIO_TEMPLATES: Record<"lean" | "base" | "scale", ScenarioInputs> = {
  lean: { diagnosticsPerMonth: 1, diagnosticFee: 7500, applicationsPerYear: 4, applicationFee: 30000, complexPerYear: 0, complexFee: 75000, retainers: 1, retainerMonthly: 5000, postAward: 1, postAwardMonthly: 8000, osClients: 1, osAnnual: 24000, structuring: 1, structuringFee: 30000, directCostPct: 35, specialistSpend: 15000, software: 12000, travel: 8000, operations: 12000, coreFte: 1, loadedSalary: 0, hoursPerFte: 1500, hoursPerDiagnostic: 25, hoursPerApplication: 110, hoursPerComplex: 260, hoursPerRetainerMonth: 20, hoursPerPostAwardMonth: 30 },
  base: { diagnosticsPerMonth: 2, diagnosticFee: 7500, applicationsPerYear: 10, applicationFee: 30000, complexPerYear: 2, complexFee: 75000, retainers: 3, retainerMonthly: 6000, postAward: 2, postAwardMonthly: 10000, osClients: 4, osAnnual: 24000, structuring: 3, structuringFee: 30000, directCostPct: 25, specialistSpend: 40000, software: 24000, travel: 20000, operations: 30000, coreFte: 3, loadedSalary: 110000, hoursPerFte: 1500, hoursPerDiagnostic: 25, hoursPerApplication: 110, hoursPerComplex: 260, hoursPerRetainerMonth: 20, hoursPerPostAwardMonth: 30 },
  scale: { diagnosticsPerMonth: 2.5, diagnosticFee: 7500, applicationsPerYear: 15, applicationFee: 30000, complexPerYear: 4, complexFee: 75000, retainers: 6, retainerMonthly: 6500, postAward: 4, postAwardMonthly: 12000, osClients: 8, osAnnual: 30000, structuring: 6, structuringFee: 35000, directCostPct: 20, specialistSpend: 90000, software: 40000, travel: 40000, operations: 60000, coreFte: 6, loadedSalary: 120000, hoursPerFte: 1500, hoursPerDiagnostic: 25, hoursPerApplication: 110, hoursPerComplex: 260, hoursPerRetainerMonth: 20, hoursPerPostAwardMonth: 30 },
};

export function runScenario(i: ScenarioInputs) {
  const v = (k: string) => (Number.isFinite(i[k]) ? i[k] : 0);
  const lines: { line: FundingLine; revenue: number; hours: number }[] = [
    { line: "diagnostic", revenue: v("diagnosticsPerMonth") * 12 * v("diagnosticFee"), hours: v("diagnosticsPerMonth") * 12 * v("hoursPerDiagnostic") },
    { line: "full_bid", revenue: v("applicationsPerYear") * v("applicationFee"), hours: v("applicationsPerYear") * v("hoursPerApplication") },
    { line: "complex_bid", revenue: v("complexPerYear") * v("complexFee"), hours: v("complexPerYear") * v("hoursPerComplex") },
    { line: "funding_retainer", revenue: v("retainers") * 12 * v("retainerMonthly"), hours: v("retainers") * 12 * v("hoursPerRetainerMonth") },
    { line: "post_award", revenue: v("postAward") * 12 * v("postAwardMonthly"), hours: v("postAward") * 12 * v("hoursPerPostAwardMonth") },
    { line: "os", revenue: v("osClients") * v("osAnnual"), hours: 0 },
    { line: "capital_structuring", revenue: v("structuring") * v("structuringFee"), hours: v("structuring") * v("hoursPerApplication") },
  ];
  const revenue = lines.reduce((a, l) => a + l.revenue, 0);
  const deliveryRevenue = revenue - lines.find(l => l.line === "os")!.revenue;
  const hours = lines.reduce((a, l) => a + l.hours, 0);
  const people = v("coreFte") * v("loadedSalary");
  const direct = deliveryRevenue * (v("directCostPct") / 100) + v("specialistSpend") + people;
  const overhead = v("software") + v("travel") + v("operations");
  const gp = revenue - direct;
  const capacityHours = v("coreFte") * v("hoursPerFte");
  const fteNeeded = v("hoursPerFte") > 0 ? hours / v("hoursPerFte") : null;
  const contribution = revenue > 0 ? gp / revenue : 0;
  return {
    lines: lines.map(l => ({ ...l, revenue: r2(l.revenue), hours: Math.round(l.hours) })),
    revenue: r2(revenue), directCost: r2(direct), grossProfit: r2(gp), grossMarginPct: revenue ? r1((gp / revenue) * 100) : null, overhead: r2(overhead), operatingProfit: r2(gp - overhead),
    hours: Math.round(hours), fteNeeded: fteNeeded === null ? null : r1(fteNeeded), utilizationPct: capacityHours > 0 ? r1((hours / capacityHours) * 100) : null,
    peopleCost: r2(people), revenuePerFte: v("coreFte") > 0 ? r2(revenue / v("coreFte")) : null, gpPerFte: v("coreFte") > 0 ? r2(gp / v("coreFte")) : null,
    breakEvenRevenue: contribution > 0 ? r2((overhead + people + v("specialistSpend")) / Math.max(0.01, 1 - v("directCostPct") / 100)) : null,
  };
}

// ---------- §28 funding inside a capital stack (no double counting) ----------
export type StackLayerLite = { id: string; layer: string; amount: number | null; source: string };
export type PathwayLite = { id: string; name: string; sourceType: string; amount: number | null; status: string; structureLayerId: string | null };

/** Pathways not yet in the stack; a pathway already linked to a layer is counted once, through the layer. */
export function pathwaysToAdd(layers: StackLayerLite[], pathways: PathwayLite[]) {
  const linked = new Set(pathways.map(p => p.structureLayerId).filter(Boolean));
  const inStack = new Set(layers.map(l => l.id));
  return pathways.filter(p => !(p.structureLayerId && inStack.has(p.structureLayerId)) && !["declined", "withdrawn", "ineligible"].includes(p.status) && !linked.has(p.id));
}

export const PATHWAY_TO_LAYER: Record<string, string> = {
  grant: "grant", foundation: "grant", tax_incentive: "grant", government: "grant", dfi: "dfi_capital", eca: "eca_finance", concessional: "blended_finance", blended: "blended_finance",
  climate_fund: "blended_finance", green_bank: "blended_finance", green_bond: "green_bond", sukuk: "sukuk", commercial_bank: "senior_debt", project_finance: "project_finance",
  private_credit: "mezzanine", infrastructure_fund: "common_equity", family_office: "common_equity", strategic: "common_equity",
};
/** Funding kind → pathway source type, when a call becomes a project pathway. */
export const pathwaySourceForKind = (k: FundingKind): string => ({ grant: "grant", philanthropic: "foundation", tax_credit: "tax_incentive", concessional: "concessional", development_finance: "dfi", blended: "blended", guarantee: "government", procurement: "government", tender: "government", rfp: "government" } as Record<string, string>)[k] ?? "other";
export const layerForKind = (k: FundingKind): string => ({ grant: "grant", philanthropic: "grant", tax_credit: "grant", concessional: "blended_finance", development_finance: "dfi_capital", blended: "blended_finance", guarantee: "guarantee" } as Record<string, string>)[k] ?? "grant";

/** Funding-originated relationship value (§47–48): every engagement for orgs whose first engagement came from funding. */
export function originatedValue(engs: { orgId: string | null; entryPoint: string | null; originOpportunityId: string | null; status: string; fee: number; monthlyFee: number; months: number; createdAt: string; fundingLine: string | null; revenueCategory: string | null }[]) {
  const byOrg = new Map<string, typeof engs>();
  for (const e of engs) if (e.orgId) byOrg.set(e.orgId, [...(byOrg.get(e.orgId) ?? []), e]);
  const live = (e: (typeof engs)[number]) => !["prospect", "lost", "qualified", "discovery"].includes(e.status);
  const out: { orgId: string; firstAt: string; total: number; year1: number; recurring: number; lines: Record<string, number>; engagements: number }[] = [];
  for (const [orgId, list] of byOrg) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = sorted[0];
    if (first.entryPoint !== "funding" && !first.originOpportunityId) continue;
    const won = sorted.filter(live);
    const cutoff = new Date(Date.parse(first.createdAt) + 365 * 86_400_000).toISOString();
    const value = (e: (typeof engs)[number]) => e.fee + e.monthlyFee * e.months;
    const lines: Record<string, number> = {};
    for (const e of won) { const k = e.fundingLine ?? e.revenueCategory ?? "other"; lines[k] = (lines[k] ?? 0) + value(e); }
    out.push({ orgId, firstAt: first.createdAt, total: r2(won.reduce((a, e) => a + value(e), 0)), year1: r2(won.filter(e => e.createdAt <= cutoff).reduce((a, e) => a + value(e), 0)), recurring: r2(won.reduce((a, e) => a + e.monthlyFee * 12 * (e.months > 0 ? 1 : 0), 0)), lines, engagements: won.length });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** §46 Funnel from counts; conversion is step-to-step, shown only where the earlier step is non-zero. */
export function funnel(steps: { key: string; label: string; n: number }[]) {
  return steps.map((s, i) => ({ ...s, conversionPct: i > 0 && steps[i - 1].n > 0 ? r1((s.n / steps[i - 1].n) * 100) : null }));
}

/** Keyword count survives only as a discovery signal (§5). */
export const discoveryLabel = (fit: number | null, readAt: string | null) => (fit == null ? "—" : readAt ? `Discovery signal (read): ${fit}` : `Discovery signal: ${fit} keyword hits`);

/** §22 Label grounding: text with [TO CONFIRM] or unsupported numbers becomes "missing". */
export function basisOf(s: { basis?: string; body: string }) {
  if (/\[TO CONFIRM\]/i.test(s.body)) return "missing";
  return s.basis && ["source_fact", "client_fact", "draft", "missing"].includes(s.basis) ? s.basis : "draft";
}
