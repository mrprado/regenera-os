"use server";

// Data-provider actions (docs/data/WRI.md). Syncs make real calls and record the outcome; screening refresh and
// flag review act on the user's own projects only. Credentials are read from the Worker environment, never stored.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { projectAttributes, projectScreeningFlags, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { markLicenseReviewed, syncDataset, syncProvider } from "@/lib/data-providers/engine";
import { refreshScreening } from "@/lib/data-providers/site";
import { CLAIM_STATES, IMPACT_ATTRIBUTES } from "@/lib/data-providers/evidence";
import { PROVIDERS } from "@/lib/data-providers/catalog";
import { env } from "cloudflare:workers";

const zId = z.string().uuid();
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const envMap = () => env as unknown as Record<string, string | undefined>;

export async function syncProviderAction(formData: FormData) {
  const provider = z.enum(PROVIDERS.map(p => p.key) as [string, ...string[]]).parse(formData.get("provider"));
  let msg = "";
  await withOsUser(async user => {
    const r = await syncProvider(appDb(), provider, envMap(), user.email);
    msg = r.length ? `${r.filter(x => x.ok).length} of ${r.length} dataset(s) synced. ${r.filter(x => !x.ok).map(x => `${x.id}: ${x.detail}`).slice(0, 3).join(" · ")}` : "No API-backed datasets for this provider: metadata and links only.";
  }, { internal: true });
  redirect(note(`/intelligence/data/${provider}`, msg));
}

export async function syncDatasetAction(formData: FormData) {
  const id = z.string().regex(/^[a-z0-9_.]+$/).parse(formData.get("id"));
  let msg = "";
  await withOsUser(async user => { msg = (await syncDataset(appDb(), id, envMap(), user.email)).detail; }, { internal: true });
  redirect(note(z.string().startsWith("/intelligence/data").catch("/intelligence/data").parse(formData.get("back")), msg));
}

export async function licenseReviewedAction(formData: FormData) {
  const provider = z.enum(PROVIDERS.map(p => p.key) as [string, ...string[]]).parse(formData.get("provider"));
  await withOsUser(async user => { await markLicenseReviewed(appDb(), provider, user.email); }, { internal: true });
  redirect(note(`/intelligence/data/${provider}`, "Licence review recorded. Datasets marked verify still need their own check before export."));
}

async function projectFor(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [p] = await appDb().select({ id: projects.id, mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}

export async function refreshScreeningAction(formData: FormData) {
  const id = zId.parse(formData.get("projectId"));
  let msg = "";
  await withOsUser(async user => { await projectFor(user.scope, id); const r = await refreshScreening(appDb(), id, user.email); msg = `${r.flags} screening flag(s) from the latest site intelligence run.`; });
  redirect(note(`/projects/${id}?tab=screening`, msg));
}

export async function reviewFlagAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let projectId = "";
  await withOsUser(async user => {
    const [f] = await appDb().select().from(projectScreeningFlags).where(and(eq(projectScreeningFlags.id, id), mandateCondition(user.scope, projectScreeningFlags.mandateId)));
    if (!f) throw new Error("Flag not found");
    projectId = f.projectId;
    const status = z.enum(["reviewed", "dismissed", "open"]).parse(formData.get("status"));
    const reviewNote = str(formData, "note", 500);
    if (status === "dismissed" && !reviewNote) throw new Error("Say why the flag is dismissed");
    await appDb().update(projectScreeningFlags).set({ status, reviewNote, reviewedBy: user.email, updatedAt: new Date().toISOString() }).where(eq(projectScreeningFlags.id, id));
    await audit(appDb(), { actor: user.email, action: "screening_flag_review", entity: "project_screening_flags", entityId: id, after: { status, reviewNote } });
  });
  redirect(note(`/projects/${projectId}?tab=screening`, "Flag updated."));
}

/** §12 Evidence-backed impact attribute. A claim without source and methodology is refused. */
export async function addAttributeAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Attribute recorded with its evidence.";
  try {
    await withOsUser(async user => {
      const p = await projectFor(user.scope, projectId);
      const source = str(formData, "source", 300), methodology = str(formData, "methodology", 500), claim = str(formData, "claim", 500);
      if (!claim || !source || !methodology) throw new Error("A claim needs its source and methodology.");
      await appDb().insert(projectAttributes).values({ mandateId: p.mandateId, projectId, subjectType: "project", subjectId: projectId, attribute: z.enum(keys(IMPACT_ATTRIBUTES)).parse(formData.get("attribute")), claim, source, methodology, evidence: str(formData, "evidence", 500), datasetId: str(formData, "datasetId", 80) || null, confidence: z.enum(["high", "moderate", "low", "unknown"]).catch("unknown").parse(formData.get("confidence")), verification: z.enum(keys(CLAIM_STATES)).catch("unverified").parse(formData.get("verification")), createdBy: user.email });
      await audit(appDb(), { actor: user.email, action: "impact_attribute_add", entity: "projects", entityId: projectId });
    });
  } catch (e) { msg = e instanceof Error ? e.message : "Could not save."; }
  redirect(note(`/projects/${projectId}?tab=screening`, msg));
}
