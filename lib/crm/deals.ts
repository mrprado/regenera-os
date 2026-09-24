// Automatic deal movement (replies, calendar). Only ever moves a deal forward along the pipeline, so an
// automation can never undo a manual stage. Creates the deal when an organization first engages.
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, deals, organizations } from "@/db/schema";
import { DEAL_STAGES, ENGAGEMENT_PATHS } from "@/lib/vocab";

export type DealStage = keyof typeof DEAL_STAGES;
const ORDER: DealStage[] = ["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "expansion", "completed"];
const CLOSED: DealStage[] = ["completed", "churned", "lost"];

export async function advanceDeal(db: Db, input: {
  mandateId: string; orgId: string | null; contactId: string | null; to: DealStage; path?: (typeof ENGAGEMENT_PATHS)[number]; actor: string; source: "job" | "calendar"; reason: string; now?: Date;
}): Promise<{ dealId: string; moved: boolean; created: boolean } | null> {
  if (!input.orgId && !input.contactId) return null;
  const now = (input.now ?? new Date()).toISOString();
  const where = input.orgId ? eq(deals.orgId, input.orgId) : eq(deals.contactId, input.contactId!);
  const [d] = await db.select().from(deals).where(and(eq(deals.mandateId, input.mandateId), where, notInArray(deals.stage, CLOSED))).orderBy(desc(deals.updatedAt)).limit(1);
  if (!d) {
    if (input.to === "nurture" || ORDER.indexOf(input.to) < ORDER.indexOf("engaged")) return null;
    const [org] = input.orgId ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, input.orgId)) : [];
    const [row] = await db.insert(deals).values({
      mandateId: input.mandateId, orgId: input.orgId, contactId: input.contactId, name: org?.name ?? "New deal",
      stage: input.to, path: input.path ?? "project_diagnostic", source: "email", stageChangedAt: now,
    }).returning({ id: deals.id });
    await db.insert(activities).values({ mandateId: input.mandateId, dealId: row.id, orgId: input.orgId, contactId: input.contactId, type: "stage_change", detail: `Created at ${DEAL_STAGES[input.to]}: ${input.reason}`, source: input.source, actor: input.actor });
    return { dealId: row.id, moved: true, created: true };
  }
  const forward = input.to === "nurture"
    ? ["lead", "contacted", "engaged"].includes(d.stage)
    : d.stage === "nurture" || ORDER.indexOf(input.to) > ORDER.indexOf(d.stage);
  if (!forward) return { dealId: d.id, moved: false, created: false };
  await db.update(deals).set({ stage: input.to, stageChangedAt: now, updatedAt: now }).where(eq(deals.id, d.id));
  await db.insert(activities).values({ mandateId: input.mandateId, dealId: d.id, orgId: d.orgId, contactId: d.contactId, type: "stage_change", detail: `${DEAL_STAGES[d.stage]} → ${DEAL_STAGES[input.to]}: ${input.reason}`, source: input.source, actor: input.actor });
  return { dealId: d.id, moved: true, created: false };
}
