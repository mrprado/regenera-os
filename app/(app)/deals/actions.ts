"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { activities, deals } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { siteConfig } from "@/lib/config";
import { importTrackerFromSite } from "@/lib/crm/site-intake";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { DEAL_STAGES } from "@/lib/vocab";

const zStage = z.enum(Object.keys(DEAL_STAGES) as [keyof typeof DEAL_STAGES, ...(keyof typeof DEAL_STAGES)[]]);

export async function moveDeal(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const stage = zStage.parse(formData.get("stage"));
  const back = String(formData.get("back") ?? "/deals");
  await withOsUser(async user => {
    const db = appDb();
    const [d] = await db.select().from(deals).where(and(eq(deals.id, id), mandateCondition(user.scope, deals.mandateId)));
    if (!d) throw new Error("Deal not found");
    if (d.stage === stage) return;
    const now = new Date().toISOString();
    await db.update(deals).set({ stage, stageChangedAt: now, updatedAt: now }).where(eq(deals.id, id));
    await db.insert(activities).values({ mandateId: d.mandateId, dealId: id, orgId: d.orgId, contactId: d.contactId, type: "stage_change", detail: `${DEAL_STAGES[d.stage]} → ${DEAL_STAGES[stage]}`, source: "manual", actor: user.email });
    await audit(db, { actor: user.email, action: "deal_stage", entity: "deals", entityId: id, before: { stage: d.stage }, after: { stage } });
  });
  redirect(back.startsWith("/deals") ? back : "/deals");
}

export async function setNextAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const nextAction = z.string().trim().max(300).parse(formData.get("nextAction"));
  const nextActionDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined).parse(formData.get("nextActionDate") || undefined);
  await withOsUser(async user => {
    const db = appDb();
    await db.update(deals).set({ nextAction, nextActionDate: nextActionDate ?? null, updatedAt: new Date().toISOString() })
      .where(and(eq(deals.id, id), mandateCondition(user.scope, deals.mandateId)));
  });
  redirect(`/deals?focus=${id}`);
}

export async function importTrackerAction() {
  let notice = "";
  await withOsUser(async user => {
    const cfg = siteConfig();
    if (!cfg) { notice = "Set SITE_EXPORT_TOKEN (and deploy the site's os-integration branch) to import the tracker."; return; }
    const r = await importTrackerFromSite(appDb(), cfg);
    await audit(appDb(), { actor: user.email, action: "tracker_import", entity: "deals", after: r });
    notice = `Tracker imported: ${r.created} new, ${r.updated} updated. By stage: ${Object.entries(r.byStage).map(([k, v]) => `${k} ${v}`).join(", ")}.`;
  }, { owner: true });
  redirect(`/deals?notice=${encodeURIComponent(notice)}`);
}
