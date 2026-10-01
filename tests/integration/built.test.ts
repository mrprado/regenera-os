// Built environment (§24, §26, §30) against local D1: the DEMO sample has the required breadth and is all DEMO; a
// project gets a solution stack; a company matches projects; a partnership becomes a deal with an outreach task; a
// recommendation opens an RFI with invited suppliers; search finds companies, technologies and materials but never
// governed knowledge; removing the demo removes everything.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beCompanyProfiles, beKnowledge, beMatches, beMaterials, beSignals, beSystems, beTechnologies, bids, deals, mandates, organizations, procurementPackages, tasks } from "@/db/schema";
import { removeDemo, seedDemo, DEMO_MANDATE } from "@/lib/demo/seed";
import { createPartnership, projectsForCompany, rfiFromMatch } from "@/lib/built/engine";
import { builtSearch } from "@/lib/built/search";
import { globalSearch } from "@/lib/search";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); await removeDemo(t.db); });
afterAll(async () => { await t?.dispose(); });
const U = "owner@regenera.bio";
const scope = { kind: "user" as const, email: U, mandateIds: [DEMO_MANDATE], ownerOf: [DEMO_MANDATE], roles: { [DEMO_MANDATE]: "owner" } } as never;

describe("built environment demo", () => {
  it("seeds a realistic, fully labelled DEMO register and runs project fit", async () => {
    const r = await seedDemo(t.db, U);
    expect(r.created).toBe(true);
    const [cos, techs, mats, syss, sigs, ms, pkgs] = await Promise.all([
      t.db.select().from(beCompanyProfiles), t.db.select().from(beTechnologies), t.db.select().from(beMaterials), t.db.select().from(beSystems), t.db.select().from(beSignals), t.db.select().from(beMatches), t.db.select().from(procurementPackages),
    ]);
    expect(cos.length).toBe(40);
    expect(techs.length).toBeGreaterThanOrEqual(50);
    expect(mats.length).toBe(35);
    expect(syss.length).toBe(20);
    expect(sigs.length).toBe(15);
    expect(new Set(ms.map(m => m.projectId)).size).toBe(4);
    expect(ms.length).toBeGreaterThanOrEqual(10);
    expect(pkgs.filter(p => ["rfi", "rfp"].includes(p.stage)).length).toBe(5);
    expect([...cos, ...techs, ...syss, ...sigs].every(x => x.origin === "demo")).toBe(true);
    const orgs = await t.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.mandateId, DEMO_MANDATE));
    expect(orgs.every(o => o.name.startsWith("DEMO — "))).toBe(true);
    expect(mats.every(m => m.embodiedCarbon === null && m.embodiedCarbonState === "unverified")).toBe(true);
    expect(sigs.every(s => /sample/i.test(s.source) && !s.sourceUrl)).toBe(true);
    const eco = ms.filter(m => m.label === "Cross-ventilation and elevated floors");
    expect(eco.length).toBeGreaterThan(0);
  });

  it("connects company → projects → partnership deal and a recommendation → RFI", async () => {
    const [m] = (await t.db.select().from(beMatches)).filter(x => x.providerOrgIds.length && x.status === "suggested");
    const orgId = m.providerOrgIds[0];
    expect((await projectsForCompany(t.db, orgId)).length).toBeGreaterThan(0);
    const p = await createPartnership(t.db, { mandateId: DEMO_MANDATE, orgId, title: "LATAM market entry", kinds: ["market_entry", "pilot_site"], projectIds: [m.projectId], feeModels: ["retainer", "success"], regeneraAssets: "Demo projects in Mexico" }, U);
    expect(p.opportunity.feeCompliance).toBe("review_required");
    const [deal] = await t.db.select().from(deals).where(eq(deals.id, p.dealId));
    expect(deal).toMatchObject({ path: "partner_network", orgId });
    expect((await t.db.select().from(tasks).where(eq(tasks.dealId, p.dealId))).length).toBe(1);
    const pkg = await rfiFromMatch(t.db, m.id, U);
    expect(pkg.stage).toBe("rfi");
    expect((await t.db.select().from(bids).where(eq(bids.packageId, pkg.id))).map(b => b.status)).toEqual(m.providerOrgIds.map(() => "invited"));
  });

  it("search finds built-environment records and never governed knowledge", async () => {
    expect((await builtSearch(t.db, scope, "low carbon concrete Mexico")).length).toBeGreaterThan(0);
    const exp = await builtSearch(t.db, scope, "companies expanding into Mexico");
    expect(exp.length).toBeGreaterThan(0);
    expect(exp.every(h => h.type === "Built environment company")).toBe(true);
    expect((await builtSearch(t.db, scope, "bamboo")).some(h => h.type === "Material")).toBe(true);
    const [k] = await t.db.select().from(beKnowledge);
    const hits = await globalSearch(t.db, scope, k.title.replace("DEMO — ", "").split(" ").slice(0, 2).join(" "));
    expect(hits.some(h => h.label === k.title)).toBe(false);
  });

  it("removing the demo removes the built-environment sample", async () => {
    await removeDemo(t.db);
    for (const x of [beCompanyProfiles, beTechnologies, beMaterials, beSystems, beSignals, beMatches, beKnowledge]) expect((await t.db.select().from(x)).length).toBe(0);
    expect((await t.db.select().from(mandates).where(eq(mandates.id, DEMO_MANDATE))).length).toBe(0);
  });
});
