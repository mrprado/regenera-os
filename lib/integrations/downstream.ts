// Records that reached an OS workflow, per registry key (phase 21 §8): a connector is not healthy unless usable records
// arrive downstream. Counts come from the tables each source feeds; sources without a mapping show "not measured".
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, fundingOpportunities, organizations, registryAssets, sanctionsLists, signals } from "@/db/schema";

const SIGNAL_KEY: Record<string, string> = { edgar_form_d: "edgar" };

export async function downstreamCounts(db: Db): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const add = (k: string, n: number) => out.set(k, (out.get(k) ?? 0) + Number(n || 0));
  const n = sql<number>`count(*)`;
  const [funding, sigs, assets, lei, placed, lists] = await Promise.all([
    db.select({ k: fundingOpportunities.source, n }).from(fundingOpportunities).groupBy(fundingOpportunities.source),
    db.select({ k: signals.source, n }).from(signals).groupBy(signals.source),
    db.select({ k: registryAssets.source, n }).from(registryAssets).groupBy(registryAssets.source),
    db.select({ n }).from(organizations).where(isNotNull(organizations.lei)),
    db.select({ n }).from(auditLog).where(and(eq(auditLog.action, "project_located"))),
    db.select({ k: sanctionsLists.list, n: sql<number>`coalesce(sum(${sanctionsLists.entryCount}), 0)` }).from(sanctionsLists).groupBy(sanctionsLists.list),
  ]);
  for (const r of funding) add(r.k, r.n);
  for (const r of sigs) add(SIGNAL_KEY[r.k] ?? r.k, r.n);
  for (const r of assets) add(r.k, r.n);
  add("gleif", lei[0]?.n ?? 0);
  add("nominatim", placed[0]?.n ?? 0);
  const LIST_KEY: Record<string, string> = { ofac: "ofac_sdn", uk: "uk_sanctions", eu: "eu_sanctions", un: "un_sanctions" };
  for (const r of lists) if (LIST_KEY[r.k]) add(LIST_KEY[r.k], r.n);
  return out;
}
