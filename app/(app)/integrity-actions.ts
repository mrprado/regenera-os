"use server";

// Phase 23 integrity actions: screening, owner override with a reason, redesign scenarios, impact records and
// stewardship obligations. Every action is scoped to the user's workspaces and audited; nothing is sent or published.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { capitalProfiles, DECISION_STATES, impactRecords, projects, redesignScenarios, stewardshipObligations } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { overrideDecision, screenProject } from "@/lib/integrity/engine";
import { indicatorByKey } from "@/lib/integrity/indicators";
import { decideScenario, generateScenarios } from "@/lib/integrity/redesign";
import { completeObligation } from "@/lib/integrity/stewardship";

const back = (f: FormData, d: string) => z.string().startsWith("/").catch(d).parse(f.get("back"));
const note = (to: string, msg: string) => {
  const [path, hash] = to.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg)}${hash ? `#${hash}` : ""}`;
};
const pid = (f: FormData) => z.string().uuid().parse(f.get("projectId"));
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").trim().slice(0, max);
type Scope = Parameters<typeof mandateCondition>[0];

async function scopedProject(scope: Scope, projectId: string) {
  const [p] = await appDb().select({ id: projects.id, mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(scope, projects.mandateId)));
  return p ?? null;
}

export async function screenIntegrityAction(formData: FormData) {
  const projectId = pid(formData);
  const to = back(formData, `/projects/${projectId}?tab=capital#integrity`);
  let msg = "";
  await withOsUser(async user => {
    if (!(await scopedProject(user.scope, projectId))) { msg = "Project not found"; return; }
    const d = await screenProject(appDb(), projectId, user.email);
    msg = `Screened under policy v${d.policyVersion}: ${d.state.replace(/_/g, " ")}.`;
  });
  redirect(note(to, msg));
}

export async function overrideIntegrityAction(formData: FormData) {
  const projectId = pid(formData);
  const to = back(formData, `/projects/${projectId}?tab=capital#integrity`);
  const state = z.enum(DECISION_STATES).parse(formData.get("state"));
  const reason = str(formData, "reason", 1000);
  let msg = "";
  await withOsUser(async user => {
    if (!(await scopedProject(user.scope, projectId))) { msg = "Project not found"; return; }
    if (reason.length < 5) { msg = "An override needs a reason."; return; }
    try { await overrideDecision(appDb(), projectId, state, reason, user.email); msg = `Decision overridden to ${state.replace(/_/g, " ")}; the rule outcomes stay on the record.`; }
    catch (e) { msg = (e as Error).message; }
  }, { owner: true });
  redirect(note(to, msg));
}

export async function generateRedesignAction(formData: FormData) {
  const projectId = pid(formData);
  const to = back(formData, `/projects/${projectId}?tab=capital#integrity`);
  let msg = "";
  await withOsUser(async user => {
    if (!(await scopedProject(user.scope, projectId))) { msg = "Project not found"; return; }
    const r = await generateScenarios(appDb(), projectId, user.email);
    msg = `Redesign scenarios v${r.version} drafted (${r.method} method). Directions only until engineering confirms.`;
  });
  redirect(note(to, msg));
}

export async function decideRedesignAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const status = z.enum(["approved", "rejected", "applied"]).parse(formData.get("status"));
  const to = back(formData, "/origination?tab=screening");
  await withOsUser(async user => {
    const [s] = await appDb().select({ id: redesignScenarios.id }).from(redesignScenarios).where(and(eq(redesignScenarios.id, id), mandateCondition(user.scope, redesignScenarios.mandateId)));
    if (s) await decideScenario(appDb(), id, status, user.email);
  });
  redirect(to);
}

export async function addImpactRecordAction(formData: FormData) {
  const projectId = pid(formData);
  const to = back(formData, `/projects/${projectId}?tab=capital#integrity`);
  const ind = indicatorByKey(str(formData, "indicator", 60));
  const kind = z.enum(["baseline", "forecast", "target", "reported", "verified"]).parse(formData.get("kind"));
  const raw = str(formData, "value", 40);
  const value = raw === "" ? null : Number(raw);
  let msg = "";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    if (!p) { msg = "Project not found"; return; }
    if (!ind) { msg = "Choose an indicator."; return; }
    if (value !== null && !Number.isFinite(value)) { msg = "Value must be a number."; return; }
    const verifiedBy = str(formData, "verifiedBy", 200) || null;
    if (kind === "verified" && !verifiedBy) { msg = "An independently verified record names the verifier."; return; }
    const source = str(formData, "source", 500);
    if ((kind === "reported" || kind === "verified" || kind === "baseline") && !source) { msg = "Baseline, reported and verified records need a source."; return; }
    const [row] = await appDb().insert(impactRecords).values({
      mandateId: p.mandateId, projectId, indicator: ind.key, kind, value, unit: ind.unit, periodStart: str(formData, "periodStart", 10) || null, periodEnd: str(formData, "periodEnd", 10) || null,
      method: str(formData, "method", 500) || ind.method, source, verifiedBy, note: str(formData, "note", 1000), createdBy: user.email,
    }).returning({ id: impactRecords.id });
    await audit(appDb(), { actor: user.email, action: "impact.add", entity: "impact_records", entityId: row.id, after: { indicator: ind.key, kind, value } });
    msg = `${ind.label} (${kind}) recorded.`;
  });
  redirect(note(to, msg));
}

export async function addObligationAction(formData: FormData) {
  const projectId = pid(formData);
  const to = back(formData, `/projects/${projectId}?tab=capital#integrity`);
  const kind = z.enum(["monitoring", "reporting", "benefit_sharing", "conservation", "maintenance", "verification"]).parse(formData.get("kind"));
  const title = str(formData, "title", 300);
  const due = str(formData, "dueAt", 10);
  const rec = Number(str(formData, "recurrenceMonths", 3) || 0);
  let msg = "";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    if (!p) { msg = "Project not found"; return; }
    if (!title) { msg = "Give the obligation a title."; return; }
    const [row] = await appDb().insert(stewardshipObligations).values({
      mandateId: p.mandateId, projectId, title, kind, dueAt: /^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T00:00:00.000Z` : null,
      recurrenceMonths: rec > 0 && rec <= 60 ? Math.round(rec) : null, owner: str(formData, "owner", 200) || user.email, indicator: str(formData, "indicator", 60) || null, createdBy: user.email,
    }).returning({ id: stewardshipObligations.id });
    await audit(appDb(), { actor: user.email, action: "stewardship.add", entity: "stewardship_obligations", entityId: row.id, after: { title, kind } });
    msg = "Obligation added.";
  });
  redirect(note(to, msg));
}

export async function completeObligationAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const to = back(formData, "/origination?tab=stewardship");
  const evidence = str(formData, "evidence", 1000);
  let msg = "";
  await withOsUser(async user => {
    const [o] = await appDb().select({ id: stewardshipObligations.id }).from(stewardshipObligations).where(and(eq(stewardshipObligations.id, id), mandateCondition(user.scope, stewardshipObligations.mandateId)));
    if (!o) { msg = "Obligation not found"; return; }
    if (!evidence) { msg = "Completing an obligation needs evidence (a link or a note on what was done)."; return; }
    await completeObligation(appDb(), id, evidence, user.email);
    await audit(appDb(), { actor: user.email, action: "stewardship.complete", entity: "stewardship_obligations", entityId: id });
    msg = "Obligation completed.";
  });
  redirect(note(to, msg));
}

export async function saveImpactCriteriaAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const to = back(formData, `/capital/partners/${id}`);
  const list = (k: string) => str(formData, k, 1000).split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 30);
  const status = z.enum(["potential_eligibility", "preliminary_fit", "investor_interest", "confirmed_mandate", "approved_investment", ""]).catch("").parse(formData.get("investorStatus"));
  let msg = "";
  await withOsUser(async user => {
    const [p] = await appDb().select({ id: capitalProfiles.id }).from(capitalProfiles).where(and(eq(capitalProfiles.id, id), mandateCondition(user.scope, capitalProfiles.mandateId)));
    if (!p) { msg = "Profile not found"; return; }
    const impactCriteria = {
      environmental: list("environmental"), exclusions: list("exclusions"), safeguardStandard: str(formData, "safeguardStandard", 200) || undefined,
      impactReporting: str(formData, "impactReporting", 300) || undefined, catalytic: formData.get("catalytic") === "on", technicalAssistance: formData.get("technicalAssistance") === "on",
    };
    await appDb().update(capitalProfiles).set({ impactCriteria, investorStatus: status || null }).where(eq(capitalProfiles.id, id));
    await audit(appDb(), { actor: user.email, action: "capital.impact_criteria", entity: "capital_profiles", entityId: id, after: { status } });
    msg = "Impact criteria saved.";
  }, { owner: true });
  redirect(note(to, msg));
}
