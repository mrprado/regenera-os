"use server";

// Capital alignment and nature transition: assessments, evidence items, classification, scenarios, incentives, flows,
// and the free ESA WorldCover site baseline.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { finModels, natureAssessments, natureScenarios, projects } from "@/db/schema";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { addItem, addPathway, classifyAssessment, createAssessment, removeItem, saveFlow, saveIncentive } from "@/lib/alignment/engine";
import { ALIGNMENT, DEPENDENCIES, DRIVERS, FLOW_SECTORS, INCENTIVE_CLASS, INCENTIVE_SECTORS, MATERIALITY, MECHANISMS, NATURE_RISK, PATHWAYS, PRESSURES, REDIRECTABLE, SUBJECT_TYPES } from "@/lib/alignment/vocab";
import { landCoverComposition, type SiteGeometry } from "@/lib/geo/landcover";
import { audit } from "@/lib/audit";

const zId = z.string().uuid();
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 400) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const detail = (id: string) => `/capital/alignment/${id}`;

async function scoped(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [a] = await appDb().select().from(natureAssessments).where(and(eq(natureAssessments.id, id), mandateCondition(scope, natureAssessments.mandateId)));
  if (!a) throw new Error("Assessment not found");
  return a;
}

export async function createAssessmentAction(formData: FormData) {
  let id = "";
  await withOsUser(async user => {
    const projectId = zId.safeParse(formData.get("projectId")).data ?? null;
    let mandateId = user.scope.mandateIds[0];
    let name = str(formData, "name", 160);
    if (projectId) {
      const [p] = await appDb().select({ mandateId: projects.mandateId, name: projects.name }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
      if (!p) throw new Error("Project not found");
      mandateId = p.mandateId; name ||= `${p.name} nature transition`;
    }
    if (!name) throw new Error("Name the assessment");
    id = (await createAssessment(appDb(), { mandateId, name, subjectType: z.enum(keys(SUBJECT_TYPES)).catch("project").parse(formData.get("subjectType")), projectId, capitalAmount: num(formData, "capitalAmount"), currency: str(formData, "currency", 3).toUpperCase() || undefined }, user.email)).id;
  });
  redirect(note(detail(id), "Assessment created. Record dependencies, impacts, drivers and pathways with their evidence; classify only when the evidence supports it."));
}

export async function addNatureItemAction(formData: FormData) {
  const id = zId.parse(formData.get("assessmentId"));
  const list = z.enum(["dependencies", "impacts", "drivers", "pathways"]).parse(formData.get("list"));
  let msg = "Added.";
  await withOsUser(async user => {
    await scoped(user.scope, id);
    try {
      if (list === "pathways") {
        await addPathway(appDb(), id, { kind: z.enum(keys(PATHWAYS)).parse(formData.get("kind")), description: str(formData, "description", 600), capexDeltaPct: num(formData, "capexDeltaPct"), impactDeltaPct: num(formData, "impactDeltaPct"), evidence: str(formData, "evidence", 600) }, user.email);
      } else {
        const kinds = list === "dependencies" ? DEPENDENCIES : list === "impacts" ? PRESSURES : DRIVERS;
        await addItem(appDb(), id, list, { kind: z.enum(keys(kinds)).parse(formData.get("kind")), materiality: z.enum(keys(MATERIALITY)).catch("unknown").parse(formData.get("materiality")), description: str(formData, "description", 600), metric: str(formData, "metric", 80) || undefined, value: num(formData, "value"), unit: str(formData, "unit", 20) || undefined, evidence: str(formData, "evidence", 600), source: str(formData, "source", 300) || undefined }, user.email);
      }
    } catch (e) { msg = `Not added: ${(e as Error).message}`; }
  });
  redirect(note(detail(id), msg));
}

export async function removeNatureItemAction(formData: FormData) {
  const id = zId.parse(formData.get("assessmentId"));
  await withOsUser(async user => {
    await scoped(user.scope, id);
    await removeItem(appDb(), id, z.enum(["dependencies", "impacts", "drivers", "pathways"]).parse(formData.get("list")), zId.parse(formData.get("itemId")), user.email);
  });
  redirect(note(detail(id), "Removed."));
}

export async function classifyAssessmentAction(formData: FormData) {
  const id = zId.parse(formData.get("assessmentId"));
  let msg = "Classification recorded with its basis.";
  await withOsUser(async user => {
    await scoped(user.scope, id);
    try { await classifyAssessment(appDb(), id, z.enum(keys(ALIGNMENT)).parse(formData.get("alignment")), str(formData, "basis", 2000), user.email); } catch (e) { msg = `Not classified: ${(e as Error).message}`; }
  });
  redirect(note(detail(id), msg));
}

export async function saveScenarioAction(formData: FormData) {
  const id = zId.parse(formData.get("assessmentId"));
  await withOsUser(async user => {
    const a = await scoped(user.scope, id);
    let finModelId = zId.safeParse(formData.get("finModelId")).data ?? null;
    if (finModelId) {
      const [m] = await appDb().select({ id: finModels.id }).from(finModels).where(and(eq(finModels.id, finModelId), mandateCondition(user.scope, finModels.mandateId)));
      finModelId = m?.id ?? null;
    }
    const [row] = await appDb().insert(natureScenarios).values({
      mandateId: a.mandateId, assessmentId: id, name: str(formData, "name", 120) || "Scenario", configuration: str(formData, "configuration", 600), finModelId,
      capex: num(formData, "capex"), irrPct: num(formData, "irrPct"), habitatLossHa: num(formData, "habitatLossHa"), restorationHa: num(formData, "restorationHa"), waterDemandM3: num(formData, "waterDemandM3"),
      natureRisk: z.enum(keys(NATURE_RISK)).catch("unknown").parse(formData.get("natureRisk")),
      mitigationCost: num(formData, "mitigationCost"), restorationCost: num(formData, "restorationCost"), transitionCost: num(formData, "transitionCost"), environmentalLiability: num(formData, "environmentalLiability"),
      naturalCapitalRevenue: num(formData, "naturalCapitalRevenue"), avoidedRisk: num(formData, "avoidedRisk"), methodology: str(formData, "methodology", 1000), finance: str(formData, "finance", 300), notes: str(formData, "notes", 1000),
    }).returning();
    await audit(appDb(), { actor: user.email, action: "nature_scenario.create", entity: "nature_scenario", entityId: row.id, after: { name: row.name } });
  });
  redirect(note(detail(id), "Scenario added."));
}

export async function deleteScenarioAction(formData: FormData) {
  const id = zId.parse(formData.get("assessmentId"));
  await withOsUser(async user => {
    await scoped(user.scope, id);
    const sid = zId.parse(formData.get("scenarioId"));
    await appDb().delete(natureScenarios).where(and(eq(natureScenarios.id, sid), eq(natureScenarios.assessmentId, id)));
    await audit(appDb(), { actor: user.email, action: "nature_scenario.delete", entity: "nature_scenario", entityId: sid });
  });
  redirect(note(detail(id), "Scenario removed."));
}

/** Site baseline from ESA WorldCover (free, CC BY 4.0) for the linked project's boundary. */
export async function siteBaselineAction(formData: FormData) {
  const id = zId.parse(formData.get("assessmentId"));
  let msg = "";
  await withOsUser(async user => {
    const a = await scoped(user.scope, id);
    if (!a.projectId) { msg = "Link the assessment to a project with a boundary first."; return; }
    const [p] = await appDb().select({ geometry: projects.geometry }).from(projects).where(eq(projects.id, a.projectId));
    let g: SiteGeometry | null = null;
    try { const j = p?.geometry ? JSON.parse(p.geometry) : null; const geom = j?.type === "Feature" ? j.geometry : j; if (geom?.type === "Polygon" || geom?.type === "MultiPolygon") g = geom; } catch { /* invalid */ }
    if (!g) { msg = "The project has no boundary polygon. Draw one in Atlas → Workbench and save it to the project."; return; }
    try {
      const c = await landCoverComposition(g);
      await appDb().update(natureAssessments).set({ siteBaseline: { ...c, at: new Date().toISOString() }, updatedAt: new Date().toISOString() }).where(eq(natureAssessments.id, id));
      await audit(appDb(), { actor: user.email, action: "nature_assessment.baseline", entity: "nature_assessment", entityId: id, after: { siteHa: c.siteHa, naturalHa: c.naturalHa } });
      msg = `Baseline recorded: ${c.naturalHa} ha natural cover of ${c.siteHa} ha (SCREENING).`;
    } catch (e) { msg = `Baseline failed: ${(e as Error).message}`; }
  });
  redirect(note(detail(id), msg));
}

export async function saveIncentiveAction(formData: FormData) {
  let msg = "Incentive recorded.";
  await withOsUser(async user => {
    try {
      await saveIncentive(appDb(), {
        mandateId: user.scope.mandateIds[0], country: str(formData, "country", 60).toUpperCase(), subdivision: str(formData, "subdivision", 80) || null, name: str(formData, "name", 200),
        sector: z.enum(keys(INCENTIVE_SECTORS)).parse(formData.get("sector")), mechanism: z.enum(keys(MECHANISMS)).parse(formData.get("mechanism")), policyRef: str(formData, "policyRef", 400),
        beneficiary: str(formData, "beneficiary", 300), economicEffect: str(formData, "economicEffect", 800), environmentalEvidence: str(formData, "environmentalEvidence", 800),
        annualValue: num(formData, "annualValue"), currency: str(formData, "currency", 3).toUpperCase() || "USD", classification: z.enum(keys(INCENTIVE_CLASS)).catch("unclassified").parse(formData.get("classification")),
        sourceUrl: str(formData, "sourceUrl", 400) || null, asOf: str(formData, "asOf", 10) || null,
      }, user.email);
    } catch (e) { msg = `Not recorded: ${(e as Error).message}`; }
  });
  redirect(note("/capital/alignment?tab=incentives", msg));
}

export async function saveFlowAction(formData: FormData) {
  const system = str(formData, "system", 120);
  let msg = "Flow recorded.";
  await withOsUser(async user => {
    try {
      await saveFlow(appDb(), {
        mandateId: user.scope.mandateIds[0], system, sector: z.enum(keys(FLOW_SECTORS)).parse(formData.get("sector")), description: str(formData, "description", 400), amount: num(formData, "amount") ?? 0,
        currency: str(formData, "currency", 3).toUpperCase() || "USD", year: str(formData, "year", 9) || null, alignment: z.enum(keys(ALIGNMENT)).catch("unclassified").parse(formData.get("alignment")),
        alignmentBasis: str(formData, "alignmentBasis", 800), redirectable: z.enum(keys(REDIRECTABLE)).catch("unknown").parse(formData.get("redirectable")), source: str(formData, "source", 400),
      }, user.email);
    } catch (e) { msg = `Not recorded: ${(e as Error).message}`; }
  });
  redirect(note(`/capital/alignment?tab=flows&system=${encodeURIComponent(system)}`, msg));
}
