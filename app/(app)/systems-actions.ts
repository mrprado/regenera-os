"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { capitalRequirements, interventions, organizations, projects, risks, systemAssessments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { INSTRUMENTS } from "@/lib/projects/vocab";
import { FRAMEWORKS, IMPLICATIONS, INTERVENTION_STATUSES, INTERVENTION_TYPES, SYSTEM_CATEGORIES } from "@/lib/systems/vocab";

type Scope = Parameters<typeof mandateCondition>[0];
const zId = z.string().uuid();
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 3000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k, 40).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const pick = <T extends Record<string, string>>(o: T, f: FormData, k: string) => { const v = str(f, k, 60); return (v in o ? v : null) as (keyof T & string) | null; };
const back = (id: string, text: string) => `/projects/${id}?tab=systems&notice=${encodeURIComponent(text)}`;

async function scopedProject(scope: Scope, id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}
async function scopedIntervention(scope: Scope, id: string) {
  const [x] = await appDb().select().from(interventions).where(and(eq(interventions.id, id), mandateCondition(scope, interventions.mandateId)));
  if (!x) throw new Error("Not found");
  return x;
}

/** One assessment per project and category; saving again updates it (and returns it to Draft). */
export async function saveAssessmentAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const category = z.enum(keys(SYSTEM_CATEGORIES)).parse(formData.get("category"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const implications: Record<string, string> = {};
    for (const k of Object.keys(IMPLICATIONS)) { const v = str(formData, `imp_${k}`, 1000); if (v) implications[k] = v; }
    const values = {
      baseline: str(formData, "baseline"), dependencies: str(formData, "dependencies"), impacts: str(formData, "impacts"), thresholds: str(formData, "thresholds"),
      risks: str(formData, "risks"), opportunities: str(formData, "opportunities"), futureState: str(formData, "futureState"), sources: str(formData, "sources", 2000),
      capacity: z.enum(["unknown", "ample", "adequate", "constrained", "exceeded"]).catch("unknown").parse(formData.get("capacity")),
      implications, frameworks: formData.getAll("frameworks").map(String).filter(f => f in FRAMEWORKS), status: "draft" as const, reviewer: null, reviewedAt: null, updatedAt: new Date().toISOString(),
    };
    const [existing] = await appDb().select({ id: systemAssessments.id }).from(systemAssessments).where(and(eq(systemAssessments.projectId, p.id), eq(systemAssessments.category, category)));
    if (existing) await appDb().update(systemAssessments).set(values).where(eq(systemAssessments.id, existing.id));
    else await appDb().insert(systemAssessments).values({ ...values, projectId: p.id, mandateId: p.mandateId, category });
  });
  redirect(back(projectId, `${SYSTEM_CATEGORIES[category]} assessment saved as Draft.`));
}

export async function reviewAssessmentAction(formData: FormData) {
  const id = zId.parse(formData.get("assessmentId"));
  let projectId = "";
  await withOsUser(async user => {
    const [a] = await appDb().select().from(systemAssessments).where(and(eq(systemAssessments.id, id), mandateCondition(user.scope, systemAssessments.mandateId)));
    if (!a) throw new Error("Not found");
    projectId = a.projectId;
    const reviewer = str(formData, "reviewer", 200) || user.email;
    if (!a.sources) throw new Error("Record the sources before marking the assessment reviewed");
    await appDb().update(systemAssessments).set({ status: "reviewed", reviewer, reviewedAt: new Date().toISOString() }).where(eq(systemAssessments.id, a.id));
    await audit(appDb(), { actor: user.email, action: "system_assessment_reviewed", entity: "system_assessments", entityId: a.id, after: { reviewer } });
  });
  redirect(back(projectId, "Marked reviewed."));
}

export async function addInterventionAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const systemIssue = z.string().trim().min(3).max(500).parse(formData.get("systemIssue"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const partner = str(formData, "partnerOrgId", 60);
    if (partner) {
      const [o] = await appDb().select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, partner), mandateCondition(user.scope, organizations.mandateId)));
      if (!o) throw new Error("Partner not found");
    }
    const riskId = str(formData, "riskId", 60);
    if (riskId) {
      const [r] = await appDb().select({ id: risks.id }).from(risks).where(and(eq(risks.id, riskId), eq(risks.projectId, p.id)));
      if (!r) throw new Error("Risk not found");
    }
    await appDb().insert(interventions).values({
      projectId: p.id, mandateId: p.mandateId, assessmentId: str(formData, "assessmentId", 60) || null, systemIssue, description: str(formData, "description"),
      implementationType: pick(INTERVENTION_TYPES, formData, "implementationType") ?? "other", costEstimate: num(formData, "costEstimate"), currency: str(formData, "currency", 8) || p.currency || "USD",
      costBasis: str(formData, "costBasis", 500), expectedOutcome: str(formData, "expectedOutcome"), financialRelevance: str(formData, "financialRelevance"), riskReduction: str(formData, "riskReduction"),
      riskId: riskId || null, fundingPathway: str(formData, "fundingPathway", 1000), partnerOrgId: partner || null, evidence: str(formData, "evidence", 1000),
    });
  });
  redirect(back(projectId, "Intervention added."));
}

export async function interventionStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("interventionId"));
  let projectId = "";
  await withOsUser(async user => {
    const x = await scopedIntervention(user.scope, id);
    projectId = x.projectId;
    await appDb().update(interventions).set({ status: pick(INTERVENTION_STATUSES, formData, "status") ?? x.status, updatedAt: new Date().toISOString() }).where(eq(interventions.id, x.id));
  });
  redirect(back(projectId, "Intervention updated."));
}

/** Connects an intervention to capital: creates a capital requirement for its cost and links it. */
export async function interventionCapitalAction(formData: FormData) {
  const id = zId.parse(formData.get("interventionId"));
  const instrument = z.enum(keys(INSTRUMENTS)).catch("blended").parse(formData.get("instrument"));
  let projectId = "";
  await withOsUser(async user => {
    const x = await scopedIntervention(user.scope, id);
    projectId = x.projectId;
    if (x.capitalRequirementId) throw new Error("Already linked to a capital requirement");
    const [req] = await appDb().insert(capitalRequirements).values({ projectId: x.projectId, mandateId: x.mandateId, purpose: `Intervention: ${x.systemIssue}`.slice(0, 200), instrument, target: x.costEstimate, currency: x.currency, useOfFunds: x.description, status: "planned" }).returning();
    await appDb().update(interventions).set({ capitalRequirementId: req.id, updatedAt: new Date().toISOString() }).where(eq(interventions.id, x.id));
    await audit(appDb(), { actor: user.email, action: "intervention_capital", entity: "interventions", entityId: x.id, after: { capitalRequirementId: req.id } });
  });
  redirect(back(projectId, "Capital requirement created and linked; see the Capital tab."));
}
