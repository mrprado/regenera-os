"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  decisions, designPackages, economicCases, engineeringRequirements, esIssues, insurancePolicies, projectMilestones, projects, revenueStreams, studies,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { addMilestone, setDependencies, setMilestoneStatus } from "@/lib/delivery/engine";
import {
  DECISION_STATUSES, DESIGN_STAGES, DESIGN_STATUSES, DISCIPLINES, ENG_REQ_STATUSES, ES_FRAMEWORKS, ES_STATUSES, ES_TOPICS, INSURANCE_PHASES,
  INSURANCE_STATUSES, INSURANCE_TYPES, MILESTONE_CATEGORIES, MILESTONE_STATUSES, MITIGATION_STEPS, STUDY_STATUSES, STUDY_TYPES,
} from "@/lib/delivery/vocab";
import { deriveScenarios, saveCase, updateCaseInputs } from "@/lib/economics/engine";
import { CASE_KINDS, DEFAULT_INPUTS, INPUT_FIELDS, REVENUE_MECHANISMS, REVENUE_STATUSES, type CaseInputs } from "@/lib/economics/vocab";
import { SEVERITIES } from "@/lib/projects/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const opt = (f: FormData, k: string, max = 300) => str(f, k, max) || null;
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const pick = <T extends Record<string, string>>(o: T, f: FormData, k: string) => { const v = str(f, k); return (v in o ? v : null) as (keyof T & string) | null; };
const today = () => new Date().toISOString().slice(0, 10);
const tabUrl = (id: string, tab: string) => `/projects/${id}?tab=${tab}`;

async function scopedProject(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}

/** Loads a project-owned row inside the user's entities, or throws. */
async function scopedRow<T extends typeof projectMilestones | typeof decisions | typeof studies | typeof designPackages | typeof engineeringRequirements | typeof esIssues | typeof insurancePolicies | typeof revenueStreams | typeof economicCases>(
  scope: Parameters<typeof mandateCondition>[0], table: T, rowId: string,
) {
  const [x] = await appDb().select().from(table as typeof projectMilestones).where(and(eq((table as typeof projectMilestones).id, rowId), mandateCondition(scope, (table as typeof projectMilestones).mandateId)));
  if (!x) throw new Error("Not found");
  return x as unknown as T["$inferSelect"];
}

// Plan: milestones and decisions

export async function addMilestoneAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  await withOsUser(async user => {
    await scopedProject(user.scope, id);
    await addMilestone(appDb(), {
      projectId: id, name, category: pick(MILESTONE_CATEGORIES, formData, "category") ?? "other", durationDays: Math.max(0, Math.round(num(formData, "durationDays") ?? 0)),
      dueDate: date(formData, "dueDate"), dependsOn: formData.getAll("dependsOn").map(String).filter(v => zId.safeParse(v).success), owner: opt(formData, "owner", 120),
      evidence: str(formData, "evidence", 500), isTarget: formData.get("isTarget") === "on",
    }, user.email);
  });
  redirect(note(tabUrl(id, "plan"), "Milestone added."));
}

export async function updateMilestoneAction(formData: FormData) {
  const milestoneId = zId.parse(formData.get("milestoneId"));
  let projectId = "", msg = "Milestone updated.";
  await withOsUser(async user => {
    const m = await scopedRow(user.scope, projectMilestones, milestoneId);
    projectId = m.projectId;
    const status = pick(MILESTONE_STATUSES, formData, "status");
    if (status && status !== m.status) await setMilestoneStatus(appDb(), m.id, status, user.email);
    await appDb().update(projectMilestones).set({
      dueDate: formData.has("dueDate") ? date(formData, "dueDate") : m.dueDate,
      durationDays: formData.has("durationDays") ? Math.max(0, Math.round(num(formData, "durationDays") ?? 0)) : m.durationDays,
      updatedAt: new Date().toISOString(),
    }).where(eq(projectMilestones.id, m.id));
    if (formData.has("depsSubmitted")) {
      const ok = await setDependencies(appDb(), m.id, formData.getAll("dependsOn").map(String), today());
      if (!ok) msg = "Not saved: those dependencies would create a loop.";
    }
  });
  redirect(note(tabUrl(projectId, "plan"), msg));
}

export async function addDecisionAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const title = z.string().trim().min(3).max(300).parse(formData.get("title"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(decisions).values({ projectId: id, mandateId: p.mandateId, title, context: str(formData, "context", 3000), options: str(formData, "options", 3000), dueDate: date(formData, "dueDate") });
  });
  redirect(note(tabUrl(id, "plan"), "Decision added to the log."));
}

export async function recordDecisionAction(formData: FormData) {
  const decisionId = zId.parse(formData.get("decisionId"));
  let projectId = "";
  await withOsUser(async user => {
    const d = await scopedRow(user.scope, decisions, decisionId);
    projectId = d.projectId;
    const status = pick(DECISION_STATUSES, formData, "status") ?? d.status;
    const decision = str(formData, "decision", 3000) || d.decision;
    await appDb().update(decisions).set({
      status, decision, rationale: str(formData, "rationale", 3000) || d.rationale, evidence: str(formData, "evidence", 1000) || d.evidence,
      decidedBy: status === "decided" ? (opt(formData, "decidedBy", 120) ?? d.decidedBy ?? user.email) : d.decidedBy,
      decidedAt: status === "decided" && d.status !== "decided" ? today() : d.decidedAt, updatedAt: new Date().toISOString(),
    }).where(eq(decisions.id, d.id));
    await audit(appDb(), { actor: user.email, action: "decision_recorded", entity: "decisions", entityId: d.id, before: { status: d.status, decision: d.decision }, after: { status, decision } });
  });
  redirect(note(tabUrl(projectId, "plan"), "Decision updated."));
}

// Engineering: studies, design packages, code requirements

export async function addStudyAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const type = z.enum(keys(STUDY_TYPES)).parse(formData.get("type"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(studies).values({
      projectId: id, mandateId: p.mandateId, type, title: str(formData, "title", 200), status: pick(STUDY_STATUSES, formData, "status") ?? "not_started",
      provider: opt(formData, "provider", 200), cost: num(formData, "cost"), currency: opt(formData, "currency", 8) ?? p.currency ?? "USD", dueDate: date(formData, "dueDate"),
    });
  });
  redirect(note(tabUrl(id, "engineering"), "Study added."));
}

export async function updateStudyAction(formData: FormData) {
  const studyId = zId.parse(formData.get("studyId"));
  let projectId = "";
  await withOsUser(async user => {
    const s = await scopedRow(user.scope, studies, studyId);
    projectId = s.projectId;
    const status = pick(STUDY_STATUSES, formData, "status") ?? s.status;
    const reviewer = opt(formData, "reviewer", 120) ?? s.reviewer;
    await appDb().update(studies).set({
      status, findings: str(formData, "findings", 4000) || s.findings, reviewer,
      reviewedAt: status === "accepted" && s.status !== "accepted" ? today() : s.reviewedAt,
      completedAt: (status === "final" || status === "accepted") && !s.completedAt ? today() : s.completedAt, updatedAt: new Date().toISOString(),
    }).where(eq(studies.id, s.id));
    if (status === "accepted" && !reviewer) throw new Error("Accepting a study needs the reviewer's name");
    await audit(appDb(), { actor: user.email, action: "study_updated", entity: "studies", entityId: s.id, before: { status: s.status }, after: { status, reviewer } });
  });
  redirect(note(tabUrl(projectId, "engineering"), "Study updated."));
}

export async function addDesignPackageAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const stage = z.enum(keys(DESIGN_STAGES)).parse(formData.get("stage"));
  const discipline = z.enum(keys(DISCIPLINES)).parse(formData.get("discipline"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(designPackages).values({ projectId: id, mandateId: p.mandateId, stage, discipline, status: pick(DESIGN_STATUSES, formData, "status") ?? "planned", engineer: opt(formData, "engineer", 200), issuedAt: date(formData, "issuedAt"), notes: str(formData, "notes", 2000) });
  });
  redirect(note(tabUrl(id, "engineering"), "Design package added."));
}

export async function updateDesignPackageAction(formData: FormData) {
  const packageId = zId.parse(formData.get("packageId"));
  let projectId = "";
  await withOsUser(async user => {
    const d = await scopedRow(user.scope, designPackages, packageId);
    projectId = d.projectId;
    const status = pick(DESIGN_STATUSES, formData, "status") ?? d.status;
    const approvedBy = opt(formData, "approvedBy", 120) ?? d.approvedBy;
    if (status === "approved" && !approvedBy) throw new Error("Approval needs the engineer of record's name");
    await appDb().update(designPackages).set({ status, approvedBy, issuedAt: status === "issued" && !d.issuedAt ? today() : d.issuedAt, updatedAt: new Date().toISOString() }).where(eq(designPackages.id, d.id));
  });
  redirect(note(tabUrl(projectId, "engineering"), "Design package updated."));
}

export async function addEngineeringRequirementAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const discipline = z.enum(keys(DISCIPLINES)).parse(formData.get("discipline"));
  const standard = z.string().trim().min(2).max(200).parse(formData.get("standard"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(engineeringRequirements).values({
      projectId: id, mandateId: p.mandateId, discipline, standard, version: str(formData, "version", 60), jurisdiction: opt(formData, "jurisdiction", 80),
      authority: opt(formData, "authority", 200), source: str(formData, "source", 500), effectiveDate: date(formData, "effectiveDate"), status: "identified",
    });
  });
  redirect(note(tabUrl(id, "engineering"), "Code or standard added. It stays Identified until the engineer of record confirms it."));
}

export async function updateEngineeringRequirementAction(formData: FormData) {
  const reqId = zId.parse(formData.get("reqId"));
  let projectId = "";
  await withOsUser(async user => {
    const x = await scopedRow(user.scope, engineeringRequirements, reqId);
    projectId = x.projectId;
    const status = pick(ENG_REQ_STATUSES, formData, "status") ?? x.status;
    const reviewer = opt(formData, "reviewer", 120) ?? x.reviewer;
    if (status === "confirmed" && !reviewer) throw new Error("Confirmation needs the engineer of record's name");
    await appDb().update(engineeringRequirements).set({ status, reviewer, lastVerified: status !== x.status || reviewer !== x.reviewer ? today() : x.lastVerified, updatedAt: new Date().toISOString() }).where(eq(engineeringRequirements.id, x.id));
    await audit(appDb(), { actor: user.email, action: "engineering_requirement_updated", entity: "engineering_requirements", entityId: x.id, before: { status: x.status }, after: { status, reviewer } });
  });
  redirect(note(tabUrl(projectId, "engineering"), "Updated."));
}

// E&S and insurance

export async function addEsIssueAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const topic = z.enum(keys(ES_TOPICS)).parse(formData.get("topic"));
  const description = z.string().trim().min(3).max(2000).parse(formData.get("description"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(esIssues).values({
      projectId: id, mandateId: p.mandateId, topic, description, framework: pick(ES_FRAMEWORKS, formData, "framework") ?? "host_law", reference: str(formData, "reference", 200),
      severity: pick(SEVERITIES, formData, "severity") ?? "medium", mitigationStep: pick(MITIGATION_STEPS, formData, "mitigationStep") ?? "none", mitigation: str(formData, "mitigation", 2000),
      owner: opt(formData, "owner", 120), dueDate: date(formData, "dueDate"), evidence: str(formData, "evidence", 1000),
    });
  });
  redirect(note(tabUrl(id, "risk"), "E&S issue added."));
}

export async function updateEsIssueAction(formData: FormData) {
  const issueId = zId.parse(formData.get("issueId"));
  let projectId = "";
  await withOsUser(async user => {
    const x = await scopedRow(user.scope, esIssues, issueId);
    projectId = x.projectId;
    await appDb().update(esIssues).set({ status: pick(ES_STATUSES, formData, "status") ?? x.status, mitigationStep: pick(MITIGATION_STEPS, formData, "mitigationStep") ?? x.mitigationStep, updatedAt: new Date().toISOString() }).where(eq(esIssues.id, x.id));
  });
  redirect(note(tabUrl(projectId, "risk"), "E&S issue updated."));
}

export async function addInsuranceAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const type = z.enum(keys(INSURANCE_TYPES)).parse(formData.get("type"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(insurancePolicies).values({
      projectId: id, mandateId: p.mandateId, type, phase: pick(INSURANCE_PHASES, formData, "phase") ?? "construction", status: pick(INSURANCE_STATUSES, formData, "status") ?? "required",
      insurer: opt(formData, "insurer", 200), broker: opt(formData, "broker", 200), coverageLimit: num(formData, "coverageLimit"), deductible: num(formData, "deductible"), premium: num(formData, "premium"),
      currency: opt(formData, "currency", 8) ?? p.currency ?? "USD", startsAt: date(formData, "startsAt"), expiresAt: date(formData, "expiresAt"), lenderRequirement: str(formData, "lenderRequirement", 1000),
    });
  });
  redirect(note(tabUrl(id, "risk"), "Insurance line added."));
}

export async function updateInsuranceAction(formData: FormData) {
  const policyId = zId.parse(formData.get("policyId"));
  let projectId = "";
  await withOsUser(async user => {
    const x = await scopedRow(user.scope, insurancePolicies, policyId);
    projectId = x.projectId;
    await appDb().update(insurancePolicies).set({ status: pick(INSURANCE_STATUSES, formData, "status") ?? x.status, expiresAt: formData.has("expiresAt") ? date(formData, "expiresAt") : x.expiresAt, updatedAt: new Date().toISOString() }).where(eq(insurancePolicies.id, x.id));
  });
  redirect(note(tabUrl(projectId, "risk"), "Insurance updated."));
}

// Economics

export async function addRevenueStreamAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const mechanism = z.enum(keys(REVENUE_MECHANISMS)).parse(formData.get("mechanism"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(revenueStreams).values({
      projectId: id, mandateId: p.mandateId, mechanism, name: str(formData, "name", 200), counterparty: opt(formData, "counterparty", 200), unitPrice: num(formData, "unitPrice"),
      unit: opt(formData, "unit", 20), annualVolume: num(formData, "annualVolume"), currency: opt(formData, "currency", 8) ?? p.currency ?? "USD", escalationPct: num(formData, "escalationPct"),
      indexation: str(formData, "indexation", 200), tenorYears: num(formData, "tenorYears"), counterpartyCredit: str(formData, "counterpartyCredit", 300), paymentSecurity: str(formData, "paymentSecurity", 300),
      termination: str(formData, "termination", 500), status: pick(REVENUE_STATUSES, formData, "status") ?? "indicative",
    });
  });
  redirect(note(tabUrl(id, "economics"), "Revenue stream added."));
}

export async function updateRevenueStreamAction(formData: FormData) {
  const streamId = zId.parse(formData.get("streamId"));
  let projectId = "";
  await withOsUser(async user => {
    const x = await scopedRow(user.scope, revenueStreams, streamId);
    projectId = x.projectId;
    await appDb().update(revenueStreams).set({ status: pick(REVENUE_STATUSES, formData, "status") ?? x.status, updatedAt: new Date().toISOString() }).where(eq(revenueStreams.id, x.id));
  });
  redirect(note(tabUrl(projectId, "economics"), "Revenue stream updated."));
}

function readInputs(f: FormData, currency: string): CaseInputs {
  const out = { ...DEFAULT_INPUTS, currency, capex: 0, revenueYear1: 0, opexYear1: 0 } as CaseInputs;
  for (const { key } of INPUT_FIELDS) {
    const v = num(f, key);
    if (v !== null) (out as Record<string, number | string>)[key] = v;
  }
  if (out.capex <= 0) throw new Error("CAPEX is required");
  out.lifeYears = Math.min(60, Math.max(1, Math.round(out.lifeYears)));
  out.debtTenorYears = Math.min(out.lifeYears, Math.max(0, Math.round(out.debtTenorYears)));
  return out;
}

export async function saveCaseAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const name = z.string().trim().min(1).max(120).catch("Base case").parse(formData.get("name"));
  const kind = z.enum(keys(CASE_KINDS)).catch("base").parse(formData.get("kind"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    const c = await saveCase(appDb(), id, { name, kind, inputs: readInputs(formData, opt(formData, "currency", 8) ?? p.currency ?? "USD"), source: str(formData, "source", 500) }, user.email);
    if (kind === "base") await deriveScenarios(appDb(), c.id, user.email);
  });
  redirect(note(tabUrl(id, "economics"), kind === "base" ? "Base case saved; downside and upside derived from it." : "Case saved."));
}

export async function updateCaseAction(formData: FormData) {
  const caseId = zId.parse(formData.get("caseId"));
  let projectId = "";
  await withOsUser(async user => {
    const c = await scopedRow(user.scope, economicCases, caseId);
    projectId = c.projectId;
    if (c.baseCaseId) throw new Error("Derived cases follow their base case; edit the base case");
    await updateCaseInputs(appDb(), c.id, readInputs(formData, c.inputs.currency), user.email);
  });
  redirect(note(`${tabUrl(projectId, "economics")}&case=${caseId}`, "Case recalculated."));
}

export async function deleteCaseAction(formData: FormData) {
  const caseId = zId.parse(formData.get("caseId"));
  let projectId = "";
  await withOsUser(async user => {
    const c = await scopedRow(user.scope, economicCases, caseId);
    projectId = c.projectId;
    await appDb().delete(economicCases).where(eq(economicCases.baseCaseId, c.id));
    await appDb().delete(economicCases).where(eq(economicCases.id, c.id));
    await audit(appDb(), { actor: user.email, action: "economic_case_deleted", entity: "economic_cases", entityId: c.id, before: { name: c.name } });
  });
  redirect(note(tabUrl(projectId, "economics"), "Case removed."));
}
