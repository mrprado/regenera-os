import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mandates, permits, projectReadiness, projects, projectStageHistory, regulatoryReviews, requirements } from "@/db/schema";
import { createProject } from "@/lib/projects/engine";
import { expirePermits, recordReview, regulatoryAlerts, seedChecklist, setRequirementStatus, updatePermit } from "@/lib/regulatory/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const NOW = new Date("2026-09-24T12:00:00Z");
let projectId = "";

beforeEach(async () => {
  for (const x of [regulatoryReviews, permits, requirements, projectReadiness, projectStageHistory, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: OTHER, slug: "other", name: "Other", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
  ]);
  projectId = (await createProject(t.db, { mandateId: M, name: "Valle Solar" }, "alan")).id;
});

describe("regulatory engine", () => {
  it("seeds lender standards on their own track, once", async () => {
    expect(await seedChecklist(t.db, projectId, "ifc_ps", "alan")).toBe(8);
    expect(await seedChecklist(t.db, projectId, "ifc_ps", "alan")).toBe(0);
    expect(await seedChecklist(t.db, projectId, "wb_esf", "alan")).toBe(10);
    const rows = await t.db.select().from(requirements);
    expect(new Set(rows.map(r => r.track))).toEqual(new Set(["lender_standard"]));
    expect(new Set(rows.map(r => r.status))).toEqual(new Set(["unknown"]));
  });

  it("approved and not-applicable need evidence and a reviewer", async () => {
    const [r] = await t.db.insert(requirements).values({ projectId, mandateId: M, domain: "environmental", title: "Environmental impact authorization" }).returning();
    await expect(setRequirementStatus(t.db, r.id, { status: "approved" }, "alan")).rejects.toThrow("evidence");
    await setRequirementStatus(t.db, r.id, { status: "counsel_review" }, "alan");
    await setRequirementStatus(t.db, r.id, { status: "approved", evidence: "Resolution SGPA/123/2026", reviewer: "Ana Ruiz, environmental counsel", nextVerification: "2027-09-01" }, "alan", NOW);
    expect((await t.db.select().from(requirements))[0]).toMatchObject({ status: "approved", reviewer: "Ana Ruiz, environmental counsel", nextVerification: "2027-09-01" });
  });

  it("reviews record reviewer, role and evidence; conditional conclusions need their conditions", async () => {
    const base = { mandateId: M, subjectType: "project" as const, subjectId: projectId, topic: "permitting" as const, reviewedAt: "2026-09-20" };
    await expect(recordReview(t.db, { ...base, conclusion: "permitted", reviewer: "", reviewerRole: "counsel", evidence: "memo" }, "alan")).rejects.toThrow("reviewer");
    await expect(recordReview(t.db, { ...base, conclusion: "permitted_with_conditions", reviewer: "Jo", reviewerRole: "counsel", evidence: "memo" }, "alan")).rejects.toThrow("conditions");
    const r = await recordReview(t.db, { ...base, conclusion: "permitted_with_conditions", conditions: "Grid study before NTP", reviewer: "Jo", reviewerRole: "external counsel", evidence: "Memo 2026-09-20" }, "alan");
    expect(r).toMatchObject({ recordedBy: "alan", conclusion: "permitted_with_conditions" });
  });

  it("alerts on permits expiring or expired, verifications due and counsel reviews, within the entity; expired permits are marked", async () => {
    const other = await createProject(t.db, { mandateId: OTHER, name: "Hidden" }, "alan");
    const [soon] = await t.db.insert(permits).values({ projectId, mandateId: M, name: "Generation permit", status: "approved", approvedAt: "2021-01-01", expiresAt: "2026-11-30" }).returning();
    const [past] = await t.db.insert(permits).values({ projectId, mandateId: M, name: "Water concession", status: "approved", approvedAt: "2016-01-01", expiresAt: "2026-09-01" }).returning();
    await t.db.insert(permits).values([
      { projectId, mandateId: M, name: "Far", status: "approved", approvedAt: "2025-01-01", expiresAt: "2030-01-01" },
      { projectId: other.id, mandateId: OTHER, name: "Hidden permit", status: "approved", expiresAt: "2026-10-01" },
    ]);
    await t.db.insert(requirements).values([
      { projectId, mandateId: M, domain: "land", title: "Title search", nextVerification: "2026-09-01" },
      { projectId, mandateId: M, domain: "foreign_investment", title: "Foreign investment filing", status: "counsel_review" },
    ]);
    const a = await regulatoryAlerts(t.db, [M], NOW);
    expect(a.permitsExpiring.map(p => [p.name, p.expired])).toEqual([["Water concession", true], ["Generation permit", false]]);
    expect(a.verificationsDue.map(v => v.title)).toEqual(["Title search"]);
    expect(a.counselReview.map(v => v.title)).toEqual(["Foreign investment filing"]);
    expect(await expirePermits(t.db, NOW)).toBe(1);
    expect((await t.db.select().from(permits).where(eq(permits.id, past.id)))[0].status).toBe("expired");
    await expect(updatePermit(t.db, soon.id, { status: "approved", approvedAt: null }, "alan")).resolves.toBeUndefined(); // keeps the existing approval date
  });
});
