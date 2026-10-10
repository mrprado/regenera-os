"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { activities, deals, offerProposals } from "@/db/schema";
import { commercialStageOf, recordStage } from "@/lib/lifecycle/pipeline";
import { FROM_DEAL_STAGE } from "@/lib/lifecycle/vocab";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { siteConfig } from "@/lib/config";
import { importTrackerFromSite } from "@/lib/crm/site-intake";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { checkDealGate } from "@/lib/events/engine";
import { DEAL_STAGES } from "@/lib/vocab";

const zStage = z.enum(Object.keys(DEAL_STAGES) as [keyof typeof DEAL_STAGES, ...(keyof typeof DEAL_STAGES)[]]);

export async function moveDeal(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const stage = zStage.parse(formData.get("stage"));
  const back = String(formData.get("back") ?? "/deals");
  let blocked: string | null = null;
  await withOsUser(async user => {
    const db = appDb();
    const [d] = await db.select().from(deals).where(and(eq(deals.id, id), mandateCondition(user.scope, deals.mandateId)));
    if (!d) throw new Error("Deal not found");
    if (d.stage === stage) return;
    // Stage gates (§12): advancing needs verifiable conditions; an owner can override with a reason (audited).
    const gate = await checkDealGate(db, id, stage);
    if (gate.gated && !gate.passed) {
      const failed = gate.results.filter(r => !r.pass).map(r => r.text);
      const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
      const override = formData.get("override") === "on" && isOwner(user.scope, d.mandateId) && reason.length >= 10;
      if (gate.enforce === "block" && !override) { blocked = stage; return; }
      await audit(db, { actor: user.email, action: "deal_gate_override", entity: "deals", entityId: id, after: { toStage: stage, reason, failed } });
    }
    const now = new Date().toISOString();
    // Phase 29: the commercial stage and its history follow the older board moves; Signed comes only from an agreement.
    if (stage === "signed" && !(await db.select({ id: offerProposals.id }).from(offerProposals).where(and(eq(offerProposals.dealId, id), isNotNull(offerProposals.engagementId)))).length && !(formData.get("override") === "on" && isOwner(user.scope, d.mandateId))) { blocked = stage; return; }
    await db.update(deals).set({ stage, commercialStage: FROM_DEAL_STAGE[stage], stageChangedAt: now, updatedAt: now }).where(eq(deals.id, id));
    await recordStage(db, { mandateId: d.mandateId, pipeline: "commercial", entityType: "deal", entityId: id, from: commercialStageOf(d), to: FROM_DEAL_STAGE[stage], reason: String(formData.get("reason") ?? "").slice(0, 300) || "Moved on the pipeline board", by: user.email });
    await db.insert(activities).values({ mandateId: d.mandateId, dealId: id, orgId: d.orgId, contactId: d.contactId, type: "stage_change", detail: `${DEAL_STAGES[d.stage]} → ${DEAL_STAGES[stage]}`, source: "manual", actor: user.email });
    await audit(db, { actor: user.email, action: "deal_stage", entity: "deals", entityId: id, before: { stage: d.stage }, after: { stage } });
  });
  if (blocked) redirect(`/deals/${id}?gate=${blocked}`);
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

const optNum = (v: FormDataEntryValue | null, max: number) => {
  const s = typeof v === "string" ? v.replace(/[, ]/g, "") : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

/** Forecast inputs (docs/plans/phase-4.md item 4): value, monthly retainer, probability override, expected close. */
export async function setForecastAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const expectedClose = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined).parse(formData.get("expectedClose") || undefined) ?? null;
  const valueEstimate = optNum(formData.get("value"), 1e10);
  const monthlyValue = optNum(formData.get("monthly"), 1e9);
  const probability = optNum(formData.get("probability"), 100);
  const back = String(formData.get("back") ?? "/deals?view=table");
  await withOsUser(async user => {
    const db = appDb();
    const [d] = await db.update(deals).set({ expectedClose, valueEstimate, monthlyValue, probability: probability === null ? null : Math.round(probability), updatedAt: new Date().toISOString() })
      .where(and(eq(deals.id, id), mandateCondition(user.scope, deals.mandateId))).returning({ id: deals.id });
    if (!d) throw new Error("Deal not found");
    await audit(db, { actor: user.email, action: "deal_forecast", entity: "deals", entityId: id, after: { expectedClose, valueEstimate, monthlyValue, probability } });
  });
  redirect(back.startsWith("/deals") ? back : "/deals?view=table");
}
