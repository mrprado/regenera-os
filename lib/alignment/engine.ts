// Capital alignment and nature transition engine. The OS records, compares and totals; people classify, and every
// classification needs a stated basis (incentives need the full evidence chain). No composite ESG score exists here.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { capitalFlows, finModels, incentives, natureAssessments, natureScenarios, projects } from "@/db/schema";
import type { NatureItem, PathwayItem } from "@/db/alignment";
import { audit as writeAudit } from "@/lib/audit";
import type { Db } from "@/db";
import type { Alignment } from "./vocab";

type Assessment = typeof natureAssessments.$inferSelect;
type Scenario = typeof natureScenarios.$inferSelect;
type Incentive = typeof incentives.$inferSelect;

export async function createAssessment(db: Db, input: { mandateId: string; name: string; subjectType: Assessment["subjectType"]; projectId?: string | null; orgId?: string | null; capitalAmount?: number | null; currency?: string }, actor: string) {
  let capital = input.capitalAmount ?? null, currency = input.currency ?? "USD";
  if (input.projectId && capital === null) {
    const [p] = await db.select({ capex: projects.capex, currency: projects.currency }).from(projects).where(eq(projects.id, input.projectId));
    capital = p?.capex ?? null; currency = p?.currency ?? currency;
  }
  const [a] = await db.insert(natureAssessments).values({ mandateId: input.mandateId, name: input.name, subjectType: input.subjectType, projectId: input.projectId ?? null, orgId: input.orgId ?? null, capitalAmount: capital, currency, createdBy: actor }).returning();
  await writeAudit(db, { actor, action: "nature_assessment.create", entity: "nature_assessment", entityId: a.id, after: { name: a.name, subjectType: a.subjectType } });
  return a;
}

const LISTS = { dependencies: true, impacts: true, drivers: true } as const;
export async function addItem(db: Db, assessmentId: string, list: keyof typeof LISTS, item: Omit<NatureItem, "id">, actor: string) {
  if (!item.evidence.trim()) throw new Error("Evidence is required: cite the source, data or observation behind this item");
  const [a] = await db.select().from(natureAssessments).where(eq(natureAssessments.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  const next = [...a[list], { ...item, id: crypto.randomUUID() }];
  await db.update(natureAssessments).set({ [list]: next, updatedAt: new Date().toISOString() }).where(eq(natureAssessments.id, assessmentId));
  await writeAudit(db, { actor, action: `nature_assessment.${list}.add`, entity: "nature_assessment", entityId: assessmentId, after: item });
}

export async function addPathway(db: Db, assessmentId: string, item: Omit<PathwayItem, "id">, actor: string) {
  if (!item.evidence.trim()) throw new Error("Evidence or rationale is required for a transition pathway");
  const [a] = await db.select().from(natureAssessments).where(eq(natureAssessments.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  await db.update(natureAssessments).set({ pathways: [...a.pathways, { ...item, id: crypto.randomUUID() }], updatedAt: new Date().toISOString() }).where(eq(natureAssessments.id, assessmentId));
  await writeAudit(db, { actor, action: "nature_assessment.pathway.add", entity: "nature_assessment", entityId: assessmentId, after: item });
}

export async function removeItem(db: Db, assessmentId: string, list: keyof typeof LISTS | "pathways", itemId: string, actor: string) {
  const [a] = await db.select().from(natureAssessments).where(eq(natureAssessments.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  await db.update(natureAssessments).set({ [list]: (a[list] as { id: string }[]).filter(x => x.id !== itemId), updatedAt: new Date().toISOString() }).where(eq(natureAssessments.id, assessmentId));
  await writeAudit(db, { actor, action: `nature_assessment.${list}.remove`, entity: "nature_assessment", entityId: assessmentId, before: { itemId } });
}

/** A person classifies; a basis is required for anything other than Unclassified. */
export async function classifyAssessment(db: Db, assessmentId: string, alignment: Alignment, basis: string, actor: string) {
  if (alignment !== "unclassified" && basis.trim().length < 20) throw new Error("State the basis for this classification (evidence, mechanism and scope; at least a sentence)");
  const [a] = await db.select().from(natureAssessments).where(eq(natureAssessments.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  if (alignment === "nature_positive" && a.impacts.some(i => i.materiality === "high") && !/offset|mitigat|net|restor|avoid/i.test(basis)) {
    throw new Error("High-materiality impacts are recorded: explain how they are avoided, mitigated or restored before classifying as nature-positive");
  }
  await db.update(natureAssessments).set({ alignment, alignmentBasis: basis.trim(), classifiedBy: actor, classifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(natureAssessments.id, assessmentId));
  await writeAudit(db, { actor, action: "nature_assessment.classify", entity: "nature_assessment", entityId: assessmentId, before: { alignment: a.alignment }, after: { alignment, basis } });
}

export const INCENTIVE_EVIDENCE = ["policyRef", "mechanism", "beneficiary", "economicEffect", "environmentalEvidence"] as const;
/** Missing evidence fields that block a classification other than Unclassified. */
export function incentiveEvidenceGaps(i: Pick<Incentive, (typeof INCENTIVE_EVIDENCE)[number]>) {
  return INCENTIVE_EVIDENCE.filter(k => !String(i[k] ?? "").trim());
}

export async function saveIncentive(db: Db, input: Omit<typeof incentives.$inferInsert, "id" | "createdAt" | "updatedAt" | "classifiedBy" | "createdBy">, actor: string) {
  const gaps = incentiveEvidenceGaps(input as Incentive);
  if (input.classification && input.classification !== "unclassified" && gaps.length) throw new Error(`Classification needs evidence: ${gaps.join(", ")}`);
  const [row] = await db.insert(incentives).values({ ...input, classifiedBy: input.classification && input.classification !== "unclassified" ? actor : null, createdBy: actor }).returning();
  await writeAudit(db, { actor, action: "incentive.create", entity: "incentive", entityId: row.id, after: { name: row.name, classification: row.classification } });
  return row;
}

export async function saveFlow(db: Db, input: Omit<typeof capitalFlows.$inferInsert, "id" | "createdAt" | "updatedAt" | "createdBy">, actor: string) {
  if (!(input.amount > 0)) throw new Error("Amount must be positive");
  if (!String(input.source ?? "").trim()) throw new Error("Cite a source for the flow (budget, disclosure, study, estimate method)");
  if (input.alignment && input.alignment !== "unclassified" && !String(input.alignmentBasis ?? "").trim()) throw new Error("State the basis for the alignment classification");
  const [row] = await db.insert(capitalFlows).values({ ...input, createdBy: actor }).returning();
  await writeAudit(db, { actor, action: "capital_flow.create", entity: "capital_flow", entityId: row.id, after: { system: row.system, sector: row.sector, amount: row.amount } });
  return row;
}

export type ScenarioView = Scenario & { capexUsed: number | null; irrUsed: number | null; fromModel: boolean; natureCostMonetised: number | null; deltas: { capexPct: number | null; irrPp: number | null; habitatPct: number | null } };

/** Nature-adjusted scenario comparison: financial cash flow and nature metrics side by side, never blended into one score. */
export async function scenarioComparison(db: Db, assessmentId: string): Promise<ScenarioView[]> {
  const rows = await db.select().from(natureScenarios).where(eq(natureScenarios.assessmentId, assessmentId));
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const modelIds = rows.map(r => r.finModelId).filter((x): x is string => !!x);
  const models = modelIds.length ? await db.select({ id: finModels.id, summary: finModels.summary }).from(finModels).where(inArray(finModels.id, modelIds)) : [];
  const byId = new Map(models.map(m => [m.id, m.summary]));
  const views = rows.map(r => {
    const s = r.finModelId ? byId.get(r.finModelId) : undefined;
    const capexUsed = typeof s?.capex === "number" ? s.capex : r.capex;
    const irrUsed = typeof s?.projectIrr === "number" ? s.projectIrr : r.irrPct;
    const monetised = r.methodology.trim() ? [r.mitigationCost, r.restorationCost, r.transitionCost, r.environmentalLiability].reduce<number>((a, x) => a + (x ?? 0), 0) - (r.naturalCapitalRevenue ?? 0) - (r.avoidedRisk ?? 0) : null;
    return { ...r, capexUsed, irrUsed, fromModel: !!s, natureCostMonetised: monetised, deltas: { capexPct: null as number | null, irrPp: null as number | null, habitatPct: null as number | null } };
  });
  const base = views[0];
  if (base) for (const v of views.slice(1)) {
    v.deltas = {
      capexPct: base.capexUsed && v.capexUsed !== null ? Math.round(((v.capexUsed - base.capexUsed) / base.capexUsed) * 1000) / 10 : null,
      irrPp: base.irrUsed !== null && v.irrUsed !== null ? Math.round((v.irrUsed - base.irrUsed) * 10) / 10 : null,
      habitatPct: base.habitatLossHa && v.habitatLossHa !== null ? Math.round(((v.habitatLossHa - base.habitatLossHa) / base.habitatLossHa) * 1000) / 10 : null,
    };
  }
  return views;
}

/** Plain-language trade-off lines generated only from recorded numbers. */
export function tradeoffLines(views: ScenarioView[]) {
  const base = views[0]; if (!base) return [];
  return views.slice(1).flatMap(v => {
    const parts: string[] = [];
    if (v.deltas.habitatPct !== null) parts.push(`${v.deltas.habitatPct < 0 ? "reduces" : "increases"} habitat loss by ${Math.abs(v.deltas.habitatPct)}%`);
    if (v.deltas.capexPct !== null) parts.push(`${v.deltas.capexPct >= 0 ? "increases" : "reduces"} CAPEX by ${Math.abs(v.deltas.capexPct)}%`);
    if (v.deltas.irrPp !== null) parts.push(`moves IRR by ${v.deltas.irrPp > 0 ? "+" : ""}${v.deltas.irrPp} pp`);
    if (v.restorationHa) parts.push(`adds ${v.restorationHa} ha of restoration`);
    return parts.length ? [`${v.name} vs ${base.name}: ${parts.join(", ")}${v.finance ? `; ${v.finance}` : ""}.`] : [];
  });
}

export type AlignmentTotals = { byAlignment: Record<Alignment, number>; materialRisk: number; total: number; currency: string; mixedCurrency: boolean; rows: { projectId: string | null; assessmentId: string | null; name: string; alignment: Alignment; amount: number; currency: string; material: boolean }[] };

/** COMMAND metric: capital by alignment. Projects without an assessment count as Unclassified at their CAPEX. */
export async function capitalAlignment(db: Db, mandateIds: string[]): Promise<AlignmentTotals> {
  const empty = { nature_positive: 0, transition: 0, neutral: 0, potentially_negative: 0, unclassified: 0 };
  if (!mandateIds.length) return { byAlignment: empty, materialRisk: 0, total: 0, currency: "USD", mixedCurrency: false, rows: [] };
  const [as, ps] = await Promise.all([
    db.select().from(natureAssessments).where(inArray(natureAssessments.mandateId, mandateIds)),
    db.select({ id: projects.id, name: projects.name, capex: projects.capex, currency: projects.currency }).from(projects).where(and(inArray(projects.mandateId, mandateIds), isNull(projects.archivedAt))),
  ]);
  const scen = as.length ? await db.select({ assessmentId: natureScenarios.assessmentId, natureRisk: natureScenarios.natureRisk }).from(natureScenarios).where(inArray(natureScenarios.assessmentId, as.map(a => a.id))) : [];
  const rows: AlignmentTotals["rows"] = [];
  const assessed = new Set<string>();
  // Latest assessment per project wins; non-project assessments count on their own.
  const latest = new Map<string, Assessment>();
  for (const a of as) {
    if (!a.projectId) continue;
    const cur = latest.get(a.projectId);
    if (!cur || a.updatedAt > cur.updatedAt) latest.set(a.projectId, a);
  }
  for (const a of as) {
    if (a.projectId && latest.get(a.projectId)?.id !== a.id) continue;
    if (a.projectId) assessed.add(a.projectId);
    const material = a.impacts.some(i => i.materiality === "high") || a.dependencies.some(d => d.materiality === "high") || scen.some(s => s.assessmentId === a.id && s.natureRisk === "high");
    rows.push({ projectId: a.projectId, assessmentId: a.id, name: a.name, alignment: a.alignment, amount: a.capitalAmount ?? 0, currency: a.currency, material });
  }
  for (const p of ps) if (!assessed.has(p.id) && p.capex) rows.push({ projectId: p.id, assessmentId: null, name: p.name, alignment: "unclassified", amount: p.capex, currency: p.currency ?? "USD", material: false });
  const currencies = new Set(rows.filter(r => r.amount).map(r => r.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : "USD";
  const byAlignment = { ...empty };
  let materialRisk = 0;
  for (const r of rows) if (r.currency === currency) { byAlignment[r.alignment] += r.amount; if (r.material) materialRisk += r.amount; }
  return { byAlignment, materialRisk, total: Object.values(byAlignment).reduce((a, b) => a + b, 0), currency, mixedCurrency: currencies.size > 1, rows: rows.sort((a, b) => b.amount - a.amount) };
}

/** Financial flows into a system, by sector and alignment, with the realistically redirectable share. */
export function flowSummary(rows: (typeof capitalFlows.$inferSelect)[]) {
  const bySector = new Map<string, number>(), byAlignment = new Map<string, number>();
  let redirectable = 0, partly = 0, total = 0;
  for (const f of rows) {
    bySector.set(f.sector, (bySector.get(f.sector) ?? 0) + f.amount);
    byAlignment.set(f.alignment, (byAlignment.get(f.alignment) ?? 0) + f.amount);
    total += f.amount;
    if (f.redirectable === "yes") redirectable += f.amount; else if (f.redirectable === "partial") partly += f.amount;
  }
  return { total, bySector: [...bySector].sort((a, b) => b[1] - a[1]), byAlignment, redirectable, partly, currencies: [...new Set(rows.map(r => r.currency))] };
}
