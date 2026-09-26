import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimEvidence, claims, decisions, jobs, mandates, organizations, placeFacts, playbookCorrections, playbookRuns, playbooks, playbookVersions, projectParties, projects } from "@/db/schema";
import { addClaim, addEvidence, claimsAsOf, setClaimStatus, supersedeClaim } from "@/lib/evidence/engine";
import { approveRun, ensurePlaybooks, promoteVersion, recordCorrection, repeatedCorrections, runStepTool, setStep, startRun, verifyRun } from "@/lib/playbooks/engine";
import { createProject, setReadiness } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera";
const NOW = new Date("2026-09-26T12:00:00Z");

beforeEach(async () => {
  for (const x of [claimEvidence, claims, playbookCorrections, playbookRuns, playbookVersions, playbooks, jobs, placeFacts, decisions, projectParties, projects, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});
const pb = async (key: string) => (await t.db.select().from(playbooks).where(eq(playbooks.key, key)))[0];

describe("playbook engine", () => {
  it("seeds the 20-playbook library once, as approved version 1", async () => {
    expect(await ensurePlaybooks(t.db, M)).toBe(20);
    expect(await ensurePlaybooks(t.db, M)).toBe(0);
    expect((await t.db.select().from(playbookVersions)).every(v => v.status === "approved" && v.version === 1)).toBe(true);
  });

  it("site intelligence: the autonomous tool completes its step; definition of done is checked against records", async () => {
    await ensurePlaybooks(t.db, M);
    const p = await createProject(t.db, { mandateId: M, name: "Valle", lat: 20.9, lng: -89.6, assetClass: "solar", stage: "screening" }, "alan");
    const run = await startRun(t.db, (await pb("site-intelligence")).id, p.id, "alan");
    const tool = await runStepTool(t.db, run.id, "place", "alan", NOW);
    expect(tool).toMatchObject({ ok: true, done: true });
    expect((await t.db.select().from(jobs)).map(j => j.type)).toContain("place.profile");
    const review = await runStepTool(t.db, run.id, "studies", "alan", NOW);
    expect(review.note).toMatch(/Missing: .*Topography/);
    await setStep(t.db, run.id, "read", "done", "No blocking facts", "alan");
    await setStep(t.db, run.id, "unknowns", "done", "", "alan");
    let v = await verifyRun(t.db, run.id, [], "alan", NOW);
    expect(v.status).toBe("needs_review");
    expect(v.checks.find(c => c.id === "p2")).toMatchObject({ pass: false, detail: "0 place facts (need 5)" });
    await t.db.insert(placeFacts).values(Array.from({ length: 5 }, (_, i) => ({ projectId: p.id, mandateId: M, dimension: "climate", key: `k${i}`, label: `L${i}`, value: "1", integrationKey: "nasa_power", tier: 2, retrievedAt: NOW.toISOString() })) as never);
    v = await verifyRun(t.db, run.id, [], "alan", NOW);
    expect(v.status).toBe("completed");
  });

  it("approval steps need approveRun after verification; manual proof needs a person", async () => {
    await ensurePlaybooks(t.db, M);
    const p = await createProject(t.db, { mandateId: M, name: "Q" }, "alan");
    const run = await startRun(t.db, (await pb("project-qualification")).id, p.id, "alan");
    await expect(setStep(t.db, run.id, "decide", "done", "", "alan")).rejects.toThrow(/approving the run/);
    for (const d of ["land", "grid", "permitting", "technical", "commercial", "financial"] as const) await setReadiness(t.db, p.id, d, { status: "early", evidence: "x" }, "alan");
    await t.db.insert(decisions).values({ projectId: p.id, mandateId: M, title: "Qualify", status: "decided" });
    for (const s of ["readiness", "constraints", "summary"]) await setStep(t.db, run.id, s, "done", "", "alan");
    await expect(approveRun(t.db, run.id, "alan")).rejects.toThrow(/awaiting approval/);
    expect((await verifyRun(t.db, run.id, [], "alan", NOW)).status).toBe("awaiting_approval");
    await approveRun(t.db, run.id, "alan", NOW);
    const [done] = await t.db.select().from(playbookRuns);
    expect(done).toMatchObject({ status: "completed", approvedBy: "alan" });
    expect(done.steps.find(s => s.key === "decide")).toMatchObject({ status: "done", by: "alan" });
  });

  it("corrections: one-time recorded; a rule becomes a draft version that only takes effect when promoted; repeats are surfaced", async () => {
    await ensurePlaybooks(t.db, M);
    const b = await pb("site-intelligence");
    await recordCorrection(t.db, { playbookId: b.id, layer: "process", scope: "one_time", description: "Forgot to check the flood zone map", change: "" }, "alan");
    const second = await recordCorrection(t.db, { playbookId: b.id, layer: "process", scope: "one_time", description: "forgot to check flood zone map!", change: "" }, "alan");
    expect(second.repeated).toBe(true);
    expect((await repeatedCorrections(t.db, b.id))[0]).toMatchObject({ n: 2 });
    const rule = await recordCorrection(t.db, { playbookId: b.id, layer: "process", scope: "process_rule", description: "Flood zone missed", change: "Always check the national flood zone map before recording site constraints." }, "alan");
    expect(rule.proposedVersion).toBe(2);
    expect((await pb("site-intelligence")).currentVersion).toBe(1);
    await promoteVersion(t.db, b.id, 2, "alan", NOW);
    expect((await pb("site-intelligence")).currentVersion).toBe(2);
    const vs = await t.db.select().from(playbookVersions).where(eq(playbookVersions.playbookId, b.id));
    expect(vs.find(v => v.version === 1)?.status).toBe("superseded");
    expect(vs.find(v => v.version === 2)?.definition.rules.at(-1)?.text).toMatch(/flood zone/);
    await expect(promoteVersion(t.db, b.id, 2, "alan")).rejects.toThrow(/draft/);
  });
});

describe("claims and evidence", () => {
  it("AI inference cannot become Verified without non-AI evidence and a person; history is kept", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
    const c = await addClaim(t.db, { mandateId: M, entityType: "project", entityId: p.id, statement: "Site has land control", field: "land_control", status: "ai_inferred", createdBy: "ai:ask" }, "ai:ask");
    await addEvidence(t.db, c.id, { method: "ai", excerpt: "Model read the teaser" }, "ai:ask");
    await expect(setClaimStatus(t.db, c.id, "verified", "alan")).rejects.toThrow(/not AI output/);
    await addEvidence(t.db, c.id, { method: "registry", provider: "Registro Público de la Propiedad", sourceUrl: "https://example.test/folio/123", sourceDate: "2026-09-01" }, "alan");
    await expect(setClaimStatus(t.db, c.id, "verified", "ai:ask")).rejects.toThrow(/Only a person/);
    await setClaimStatus(t.db, c.id, "verified", "alan", NOW);
    expect((await t.db.select().from(claims))[0]).toMatchObject({ status: "verified", verifiedBy: "alan" });
    const cap = await addClaim(t.db, { mandateId: M, entityType: "project", entityId: p.id, statement: "Capacity 40 MW", value: "40", unit: "MW", validFrom: "2026-01-01", status: "source_provided", createdBy: "alan" }, "alan");
    await supersedeClaim(t.db, cap.id, { statement: "Capacity 55 MW", value: "55", validFrom: "2026-09-01" }, "alan");
    expect((await claimsAsOf(t.db, "project", p.id, "2026-06-01")).map(x => x.value)).toContain("40");
    expect((await claimsAsOf(t.db, "project", p.id, "2026-09-15")).map(x => x.value)).toContain("55");
    expect((await claimsAsOf(t.db, "project", p.id, "2026-09-15")).map(x => x.value)).not.toContain("40");
  });
});
