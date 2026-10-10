// Steward alerts (phase 28D): one grouped notification per workspace per day, never one per item (no notification
// storms). Built with member-level visibility so a digest sent to every member never reveals restricted records:
// grievances and restricted knowledge are excluded.
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "@/db";
import { mandates, notifications, stewardSourceFetches } from "@/db/schema";
import { localDate } from "@/lib/command/desk";
import type { UserScope } from "@/lib/db/scoped";
import { stewardOverview } from "./engine";

export async function stewardDigest(db: Db, now = new Date()) {
  const today = localDate(now);
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  let sent = 0;
  for (const m of await db.select({ id: mandates.id }).from(mandates)) {
    const key = `steward-digest:${m.id}:${today}`;
    const [already] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.mandateId, m.id), eq(notifications.entityType, "steward_digest"), eq(notifications.entityId, key))).limit(1);
    if (already) continue;
    const memberView: UserScope = { kind: "user", userId: "system", email: "system@regenera", mandateIds: [m.id], ownerOf: [] };
    const o = await stewardOverview(db, memberView, today);
    if (!o.places.length) continue;
    const failed = (await db.select({ id: stewardSourceFetches.id }).from(stewardSourceFetches).where(and(eq(stewardSourceFetches.mandateId, m.id), eq(stewardSourceFetches.state, "failed"), gte(stewardSourceFetches.startedAt, since)))).length;
    const lines = [
      o.overdueActions.length ? `${o.overdueActions.length} overdue care action${o.overdueActions.length === 1 ? "" : "s"}` : null,
      o.commitments.length + o.obligations.length ? `${o.commitments.length + o.obligations.length} commitment${o.commitments.length + o.obligations.length === 1 ? "" : "s"} due within 30 days` : null,
      o.consentReviews.length + o.knowledgeReviews.length ? `${o.consentReviews.length + o.knowledgeReviews.length} consent or permission review${o.consentReviews.length + o.knowledgeReviews.length === 1 ? "" : "s"} due` : null,
      o.budgetGaps.length ? `${o.budgetGaps.length} stewardship budget${o.budgetGaps.length === 1 ? "" : "s"} with a funding gap` : null,
      o.needsBaseline.length ? `${o.needsBaseline.length} place${o.needsBaseline.length === 1 ? "" : "s"} without a baseline` : null,
      failed ? `${failed} source quer${failed === 1 ? "y" : "ies"} failed in the last 24 hours` : null,
    ].filter(Boolean) as string[];
    if (!lines.length) continue;
    await db.insert(notifications).values({ mandateId: m.id, category: "project", priority: o.overdueActions.length ? "action" : "information", title: "Steward: what needs attention", body: lines.join(" · "), entityType: "steward_digest", entityId: key, link: "/steward" });
    sent++;
  }
  return sent;
}
