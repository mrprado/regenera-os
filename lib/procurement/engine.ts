// Procurement engine (docs/plans/phase-6.md M9): packages move through the pipeline, awarding a bid registers the
// agreement (with the E&S flow-down in its summary) and closes the other bids; Today alerts.
import { and, asc, eq, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { bids, contracts, procurementPackages, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { registerContract } from "@/lib/contracts/register";
import { AWARD_CONTRACT, AWARDED_STAGES, PACKAGE_CATEGORIES, type PackageStage } from "./vocab";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Awards a package to one bid: the bid becomes Selected, the others Not selected, the package moves to Awarded and a
 * draft agreement of the matching type is registered against the project with the bidder as counterparty. */
export async function awardBid(db: Db, bidId: string, actor: string, now = new Date()) {
  const [b] = await db.select().from(bids).where(eq(bids.id, bidId));
  if (!b) throw new Error("Bid not found");
  const [pkg] = await db.select().from(procurementPackages).where(eq(procurementPackages.id, b.packageId));
  if (!pkg) throw new Error("Package not found");
  if (pkg.awardedBidId) throw new Error("This package is already awarded");
  if (["invited", "declined", "withdrawn"].includes(b.status)) throw new Error("Only a received bid can be awarded");
  await db.update(bids).set({ status: "selected", updatedAt: now.toISOString() }).where(eq(bids.id, b.id));
  await db.update(bids).set({ status: "not_selected", updatedAt: now.toISOString() })
    .where(and(eq(bids.packageId, pkg.id), ne(bids.id, b.id), notInArray(bids.status, ["declined", "withdrawn"])));
  const map = AWARD_CONTRACT[pkg.category];
  const c = await registerContract(db, {
    mandateId: pkg.mandateId, projectId: pkg.projectId, category: map.category, contractType: map.type,
    title: `${pkg.name}: ${b.bidder}`, currency: b.currency, value: b.price ?? undefined, lifecycle: "draft",
    summary: [
      `Awarded from procurement package "${pkg.name}" (${PACKAGE_CATEGORIES[pkg.category]}).`,
      pkg.scope && `Scope: ${pkg.scope}`,
      b.price !== null && `Price: ${b.currency} ${b.price.toLocaleString("en-US")}`,
      b.scheduleWeeks !== null && `Schedule: ${b.scheduleWeeks} weeks`, b.warrantyYears !== null && `Warranty: ${b.warrantyYears} years`,
      b.liquidatedDamages && `Liquidated damages: ${b.liquidatedDamages}`, b.incoterms && `Incoterms: ${b.incoterms}${b.port ? ` ${b.port}` : ""}`,
      pkg.esRequirements && `E&S requirements to flow down to the contractor: ${pkg.esRequirements}`,
      b.exceptions && `Bid exceptions to resolve: ${b.exceptions}`,
    ].filter(Boolean).join("\n\n"),
    parties: [{ name: b.bidder, role: "counterparty", orgId: b.orgId }],
  }, actor, now);
  await db.update(procurementPackages).set({ awardedBidId: b.id, contractId: c.id, stage: "award", updatedAt: now.toISOString() }).where(eq(procurementPackages.id, pkg.id));
  await audit(db, { actor, action: "bid_awarded", entity: "procurement_packages", entityId: pkg.id, after: { bidId: b.id, bidder: b.bidder, contractId: c.id } });
  return { contractId: c.id };
}

export type ProcurementAlerts = {
  bidsDue: { id: string; projectId: string; project: string; name: string; date: string }[];
  awardLate: { id: string; projectId: string; project: string; name: string; date: string }[];
  leadTime: { id: string; projectId: string; project: string; name: string; why: string }[];
};

/** For Today: bids due within 7 days, award targets passed without an award, and awarded supply whose lead time
 * (from today) lands after the date it is needed on site. */
export async function procurementAlerts(db: Db, mandateIds: string[] | null, now = new Date()): Promise<ProcurementAlerts> {
  const scope = mandateIds ? inArray(projects.mandateId, mandateIds.length ? mandateIds : ["-"]) : sql`1 = 1`;
  const live = and(scope, isNull(projects.archivedAt), notInArray(projects.status, ["dropped"]));
  const today = day(now), in7 = day(new Date(now.getTime() + 7 * 86_400_000));
  const open: PackageStage[] = ["need", "rfi", "rfp", "bids", "clarification", "evaluation", "bafo", "selection", "negotiation"];
  const due = await db.select({ p: procurementPackages, project: projects.name }).from(procurementPackages).innerJoin(projects, eq(projects.id, procurementPackages.projectId))
    .where(and(live, inArray(procurementPackages.stage, ["rfi", "rfp", "clarification", "bafo"]), lte(procurementPackages.bidsDueAt, in7))).orderBy(asc(procurementPackages.bidsDueAt)).limit(20);
  const late = await db.select({ p: procurementPackages, project: projects.name }).from(procurementPackages).innerJoin(projects, eq(projects.id, procurementPackages.projectId))
    .where(and(live, inArray(procurementPackages.stage, open), sql`${procurementPackages.awardTargetAt} < ${today}`)).limit(20);
  const awarded = await db.select({ p: procurementPackages, project: projects.name, lead: bids.leadTimeWeeks }).from(procurementPackages)
    .innerJoin(projects, eq(projects.id, procurementPackages.projectId)).innerJoin(bids, eq(bids.id, procurementPackages.awardedBidId))
    .where(and(live, inArray(procurementPackages.stage, AWARDED_STAGES.filter(s => s !== "delivery" && s !== "closed")))).limit(50);
  return {
    bidsDue: due.filter(x => x.p.bidsDueAt! >= today).map(x => ({ id: x.p.id, projectId: x.p.projectId, project: x.project, name: x.p.name, date: x.p.bidsDueAt! })),
    awardLate: late.map(x => ({ id: x.p.id, projectId: x.p.projectId, project: x.project, name: x.p.name, date: x.p.awardTargetAt! })),
    leadTime: awarded.flatMap(x => {
      if (!x.lead || !x.p.requiredOnSiteAt) return [];
      const arrives = day(new Date(now.getTime() + x.lead * 7 * 86_400_000));
      return arrives > x.p.requiredOnSiteAt ? [{ id: x.p.id, projectId: x.p.projectId, project: x.project, name: x.p.name, why: `${x.lead}-week lead time: arrives about ${arrives}, needed on site ${x.p.requiredOnSiteAt}` }] : [];
    }),
  };
}

/** Keeps the package's contract link honest if the agreement was removed. */
export async function packageContract(db: Db, packageId: string) {
  const [p] = await db.select({ contractId: procurementPackages.contractId }).from(procurementPackages).where(eq(procurementPackages.id, packageId));
  if (!p?.contractId) return null;
  const [c] = await db.select({ id: contracts.id, title: contracts.title, lifecycle: contracts.lifecycle }).from(contracts).where(eq(contracts.id, p.contractId));
  return c ?? null;
}
