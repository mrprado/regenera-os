"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { capitalOpportunities, claims, deals, organizations, playbookRuns, playbooks, projects } from "@/db/schema";
import { CLAIM_STATUSES, CLAIM_TYPES, EVIDENCE_METHODS } from "@/db/evidence";
import { MATURITY } from "@/db/playbooks";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { addClaim, addEvidence, setClaimStatus } from "@/lib/evidence/engine";
import { approveRun, ensurePlaybooks, playbookWithDefinition, promoteVersion, recordCorrection, rejectVersion, runStepTool, setStep, startRun, verifyRun } from "@/lib/playbooks/engine";

type Scope = Parameters<typeof mandateCondition>[0];
const zId = z.string().uuid();
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

async function scopedPlaybook(scope: Scope, id: string) {
  const [p] = await appDb().select().from(playbooks).where(and(eq(playbooks.id, id), mandateCondition(scope, playbooks.mandateId)));
  if (!p) throw new Error("Playbook not found");
  return p;
}
/** The mandate of an entity inside the user's scope, or throws. */
async function entityMandate(scope: Scope, type: "project" | "organization" | "capital_opportunity" | "deal", id: string) {
  const t = { project: projects, organization: organizations, capital_opportunity: capitalOpportunities, deal: deals }[type];
  const [r] = await appDb().select({ m: t.mandateId }).from(t).where(and(eq(t.id, id), mandateCondition(scope, t.mandateId)));
  if (!r) throw new Error("Not found");
  return r.m;
}

async function scopedRun(scope: Scope, id: string) {
  const [r] = await appDb().select().from(playbookRuns).where(and(eq(playbookRuns.id, id), mandateCondition(scope, playbookRuns.mandateId)));
  if (!r) throw new Error("Run not found");
  return r;
}

export async function seedPlaybooksAction() {
  let n = 0;
  await withOsUser(async user => { for (const m of user.scope.mandateIds) n += await ensurePlaybooks(appDb(), m); });
  redirect(note("/playbooks", n ? `${n} playbooks added to the library.` : "The library is already complete."));
}

export async function startRunAction(formData: FormData) {
  const playbookId = zId.parse(formData.get("playbookId"));
  let target = "/playbooks";
  await withOsUser(async user => {
    await scopedPlaybook(user.scope, playbookId);
    const entityId = str(formData, "entityId") || null;
    const r = await startRun(appDb(), playbookId, entityId, user.email);
    target = `/playbooks/runs/${r.id}`;
  });
  redirect(target);
}

/** Starts a playbook by key on a project (e.g. "Run site intelligence" on the Place tab). */
export async function runPlaybookOnProjectAction(formData: FormData) {
  const key = z.string().regex(/^[a-z-]+$/).parse(formData.get("key"));
  const projectId = zId.parse(formData.get("projectId"));
  let target = "/playbooks";
  await withOsUser(async user => {
    for (const m of user.scope.mandateIds) await ensurePlaybooks(appDb(), m);
    const [p] = await appDb().select().from(playbooks).where(and(eq(playbooks.key, key), mandateCondition(user.scope, playbooks.mandateId)));
    if (!p) throw new Error("Playbook not found");
    const r = await startRun(appDb(), p.id, projectId, user.email);
    const { def: d } = await playbookWithDefinition(appDb(), p.id);
    // Autonomous tool steps run immediately (public data, calculations); review steps wait for a person.
    for (const s of d.steps.filter(x => x.tool && x.governance === "autonomous")) await runStepTool(appDb(), r.id, s.key, user.email);
    target = `/playbooks/runs/${r.id}`;
  });
  redirect(target);
}

export async function runToolAction(formData: FormData) {
  const runId = zId.parse(formData.get("runId"));
  const stepKey = str(formData, "stepKey", 60);
  let msg = "";
  await withOsUser(async user => { await scopedRun(user.scope, runId); const r = await runStepTool(appDb(), runId, stepKey, user.email); msg = r.note; });
  redirect(note(`/playbooks/runs/${runId}`, msg));
}

export async function setStepAction(formData: FormData) {
  const runId = zId.parse(formData.get("runId"));
  const status = z.enum(["todo", "done", "skipped", "failed"]).parse(formData.get("status"));
  await withOsUser(async user => { await scopedRun(user.scope, runId); await setStep(appDb(), runId, str(formData, "stepKey", 60), status, str(formData, "note", 2000), user.email); });
  redirect(`/playbooks/runs/${runId}`);
}

export async function verifyRunAction(formData: FormData) {
  const runId = zId.parse(formData.get("runId"));
  let msg = "";
  await withOsUser(async user => {
    await scopedRun(user.scope, runId);
    const r = await verifyRun(appDb(), runId, formData.getAll("confirm").map(String), user.email);
    msg = r.status === "completed" ? "Definition of done met: run completed." : r.status === "awaiting_approval" ? "Definition of done met. Waiting for approval." : `Not done yet: ${r.checks.filter(c => !c.pass).length} check(s) failing${r.openSteps.length ? `, ${r.openSteps.length} step(s) open` : ""}.`;
  });
  redirect(note(`/playbooks/runs/${runId}`, msg));
}

export async function approveRunAction(formData: FormData) {
  const runId = zId.parse(formData.get("runId"));
  await withOsUser(async user => { await scopedRun(user.scope, runId); await approveRun(appDb(), runId, user.email); }, { owner: true });
  redirect(note(`/playbooks/runs/${runId}`, "Approved."));
}

export async function correctionAction(formData: FormData) {
  const playbookId = zId.parse(formData.get("playbookId"));
  const layer = z.enum(["process", "toolbox", "proof"]).parse(formData.get("layer"));
  const scope = z.enum(["one_time", "process_rule", "toolbox_update", "proof_check"]).parse(formData.get("scope"));
  const description = z.string().trim().min(3).max(2000).parse(formData.get("description"));
  const runId = str(formData, "runId") || null;
  let msg = "";
  await withOsUser(async user => {
    await scopedPlaybook(user.scope, playbookId);
    const r = await recordCorrection(appDb(), { playbookId, runId, layer, scope, description, change: str(formData, "change", 2000) }, user.email);
    msg = r.proposedVersion ? `Correction recorded; draft version ${r.proposedVersion} awaits approval.` : r.repeated ? "Recorded. This correction has happened before: consider making it a permanent rule." : "Correction recorded for this run only.";
  });
  redirect(note(runId ? `/playbooks/runs/${runId}` : `/playbooks/${playbookId}`, msg));
}

export async function versionAction(formData: FormData) {
  const playbookId = zId.parse(formData.get("playbookId"));
  const version = z.coerce.number().int().min(1).parse(formData.get("version"));
  const decision = z.enum(["promote", "reject"]).parse(formData.get("decision"));
  await withOsUser(async user => {
    await scopedPlaybook(user.scope, playbookId);
    if (decision === "promote") await promoteVersion(appDb(), playbookId, version, user.email); else await rejectVersion(appDb(), playbookId, version, user.email);
  }, { owner: true });
  redirect(note(`/playbooks/${playbookId}`, decision === "promote" ? `Version ${version} is now live.` : `Version ${version} rejected.`));
}

export async function maturityAction(formData: FormData) {
  const playbookId = zId.parse(formData.get("playbookId"));
  const maturity = z.enum(MATURITY).parse(formData.get("maturity"));
  await withOsUser(async user => {
    const p = await scopedPlaybook(user.scope, playbookId);
    await appDb().update(playbooks).set({ maturity, updatedAt: new Date().toISOString() }).where(eq(playbooks.id, p.id));
    await audit(appDb(), { actor: user.email, action: "playbook_maturity", entity: "playbooks", entityId: p.id, before: { maturity: p.maturity }, after: { maturity } });
  }, { owner: true });
  redirect(note(`/playbooks/${playbookId}`, "Maturity updated."));
}

// Claims and evidence

export async function addClaimAction(formData: FormData) {
  const entityType = z.enum(["project", "organization", "capital_opportunity", "deal"]).parse(formData.get("entityType"));
  const entityId = zId.parse(formData.get("entityId"));
  const statement = z.string().trim().min(3).max(1000).parse(formData.get("statement"));
  const back = str(formData, "back", 300).startsWith("/") ? str(formData, "back", 300) : "/today";
  await withOsUser(async user => {
    const status = z.enum(CLAIM_STATUSES).exclude(["verified"]).catch("unverified").parse(formData.get("status"));
    const c = await addClaim(appDb(), { mandateId: await entityMandate(user.scope, entityType, entityId), entityType, entityId, statement, claimType: z.enum(CLAIM_TYPES).catch("fact").parse(formData.get("claimType")), value: str(formData, "value", 200) || null, unit: str(formData, "unit", 30) || null, validFrom: str(formData, "validFrom", 10) || null, createdBy: user.email, status }, user.email);
    const method = z.enum(EVIDENCE_METHODS).safeParse(formData.get("method")).data;
    if (method && (str(formData, "sourceUrl", 1000) || str(formData, "excerpt", 2000) || str(formData, "provider", 200)))
      await addEvidence(appDb(), c.id, { method, provider: str(formData, "provider", 200), sourceUrl: str(formData, "sourceUrl", 1000) || null, excerpt: str(formData, "excerpt", 2000), sourceDate: str(formData, "sourceDate", 10) || null, retrievedAt: new Date().toISOString() }, user.email);
  });
  redirect(note(back, "Claim recorded."));
}

export async function claimStatusAction(formData: FormData) {
  const claimId = zId.parse(formData.get("claimId"));
  const status = z.enum(CLAIM_STATUSES).parse(formData.get("status"));
  const back = str(formData, "back", 300).startsWith("/") ? str(formData, "back", 300) : "/today";
  await withOsUser(async user => {
    const [c] = await appDb().select().from(claims).where(and(eq(claims.id, claimId), mandateCondition(user.scope, claims.mandateId)));
    if (!c) throw new Error("Not found");
    const method = z.enum(EVIDENCE_METHODS).safeParse(formData.get("method")).data;
    if (method && (str(formData, "sourceUrl", 1000) || str(formData, "excerpt", 2000)))
      await addEvidence(appDb(), c.id, { method, provider: str(formData, "provider", 200), sourceUrl: str(formData, "sourceUrl", 1000) || null, excerpt: str(formData, "excerpt", 2000), retrievedAt: new Date().toISOString() }, user.email);
    if (status !== c.status) await setClaimStatus(appDb(), c.id, status, user.email);
  });
  redirect(note(back, "Claim updated."));
}
