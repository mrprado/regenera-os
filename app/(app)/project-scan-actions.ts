"use server";

// Project partner scans: one click builds the project's brief and starts the scan right away; results come back to the
// project ranked by fit. No launcher detour; no Apollo credits (open web within the scan's research budget, the public
// register and existing records). Nobody is contacted; results need review.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { runJobsOfTypes } from "@/lib/jobs/tick";
import type { ScanSection } from "@/lib/scan/config";
import { ScanBlocked, startScan } from "@/lib/scan/engine";
import { findPreset } from "@/lib/scan/presets";
import { PARTNER_TYPES, saveProjectScan, type PartnerType } from "@/lib/scan/project-scan";

export async function startProjectScanAction(formData: FormData) {
  const projectId = z.string().uuid().parse(formData.get("projectId"));
  const type = z.enum(Object.keys(PARTNER_TYPES) as [PartnerType, ...PartnerType[]]).parse(formData.get("type"));
  const back = z.string().startsWith("/").catch(`/projects/${projectId}?tab=matches`).parse(formData.get("back"));
  let msg = "";
  await withOsUser(async user => {
    const db = appDb();
    const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    const key = await saveProjectScan(db, p, type, user.email);
    const preset = await findPreset(db, p.mandateId, key);
    if (!preset) throw new Error("Scan preset not saved");
    try {
      const { reused } = await startScan(db, { mandateId: p.mandateId, requestedBy: user.email, section: PARTNER_TYPES[type].section as ScanSection, presetKey: key, presetId: preset.id ?? null, presetName: preset.name, config: preset.config, fallbackAccepted: true },
        { apollo: apolloConfig(), ai: aiConfig() });
      if (!reused) await runJobsOfTypes(db, ["scan.step"], { budgetMs: 4_000 });
      msg = reused ? `${PARTNER_TYPES[type].label}: this scan already ran today; showing its results.` : `${PARTNER_TYPES[type].label}: scan started from this project's details. Results appear below as they land.`;
      await audit(db, { actor: user.email, action: "project_scan_started", entity: "projects", entityId: p.id, after: { type, preset: key } });
    } catch (e) { msg = e instanceof ScanBlocked ? e.message : (e as Error).message.slice(0, 300); }
  });
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg)}#partner-scans`);
}
