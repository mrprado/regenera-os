"use server";

// Project partner scans: build the project's scan preset for one partner type, then open it in the scan launcher.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { PARTNER_TYPES, saveProjectScan, type PartnerType } from "@/lib/scan/project-scan";

export async function startProjectScanAction(formData: FormData) {
  const projectId = z.string().uuid().parse(formData.get("projectId"));
  const type = z.enum(Object.keys(PARTNER_TYPES) as [PartnerType, ...PartnerType[]]).parse(formData.get("type"));
  let key = "", ws = "";
  await withOsUser(async user => {
    const [p] = await appDb().select().from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    key = await saveProjectScan(appDb(), p, type, user.email);
    ws = p.mandateId;
    await audit(appDb(), { actor: user.email, action: "project_scan_prepared", entity: "projects", entityId: p.id, after: { type, preset: key } });
  });
  redirect(`/scans?preset=${encodeURIComponent(key)}&ws=${encodeURIComponent(ws)}`);
}
