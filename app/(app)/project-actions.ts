"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { capitalRequirements, capitalTranches, constraints, contracts, deals, projectParties, projects, risks, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { createProject, createProjectFromDeal, projectNote, setReadiness, setStage } from "@/lib/projects/engine";
import {
  ASSET_CLASSES, CAPITAL_STATUSES, CONSTRAINT_CATEGORIES, CONSTRAINT_STATUSES, IMPACT, INSTRUMENTS, LIKELIHOOD, PARTY_ROLES, PROJECT_STAGES,
  PROJECT_STATUSES, READINESS_DIMENSIONS, READINESS_STATUSES, REGENERA_ROLES, RESIDUAL, RISK_CATEGORIES, RISK_STATUSES, SEVERITIES,
} from "@/lib/projects/vocab";
import { SECTORS } from "@/lib/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const opt = (f: FormData, k: string, max = 300) => str(f, k, max) || null;
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const pick = <T extends Record<string, string>>(o: T, f: FormData, k: string) => { const v = str(f, k); return (v in o ? v : null) as (keyof T & string) | null; };

async function scopedProject(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}

export async function createProjectAction(formData: FormData) {
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  let target = "/projects";
  await withOsUser(async user => {
    const mandateId = z.string().min(1).parse(formData.get("mandateId") || user.scope.mandateIds[0]);
    if (!user.scope.mandateIds.includes(mandateId)) throw new Error("Not your entity");
    const lat = num(formData, "lat"), lng = num(formData, "lng");
    const p = await createProject(appDb(), {
      mandateId, name, description: str(formData, "description", 4000), assetClass: pick(ASSET_CLASSES, formData, "assetClass"),
      sector: pick(SECTORS, formData, "sector"), technology: opt(formData, "technology"), capacity: num(formData, "capacity"), capacityUnit: opt(formData, "capacityUnit", 20),
      capex: num(formData, "capex"), currency: opt(formData, "currency", 8), stage: pick(PROJECT_STAGES, formData, "stage") ?? "opportunity",
      regeneraRole: pick(REGENERA_ROLES, formData, "regeneraRole"), country: opt(formData, "country", 80), subdivision: opt(formData, "subdivision", 120),
      municipality: opt(formData, "municipality", 120), lat: lat !== null && Math.abs(lat) <= 90 ? lat : null, lng: lng !== null && Math.abs(lng) <= 180 ? lng : null,
      originationSource: opt(formData, "originationSource"), ownerEmail: user.email,
    }, user.email);
    target = note(`/projects/${p.id}`, "Project created. Readiness starts as Unknown across all 14 dimensions.");
  });
  redirect(target);
}

export async function createProjectFromDealAction(formData: FormData) {
  const dealId = zId.parse(formData.get("dealId"));
  let target = "/projects";
  await withOsUser(async user => {
    const [d] = await appDb().select({ id: deals.id }).from(deals).where(and(eq(deals.id, dealId), mandateCondition(user.scope, deals.mandateId)));
    if (!d) throw new Error("Opportunity not found");
    const r = await createProjectFromDeal(appDb(), dealId, user.email);
    target = note(`/projects/${r.id}`, r.created ? "Project created from the opportunity and linked to it. Confirm the sponsor and location." : "This opportunity already has a project.");
  });
  redirect(target);
}

export async function updateProjectAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    const lat = num(formData, "lat"), lng = num(formData, "lng");
    const geometry = str(formData, "geometry", 200_000);
    if (geometry) { try { const g = JSON.parse(geometry) as { type?: string }; if (!g.type) throw new Error(); } catch { throw new Error("Geometry must be GeoJSON"); } }
    const patch = {
      name: str(formData, "name", 200) || p.name, description: str(formData, "description", 4000), assetClass: pick(ASSET_CLASSES, formData, "assetClass"),
      sector: pick(SECTORS, formData, "sector"), subsector: opt(formData, "subsector"), technology: opt(formData, "technology"), capacity: num(formData, "capacity"),
      capacityUnit: opt(formData, "capacityUnit", 20), capex: num(formData, "capex"), currency: opt(formData, "currency", 8),
      status: pick(PROJECT_STATUSES, formData, "status") ?? p.status, regeneraRole: pick(REGENERA_ROLES, formData, "regeneraRole"),
      country: opt(formData, "country", 80), subdivision: opt(formData, "subdivision", 120), municipality: opt(formData, "municipality", 120),
      lat: lat !== null && Math.abs(lat) <= 90 ? lat : null, lng: lng !== null && Math.abs(lng) <= 180 ? lng : null, geometry: geometry || null,
      originationSource: opt(formData, "originationSource"), updatedAt: new Date().toISOString(),
    };
    await appDb().update(projects).set(patch).where(eq(projects.id, id));
    await audit(appDb(), { actor: user.email, action: "project_updated", entity: "projects", entityId: id, before: { name: p.name, capex: p.capex, country: p.country }, after: { name: patch.name, capex: patch.capex, country: patch.country } });
  });
  redirect(note(`/projects/${id}`, "Saved."));
}

export async function setStageAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const stage = z.enum(keys(PROJECT_STAGES)).parse(formData.get("stage"));
  await withOsUser(async user => {
    await scopedProject(user.scope, id);
    await setStage(appDb(), id, stage, user.email, str(formData, "reason", 300));
  });
  redirect(note(`/projects/${id}`, `Stage set to ${PROJECT_STAGES[stage]}.`));
}

export async function setReadinessAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const dimension = z.enum(keys(READINESS_DIMENSIONS)).parse(formData.get("dimension"));
  const status = z.enum(keys(READINESS_STATUSES)).parse(formData.get("status"));
  await withOsUser(async user => {
    await scopedProject(user.scope, id);
    await setReadiness(appDb(), id, dimension, { status, evidence: str(formData, "evidence", 1000), owner: opt(formData, "owner", 120) }, user.email);
  });
  redirect(note(`/projects/${id}?tab=readiness`, `${READINESS_DIMENSIONS[dimension]}: ${READINESS_STATUSES[status]}.`));
}

export async function addConstraintAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const category = z.enum(keys(CONSTRAINT_CATEGORIES)).parse(formData.get("category"));
  const description = z.string().trim().min(3).max(1000).parse(formData.get("description"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(constraints).values({
      projectId: id, mandateId: p.mandateId, category, description, severity: pick(SEVERITIES, formData, "severity") ?? "medium",
      evidence: str(formData, "evidence", 1000), owner: opt(formData, "owner", 120), resolutionAction: str(formData, "resolutionAction", 1000), deadline: date(formData, "deadline"),
    });
    await projectNote(appDb(), id, `Constraint added (${category}): ${description}`, user.email);
  });
  redirect(note(`/projects/${id}?tab=constraints`, "Constraint added."));
}

export async function constraintStatusAction(formData: FormData) {
  const cid = zId.parse(formData.get("constraintId"));
  const status = z.enum(keys(CONSTRAINT_STATUSES)).parse(formData.get("status"));
  let projectId = "";
  await withOsUser(async user => {
    const [c] = await appDb().select().from(constraints).where(and(eq(constraints.id, cid), mandateCondition(user.scope, constraints.mandateId)));
    if (!c) throw new Error("Constraint not found");
    projectId = c.projectId;
    await appDb().update(constraints).set({ status, resolvedAt: status === "resolved" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(eq(constraints.id, cid));
  });
  redirect(note(`/projects/${projectId}?tab=constraints`, `Constraint marked ${CONSTRAINT_STATUSES[status].toLowerCase()}.`));
}

export async function addPartyAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const role = z.enum(keys(PARTY_ROLES)).parse(formData.get("role"));
  const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
  const contactId = zId.safeParse(formData.get("contactId")).data ?? null;
  if (!orgId && !contactId) redirect(note(`/projects/${id}?tab=partners`, "Pick an organization or a person."));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(projectParties).values({ projectId: id, mandateId: p.mandateId, orgId, contactId, role, confirmed: formData.get("confirmed") === "on" ? "confirmed" : "proposed", note: str(formData, "note", 500) });
  });
  redirect(note(`/projects/${id}?tab=partners`, `${PARTY_ROLES[role]} added.`));
}

export async function removePartyAction(formData: FormData) {
  const partyId = zId.parse(formData.get("partyId"));
  let projectId = "";
  await withOsUser(async user => {
    const [row] = await appDb().select().from(projectParties).where(and(eq(projectParties.id, partyId), mandateCondition(user.scope, projectParties.mandateId)));
    if (!row) throw new Error("Not found");
    projectId = row.projectId;
    await appDb().delete(projectParties).where(eq(projectParties.id, partyId));
  });
  redirect(note(`/projects/${projectId}?tab=partners`, "Removed."));
}

export async function addRequirementAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const purpose = z.string().trim().min(2).max(200).parse(formData.get("purpose"));
  const instrument = z.enum(keys(INSTRUMENTS)).parse(formData.get("instrument"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(capitalRequirements).values({
      projectId: id, mandateId: p.mandateId, purpose, instrument, stage: pick(PROJECT_STAGES, formData, "stage"), target: num(formData, "target"),
      minimum: num(formData, "minimum"), maximum: num(formData, "maximum"), currency: (str(formData, "currency", 8) || p.currency || "USD").toUpperCase(),
      targetClose: date(formData, "targetClose"), useOfFunds: str(formData, "useOfFunds", 2000), economics: str(formData, "economics", 1000),
      term: str(formData, "term", 200), security: str(formData, "security", 500), seniority: str(formData, "seniority", 200),
      status: pick(CAPITAL_STATUSES, formData, "status") ?? "planned",
    });
    await projectNote(appDb(), id, `Capital requirement added: ${purpose} (${INSTRUMENTS[instrument]})`, user.email);
  });
  redirect(note(`/projects/${id}?tab=capital`, "Capital requirement added."));
}

export async function updateRequirementAction(formData: FormData) {
  const rid = zId.parse(formData.get("requirementId"));
  let projectId = "";
  await withOsUser(async user => {
    const [r] = await appDb().select().from(capitalRequirements).where(and(eq(capitalRequirements.id, rid), mandateCondition(user.scope, capitalRequirements.mandateId)));
    if (!r) throw new Error("Not found");
    projectId = r.projectId;
    const secured = num(formData, "secured");
    await appDb().update(capitalRequirements).set({
      status: pick(CAPITAL_STATUSES, formData, "status") ?? r.status, secured: secured !== null && secured >= 0 ? secured : r.secured,
      targetClose: date(formData, "targetClose") ?? r.targetClose, target: num(formData, "target") ?? r.target, updatedAt: new Date().toISOString(),
    }).where(eq(capitalRequirements.id, rid));
    await audit(appDb(), { actor: user.email, action: "capital_requirement_updated", entity: "capital_requirements", entityId: rid, before: { status: r.status, secured: r.secured, target: r.target } });
  });
  redirect(note(`/projects/${projectId}?tab=capital`, "Capital requirement updated."));
}

export async function addTrancheAction(formData: FormData) {
  const rid = zId.parse(formData.get("requirementId"));
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  let projectId = "";
  await withOsUser(async user => {
    const [r] = await appDb().select().from(capitalRequirements).where(and(eq(capitalRequirements.id, rid), mandateCondition(user.scope, capitalRequirements.mandateId)));
    if (!r) throw new Error("Not found");
    projectId = r.projectId;
    await appDb().insert(capitalTranches).values({
      projectId: r.projectId, requirementId: rid, mandateId: r.mandateId, name, instrument: pick(INSTRUMENTS, formData, "instrument") ?? r.instrument,
      target: num(formData, "target"), currency: r.currency, minParticipation: num(formData, "minParticipation"), maxParticipation: num(formData, "maxParticipation"),
      economics: str(formData, "economics", 1000), seniority: str(formData, "seniority", 200), security: str(formData, "security", 500),
      eligibility: str(formData, "eligibility", 1000), targetInvestorType: str(formData, "targetInvestorType", 300),
    });
  });
  redirect(note(`/projects/${projectId}?tab=capital`, "Tranche added."));
}

export async function linkToProjectAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const kind = z.enum(["deal", "contract"]).parse(formData.get("kind"));
  const targetId = zId.parse(formData.get("targetId"));
  await withOsUser(async user => {
    await scopedProject(user.scope, id);
    const table = kind === "deal" ? deals : contracts;
    await appDb().update(table).set({ projectId: id }).where(and(eq(table.id, targetId), mandateCondition(user.scope, table.mandateId)));
  });
  redirect(note(`/projects/${id}`, kind === "deal" ? "Opportunity linked." : "Contract linked."));
}

export async function addProjectTaskAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const title = z.string().trim().min(2).max(300).parse(formData.get("title"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(tasks).values({ mandateId: p.mandateId, projectId: id, type: "other", title, body: str(formData, "body", 2000), dueAt: date(formData, "dueAt") ?? new Date().toISOString().slice(0, 10) });
  });
  redirect(note(`/projects/${id}`, "Action added (see Tasks)."));
}

export async function addRiskAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const category = z.enum(keys(RISK_CATEGORIES)).parse(formData.get("category"));
  const description = z.string().trim().min(3).max(1000).parse(formData.get("description"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(risks).values({
      projectId: id, mandateId: p.mandateId, category, description, likelihood: pick(LIKELIHOOD, formData, "likelihood") ?? "possible", impact: pick(IMPACT, formData, "impact") ?? "medium",
      mitigation: str(formData, "mitigation", 1000), owner: opt(formData, "owner", 120), trigger: str(formData, "trigger", 500), evidence: str(formData, "evidence", 1000),
    });
  });
  redirect(note(`/projects/${id}?tab=risk`, "Risk added."));
}

export async function updateRiskAction(formData: FormData) {
  const riskId = zId.parse(formData.get("riskId"));
  let projectId = "";
  await withOsUser(async user => {
    const [x] = await appDb().select().from(risks).where(and(eq(risks.id, riskId), mandateCondition(user.scope, risks.mandateId)));
    if (!x) throw new Error("Not found");
    projectId = x.projectId;
    await appDb().update(risks).set({ status: pick(RISK_STATUSES, formData, "status") ?? x.status, residual: pick(RESIDUAL, formData, "residual") ?? x.residual, updatedAt: new Date().toISOString() }).where(eq(risks.id, riskId));
    await audit(appDb(), { actor: user.email, action: "risk_updated", entity: "risks", entityId: riskId, before: { status: x.status, residual: x.residual } });
  });
  redirect(note(`/projects/${projectId}?tab=risk`, "Risk updated."));
}
