"use server";

// Shared scan engine and account qualification (docs/plans/phase-15-command-scans.md). Every action re-reads through the
// user's scope; scans run in the background (the page drives its own steps briefly, the cron finishes the rest).
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { organizations, scanResults, scanRuns, QUALIFICATION_STATUSES, type QualificationStatus } from "@/db/schema";
import { withOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { runJobsOfTypes } from "@/lib/jobs/tick";
import { zScanConfig, SCAN_SECTIONS, type ScanSection } from "@/lib/scan/config";
import { cancelScan, ScanBlocked, startScan } from "@/lib/scan/engine";
import { findPreset, savePreset } from "@/lib/scan/presets";
import { DIMENSIONS, qualificationFor, setAccountBrief, setDimension, setQualificationStatus, type DimensionKey } from "@/lib/scan/qualification";

const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 2000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const err = (e: unknown) => (e instanceof Error ? e.message : "Failed");
const safeBack = (v: string, fallback: string) => (v.startsWith("/") && !v.startsWith("//") ? v : fallback);

export async function startScanAction(formData: FormData) {
  const back = safeBack(str(formData, "back", 300), "/scans");
  const presetKey = str(formData, "preset", 100);
  const section = z.enum(Object.keys(SCAN_SECTIONS) as [ScanSection, ...ScanSection[]]).catch("prospecting").parse(formData.get("section"));
  let target = back;
  try {
    await withOsUser(async user => {
      const ws = user.scope.mandateIds[0];
      if (!ws) throw new Error("No workspace");
      const db = appDb();
      const preset = await findPreset(db, ws, presetKey);
      if (!preset) throw new Error("Choose a scan preset.");
      const max = Number(str(formData, "maxOrganizations", 6)) || preset.config.maxOrganizations;
      const people = Number(str(formData, "maxPeoplePerOrg", 3));
      const config = zScanConfig.parse({ ...preset.config, maxOrganizations: Math.min(500, Math.max(1, max)), maxPeoplePerOrg: Number.isFinite(people) ? Math.min(10, Math.max(0, people)) : preset.config.maxPeoplePerOrg,
        providers: people > 0 && !preset.config.providers.includes("apollo_people") ? [...preset.config.providers, "apollo_people"] : preset.config.providers });
      const { run, reused } = await startScan(db, { mandateId: ws, requestedBy: user.email, section, presetKey: preset.key, presetId: preset.id ?? null, presetName: preset.name, config, fallbackAccepted: formData.get("fallback") === "on" }, { apollo: apolloConfig(), ai: aiConfig() });
      // Drive the first steps now so the page opens with results; the scheduler finishes the rest.
      if (!reused) await runJobsOfTypes(db, ["scan.step"], { budgetMs: 4_000 });
      target = note(`/scans/${run.id}`, reused ? "This scan is already running or ran today with the same settings; showing it." : "Scan started.");
    });
  } catch (e) {
    target = note(back, e instanceof ScanBlocked ? `${e.message}` : err(e));
  }
  redirect(target);
}

/** Polled by the run page while a scan is queued or running: advances it a little and reports whether more remains. */
export async function continueScanAction(runId: string) {
  return withOsUser(async user => {
    const db = appDb();
    const [run] = await db.select({ id: scanRuns.id, mandateId: scanRuns.mandateId, status: scanRuns.status }).from(scanRuns).where(eq(scanRuns.id, z.string().uuid().parse(runId)));
    if (!run || !user.scope.mandateIds.includes(run.mandateId)) throw new Error("Not found");
    if (run.status !== "queued" && run.status !== "running") return { more: false };
    await runJobsOfTypes(db, ["scan.step"], { budgetMs: 4_000 });
    const [after] = await db.select({ status: scanRuns.status }).from(scanRuns).where(eq(scanRuns.id, run.id));
    return { more: after?.status === "queued" || after?.status === "running" };
  });
}

export async function cancelScanAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  let msg = "Scan cancelled. Records already found are kept.";
  await withOsUser(async user => {
    const [run] = await appDb().select({ mandateId: scanRuns.mandateId }).from(scanRuns).where(eq(scanRuns.id, id));
    if (!run || !user.scope.mandateIds.includes(run.mandateId)) throw new Error("Not found");
    if (!(await cancelScan(appDb(), run.mandateId, id, user.email))) msg = "The scan had already finished.";
  });
  redirect(note(`/scans/${id}`, msg));
}

export async function savePresetAction(formData: FormData) {
  const name = z.string().trim().min(3).max(120).parse(formData.get("name"));
  const section = z.enum(Object.keys(SCAN_SECTIONS) as [ScanSection, ...ScanSection[]]).parse(formData.get("section"));
  const geography = str(formData, "geography", 400).split(/[,;\s]+/).filter(Boolean);
  const terms = str(formData, "terms", 400).split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  const excludeTerms = str(formData, "excludeTerms", 400).split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  const providers = formData.getAll("providers").map(String);
  const config = zScanConfig.parse({
    audience: str(formData, "audience", 60), geography, terms, excludeTerms, providers: providers.length ? providers : ["existing"],
    maxOrganizations: Number(str(formData, "maxOrganizations", 6)) || 50, maxPeoplePerOrg: Number(str(formData, "maxPeoplePerOrg", 3)) || 0,
    enrichmentBudget: Number(str(formData, "enrichmentBudget", 6)) || 0, freshnessDays: Number(str(formData, "freshnessDays", 6)) || 365, signalCriteria: str(formData, "signalCriteria", 500),
  });
  const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50)}`;
  await withOsUser(async user => {
    const ws = user.scope.mandateIds[0];
    if (!ws) throw new Error("No workspace");
    await savePreset(appDb(), ws, { key, name, section, note: str(formData, "note", 500), config }, user.email);
  });
  redirect(note("/scans?tab=presets", `Preset "${name}" saved.`));
}

async function orgInScope(user: { scope: { mandateIds: string[] } }, orgId: string) {
  const [o] = await appDb().select({ mandateId: organizations.mandateId }).from(organizations).where(eq(organizations.id, orgId));
  if (!o || !user.scope.mandateIds.includes(o.mandateId)) throw new Error("Not found");
  return o.mandateId;
}

export async function setQualificationAction(formData: FormData) {
  const orgId = z.string().uuid().parse(formData.get("orgId"));
  const to = z.enum(QUALIFICATION_STATUSES).parse(formData.get("to")) as QualificationStatus;
  const back = safeBack(str(formData, "back", 300), `/companies/${orgId}`);
  let msg = "Status recorded.";
  try {
    await withOsUser(async user => {
      const ws = await orgInScope(user, orgId);
      await setQualificationStatus(appDb(), ws, orgId, to, user.email, str(formData, "reason", 1000));
    });
  } catch (e) { msg = err(e); }
  redirect(note(back, msg));
}

export async function setDimensionAction(formData: FormData) {
  const orgId = z.string().uuid().parse(formData.get("orgId"));
  const key = z.enum(Object.keys(DIMENSIONS) as [DimensionKey, ...DimensionKey[]]).parse(formData.get("dimension"));
  const reading = z.enum(["strong", "partial", "weak", "unknown"]).parse(formData.get("reading"));
  const back = safeBack(str(formData, "back", 300), `/companies/${orgId}`);
  let msg = "Reading recorded.";
  try {
    await withOsUser(async user => {
      const ws = await orgInScope(user, orgId);
      await setDimension(appDb(), ws, orgId, key, reading, str(formData, "basis", 1000), user.email, str(formData, "source", 500) || undefined);
    });
  } catch (e) { msg = err(e); }
  redirect(note(back, msg));
}

export async function setAccountBriefAction(formData: FormData) {
  const orgId = z.string().uuid().parse(formData.get("orgId"));
  await withOsUser(async user => {
    const ws = await orgInScope(user, orgId);
    await setAccountBrief(appDb(), ws, orgId, { who: str(formData, "who"), decision: str(formData, "decision"), whyNow: str(formData, "whyNow"), entryOffer: str(formData, "entryOffer", 300), nextAction: str(formData, "nextAction", 500) });
  });
  redirect(note(`/companies/${orgId}?tab=qualification`, "Account brief saved."));
}

/** Review of one scan result: accept keeps it in the review set as reviewed; reject records why (kept, not deleted). */
export async function reviewResultAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const decision = z.enum(["accepted", "rejected"]).parse(formData.get("decision"));
  let runId = "";
  await withOsUser(async user => {
    const db = appDb();
    const [r] = await db.select().from(scanResults).where(eq(scanResults.id, id));
    if (!r || !user.scope.mandateIds.includes(r.mandateId)) throw new Error("Not found");
    runId = r.runId;
    await db.update(scanResults).set({ review: decision, reviewedBy: user.email, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      ...(decision === "rejected" ? { exclusionReason: str(formData, "reason", 500) || r.exclusionReason || "Rejected in review" } : {}) })
      .where(and(eq(scanResults.id, id), eq(scanResults.mandateId, r.mandateId)));
    if (decision === "accepted" && r.entityType === "organization") {
      // Only lifts Discovered / Matches criteria; a later human status is never lowered by a review click.
      const q = await qualificationFor(db, r.mandateId, r.entityId);
      if (!q || q.status === "discovered" || q.status === "criteria_matched") await setQualificationStatus(db, r.mandateId, r.entityId, "human_reviewed", user.email, str(formData, "reason", 500) || "Accepted in scan review");
    }
  });
  redirect(note(`/scans/${runId}?tab=results`, decision === "accepted" ? "Marked human reviewed." : "Rejected; kept with the reason."));
}
