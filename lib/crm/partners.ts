// Partner Network read model (docs/plans/phase-3.md item 6). Referral fees follow the site's tiers:
// Standard 10%, Strategic 15%, Institutional 20% of the engagement fee.
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { deals, organizations, partners, segments } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";

export const TIER_FEE: Record<string, number> = { standard: 0.1, strategic: 0.15, institutional: 0.2 };
const WON = ["signed", "active", "expansion", "completed"] as const;

export async function partnerOverview(scope: Scope) {
  const db = appDb();
  const rows = await db.select({ p: partners, orgName: organizations.name, country: organizations.country }).from(partners)
    .leftJoin(organizations, eq(organizations.id, partners.orgId))
    .where(mandateCondition(scope, partners.mandateId)).orderBy(asc(partners.tier), asc(partners.name));
  const ids = rows.map(r => r.p.id);
  const refDeals = ids.length ? await db.select({ partnerId: deals.partnerId, stage: deals.stage, value: deals.valueEstimate, name: deals.name, id: deals.id, updatedAt: deals.updatedAt })
    .from(deals).where(and(mandateCondition(scope, deals.mandateId), eq(deals.source, "referral"))).orderBy(desc(deals.updatedAt)) : [];
  const list = rows.map(r => {
    const mine = refDeals.filter(d => d.partnerId === r.p.id);
    const won = mine.filter(d => (WON as readonly string[]).includes(d.stage));
    const wonValue = won.reduce((a, d) => a + (d.value ?? 0), 0);
    return {
      ...r.p, orgName: r.orgName, country: r.country,
      referrals: mine.length, won: won.length, lost: mine.filter(d => d.stage === "lost").length,
      open: mine.filter(d => !["lost", "churned", ...WON].includes(d.stage)).length,
      feeOwed: Math.round(wonValue * (TIER_FEE[r.p.tier] ?? 0.1)), deals: mine.slice(0, 5),
    };
  });
  const unlinked = refDeals.filter(d => !d.partnerId).length;
  // Candidates: organizations in channel segments (EPCs, law, Big 4, architects, banks) that are not partners yet.
  const partnerOrgIds = rows.map(r => r.p.orgId).filter((x): x is string => !!x);
  const candidates = await db.select({ id: organizations.id, name: organizations.name, country: organizations.country, segment: segments.name }).from(organizations)
    .innerJoin(segments, eq(segments.id, organizations.segmentId))
    .where(and(mandateCondition(scope, organizations.mandateId), eq(segments.group, "channel"), isNull(organizations.archivedAt),
      partnerOrgIds.length ? notInArray(organizations.id, partnerOrgIds.slice(0, 90)) : undefined))
    .orderBy(asc(organizations.name)).limit(50);
  const byTier = ["standard", "strategic", "institutional"].map(tier => {
    const ps = list.filter(p => p.tier === tier);
    return { tier, partners: ps.length, referrals: ps.reduce((a, p) => a + p.referrals, 0), won: ps.reduce((a, p) => a + p.won, 0), feeOwed: ps.reduce((a, p) => a + p.feeOwed, 0) };
  });
  return { partners: list, byTier, candidates, unlinked };
}

export async function partnerCount(scope: Scope) {
  const [r] = await appDb().select({ n: sql<number>`count(*)` }).from(partners).where(and(mandateCondition(scope, partners.mandateId), inArray(partners.status, ["active"])));
  return r.n;
}
