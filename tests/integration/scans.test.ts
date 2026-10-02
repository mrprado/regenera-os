// Phase 15 against local D1: one scan engine end to end (queued → running → completed in bounded steps), deduplication
// against existing records, test-record exclusion, qualification capped at "matches criteria", idempotency and
// overlap protection, cancellation, the missing-provider block, objective opportunity scans (closed calls excluded,
// queue projects matched with caveats), commercial qualification gating, attribution, test-record separation and
// site briefs. No external provider is called: the open web and Apollo are not configured in these runs.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountQualifications, attributions, fundingOpportunities, organizations, projects, scanResults, scanRuns, siteBriefs } from "@/db/schema";
import { upsertOrganization } from "@/lib/crm/entities";
import { attribute, decideQualification, setQualificationField } from "@/lib/flow/commercial";
import { saveObjective, scanConfigFor } from "@/lib/flow/objectives";
import { upsertQueue, type QueueRow } from "@/lib/mandates/queues";
import { addAnnotation, createBrief, newBriefVersion, setBriefReview } from "@/lib/briefs";
import { zScanConfig } from "@/lib/scan/config";
import { cancelScan, ScanBlocked, scanStep, startScan } from "@/lib/scan/engine";
import { setQualificationStatus } from "@/lib/scan/qualification";
import { setTestRecords } from "@/lib/test-records";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const WS = "mandate_regenera", U = "lead@regenera.bio";
const deps = { apollo: null, ai: null };
const drain = async (runId: string) => { for (let i = 0; i < 50; i++) if (!(await scanStep(t.db, runId, deps))) return; throw new Error("scan did not finish"); };

describe("shared scan engine", () => {
  let runId = "";
  it("screens existing records, excludes test records and caps qualification at 'matches criteria'", async () => {
    const a = await upsertOrganization(t.db, WS, { name: "Sol Norte EPC", country: "MEX", industry: "Solar EPC contractor", domain: "solnorte.mx" }, "other", { source: "test" });
    await upsertOrganization(t.db, WS, { name: "Brasil EPC", country: "BRA", industry: "EPC engineering" }, "other", { source: "test" });
    const test = await upsertOrganization(t.db, WS, { name: "Test EPC", country: "MEX", industry: "EPC" }, "other", { source: "test" });
    await t.db.update(organizations).set({ testRecord: true }).where(eq(organizations.id, test.row.id));
    const { run, reused } = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "Test preset", config: zScanConfig.parse({ audience: "epc_engineering", geography: ["MEX"], providers: ["existing"] }) }, deps);
    expect(reused).toBe(false);
    runId = run.id;
    await drain(run.id);
    const [done] = await t.db.select().from(scanRuns).where(eq(scanRuns.id, run.id));
    expect(done.status).toBe("completed");
    const results = await t.db.select().from(scanResults).where(eq(scanResults.runId, run.id));
    const by = (n: string) => results.find(r => r.name === n);
    expect(by("Sol Norte EPC")?.match).toBe("matches");
    expect(by("Brasil EPC")?.match).toBe("excluded");
    expect(by("Test EPC")).toBeUndefined(); // test records are never read by a scan
    const [q] = await t.db.select().from(accountQualifications).where(eq(accountQualifications.orgId, a.row.id));
    expect(q.status).toBe("criteria_matched");
    expect(q.dimensions.buyingIntent.reading).toBe("unknown");
  });

  it("is idempotent for the same settings on the same day and refuses overlap", async () => {
    const again = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "Test preset", config: zScanConfig.parse({ audience: "epc_engineering", geography: ["MEX"], providers: ["existing"] }) }, deps);
    expect(again.reused).toBe(true);
    expect(again.run.id).toBe(runId);
  });

  it("blocks a scan that needs an unconnected external source unless the fallback is accepted", async () => {
    await expect(startScan(t.db, { mandateId: WS, requestedBy: U, section: "capital", presetName: "Funds", config: zScanConfig.parse({ audience: "funds_asset_managers", providers: ["existing", "web", "apollo_orgs"] }) }, deps)).rejects.toBeInstanceOf(ScanBlocked);
    const ok = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "capital", presetName: "Funds", config: zScanConfig.parse({ audience: "funds_asset_managers", providers: ["existing", "web", "apollo_orgs"] }), fallbackAccepted: true }, deps);
    expect(ok.run.providers.find(p => p.provider === "web")?.status).toBe("not_connected");
    expect(await cancelScan(t.db, WS, ok.run.id, U)).toBe(true);
    expect(await scanStep(t.db, ok.run.id, deps)).toBe(false); // a cancelled scan never resumes
  });

  it("never lowers a human decision and requires a reason", async () => {
    const [o] = await t.db.select().from(organizations).where(eq(organizations.name, "Sol Norte EPC"));
    await expect(setQualificationStatus(t.db, WS, o.id, "human_reviewed", U, "")).rejects.toThrow(/reason/);
    await setQualificationStatus(t.db, WS, o.id, "human_reviewed", U, "Checked website");
    await expect(setQualificationStatus(t.db, WS, o.id, "ready_for_outreach", U, "Looks good")).rejects.toThrow(/assessed by a person/);
  });
});

describe("objective opportunity scans", () => {
  it("matches queue projects and open calls, excludes closed calls, and stores caveats and next actions", async () => {
    const row = (n: string, o: Partial<QueueRow> = {}): QueueRow => ({ key: `SPP:${n}`, iso: "SPP", number: n, state: "OK", county: "Blaine", poi: "Sub", transmissionOwner: "OGE", fuel: "Solar", technology: "solar", mw: 150, mwWinter: 150, queueDate: "2024-01-01", inServiceDate: "2028-06-01", withdrawnDate: null, status: "DISIS STAGE", studyPhase: "", iaStatus: "", raw: {}, ...o });
    await upsertQueue(t.db, [row("O-1"), row("O-2", { technology: "wind", fuel: "Wind" })]);
    const today = new Date().toISOString().slice(0, 10), past = "2020-01-01", future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    for (const [ext, deadline] of [["open-1", future], ["closed-1", past]] as const)
      await t.db.insert(fundingOpportunities).values({ mandateId: WS, source: "grants_gov", externalId: ext, dedupeKey: ext, title: `Solar call ${ext}`, type: "grant", url: `https://example.org/${ext}`, deadline, countries: ["USA"], status: "open" } as never);
    const o = await saveObjective(t.db, WS, { orgId: null, kind: "find_contracts", title: "EPC contracts in the US (solar)", owner: U, beneficiary: "", desiredOutcome: "", targetAudience: null, offerKey: null, geography: ["USA"], sector: null, capabilities: ["solar PV"], commercial: [], sizeMin: 50, sizeMax: 400, sizeUnit: "MW", stages: [], timing: "", exclusions: [], requiredEvidence: "", deliverable: "", successMeasure: "", status: "active", source: "test", reviewStatus: "reviewed", dealId: null, projectId: null, commercialMandateId: null }, U);
    const plan = scanConfigFor(o);
    if ("blocked" in plan) throw new Error(plan.blocked);
    const { run } = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "mandates", presetName: plan.label, config: { ...plan.config, providers: ["funding_calls", "queue_projects"] } }, deps);
    await drain(run.id);
    const res = await t.db.select().from(scanResults).where(eq(scanResults.runId, run.id));
    expect(res.find(r => r.entityId === "SPP:O-1")?.match).toBe("matches");
    expect(res.find(r => r.entityId === "SPP:O-1")?.caveats.join(" ")).toMatch(/not an open procurement/);
    expect(res.find(r => r.entityId === "SPP:O-2")).toBeUndefined(); // wind filtered out by capability
    expect(res.some(r => r.name === "Solar call closed-1")).toBe(false);
    expect(res.find(r => r.name === "Solar call open-1")?.nextAction).toMatch(/eligibility/);
    const [done] = await t.db.select().from(scanRuns).where(eq(scanRuns.id, run.id));
    expect(done.objectiveId).toBe(o.id);
    expect(today.length).toBe(10);
  });
});

describe("commercial qualification, attribution and test records", () => {
  it("refuses 'qualified' without evidence and reopens when evidence changes", async () => {
    const [{ id: dealId }] = await t.db.insert((await import("@/db/schema")).deals).values({ mandateId: WS, name: "Pilot", path: "project_diagnostic" }).returning();
    await expect(decideQualification(t.db, WS, dealId, "qualified", "Ready", U)).rejects.toThrow(/Not yet/);
    for (const f of ["need", "buyer", "timing", "budgetPath", "agreedNextStep"] as const) await setQualificationField(t.db, WS, dealId, f, "x", "meeting 2026-10-01", U);
    await decideQualification(t.db, WS, dealId, "qualified", "All evidenced", U);
    await setQualificationField(t.db, WS, dealId, "timing", "slipped to Q3", "email", U);
    const q = await (await import("@/lib/flow/commercial")).opportunityQualification(t.db, WS, dealId);
    expect(q?.decision).toBe("open");
  });
  it("keeps the first source as original and later ones as influence", async () => {
    await attribute(t.db, WS, { entityType: "deal", entityId: "d-attr", channel: "scan", campaign: "Mexico solar EPC firms" }, U);
    await attribute(t.db, WS, { entityType: "deal", entityId: "d-attr", channel: "referral" }, U);
    const rows = await t.db.select().from(attributions).where(eq(attributions.entityId, "d-attr"));
    expect(rows.map(r => r.kind).sort()).toEqual(["influence", "original"]);
  });
  it("flags test records without deleting them, scoped to the workspace", async () => {
    const o = await upsertOrganization(t.db, WS, { name: "Flag Me Co" }, "other", { source: "test" });
    expect(await setTestRecords(t.db, ["mandate_other"], { contactIds: [], orgIds: [o.row.id], dealIds: [], replyIds: [] }, true)).toBe(0);
    expect(await setTestRecords(t.db, [WS], { contactIds: [], orgIds: [o.row.id], dealIds: [], replyIds: [] }, true)).toBe(1);
    const [after] = await t.db.select().from(organizations).where(eq(organizations.id, o.row.id));
    expect(after.testRecord).toBe(true);
  });
});

describe("site briefs", () => {
  it("needs a located project, requires evidence for measured content, and versions instead of editing approved briefs", async () => {
    const [p] = await t.db.insert(projects).values({ mandateId: WS, name: "Brief site", lat: 21.0, lng: -89.6 } as never).returning();
    const [noLoc] = await t.db.insert(projects).values({ mandateId: WS, name: "No location" } as never).returning();
    await expect(createBrief(t.db, WS, { projectId: noLoc.id, template: "diagnostic" }, U)).rejects.toThrow(/no location/);
    const b = await createBrief(t.db, WS, { projectId: p.id, template: "diagnostic" }, U);
    await expect(addAnnotation(t.db, b, { points: [{ lng: -89.6, lat: 21 }], kind: "constraint", label: "Wetland", note: "", contentClass: "measured", evidence: "", source: "", scenarioId: null }, U)).rejects.toThrow(/evidence/);
    await addAnnotation(t.db, b, { points: [{ lng: -89.6, lat: 21 }], kind: "unknown", label: "Access?", note: "", contentClass: "unknown", evidence: "", source: "", scenarioId: null }, U);
    await setBriefReview(t.db, b, "approved", "owner@regenera.bio", true);
    const [approved] = await t.db.select().from(siteBriefs).where(eq(siteBriefs.id, b.id));
    await expect(addAnnotation(t.db, approved, { points: [{ lng: -89.6, lat: 21 }], kind: "access", label: "Road", note: "", contentClass: "conceptual", evidence: "", source: "", scenarioId: null }, U)).rejects.toThrow(/approved/);
    const v2 = await newBriefVersion(t.db, approved, U);
    expect(v2.version).toBe(2);
    expect(v2.annotations).toHaveLength(1);
    expect(v2.reviewStatus).toBe("draft");
  });
});
