// Phase 16 against local D1: new-prospect discovery is reached even when the workspace already holds many matching records
// (re-screening has its own allowance), external results are counted as new only when they create a record, repeat runs
// dedupe, a fresh run is explicit, unrelated presets never share a run, and mode/provider mismatches are refused. GLEIF is
// the external source here, served by a mocked fetch; nothing leaves the machine.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organizations, scanResults, scanRuns } from "@/db/schema";
import { upsertOrganization } from "@/lib/crm/entities";
import { zScanConfig } from "@/lib/scan/config";
import { ScanBlocked, scanStep, startScan } from "@/lib/scan/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const WS = "mandate_regenera", U = "lead@regenera.bio";

const lei = (n: number) => `5299000000000000N${String(n).padStart(3, "0")}`;
const gleifRecord = (n: number) => ({ id: lei(n), attributes: { lei: lei(n), entity: { legalName: { name: `Nueva Energía EPC ${n} SA de CV` }, jurisdiction: "MX", headquartersAddress: { city: "Monterrey", country: "MX" } }, registration: { status: "ISSUED", lastUpdateDate: "2026-09-01" } } });
let gleifCalls = 0;
const fetchImpl = (async () => { gleifCalls++; return new Response(JSON.stringify({ data: [1, 2, 3, 4].map(gleifRecord) }), { status: 200, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
const deps = { apollo: null, ai: null, fetchImpl };
const drain = async (runId: string) => { for (let i = 0; i < 200; i++) if (!(await scanStep(t.db, runId, deps))) return; throw new Error("scan did not finish"); };
const cfg = (o: Record<string, unknown> = {}) => zScanConfig.parse({ audience: "epc_engineering", geography: ["MEX"], providers: ["existing", "gleif"], maxOrganizations: 3, ...o });

describe("new-prospect discovery versus workspace re-screen", () => {
  it("reaches external discovery although ten matching records already fill the allowance", async () => {
    for (let i = 1; i <= 10; i++) await upsertOrganization(t.db, WS, { name: `Existing Solar EPC ${i}`, country: "MEX", industry: "Solar EPC contractor", domain: `existing-epc-${i}.mx` }, "other", { source: "test" });
    const before = (await t.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.mandateId, WS))).length;
    const { run } = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "MX EPC discovery", config: cfg() }, deps);
    await drain(run.id);
    const [done] = await t.db.select().from(scanRuns).where(eq(scanRuns.id, run.id));
    expect(done.status).toBe("completed");
    expect(gleifCalls).toBeGreaterThan(0);                       // the external source ran
    expect(done.counts.rescreened).toBe(3);                      // re-screen bounded separately
    expect(done.counts.new).toBe(3);                             // allowance used by genuinely new entities
    const gleif = done.providers.find(p => p.provider === "gleif")!;
    expect(gleif.status).toBe("ok");
    expect(gleif.created).toBe(3);
    expect(gleif.raw).toBeGreaterThanOrEqual(3);
    const existing = done.providers.find(p => p.provider === "existing")!;
    expect(existing.created ?? 0).toBe(0);                       // re-screening never creates or counts as new
    const after = (await t.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.mandateId, WS))).length;
    expect(after - before).toBe(3);
    const results = await t.db.select().from(scanResults).where(eq(scanResults.runId, run.id));
    expect(results.filter(r => r.provider === "gleif" && r.outcome === "new")).toHaveLength(3);
  });

  it("returns the same run for the same settings today, and a fresh run dedupes against what it found", async () => {
    const again = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "MX EPC discovery", config: cfg() }, deps);
    expect(again.reused).toBe(true);
    const fresh = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "MX EPC discovery", config: cfg(), fresh: true }, deps);
    expect(fresh.reused).toBe(false);
    expect(fresh.run.id).not.toBe(again.run.id);
    await drain(fresh.run.id);
    const [done] = await t.db.select().from(scanRuns).where(eq(scanRuns.id, fresh.run.id));
    // The first three LEIs resolve to the records created before; only the fourth is new. No duplicates are created.
    expect(done.counts.existing).toBeGreaterThanOrEqual(2);
    expect(done.counts.new).toBeLessThanOrEqual(1);
    const names = (await t.db.select({ n: organizations.name }).from(organizations).where(eq(organizations.mandateId, WS))).map(r => r.n).filter(n => n.startsWith("Nueva Energía"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("never lets an unrelated preset share an active run", async () => {
    const a = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "A", config: cfg({ terms: ["solar"], maxOrganizations: 5 }) }, deps);
    const b = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "B", config: cfg({ terms: ["storage"], maxOrganizations: 5 }) }, deps);
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(false);
    expect(b.run.id).not.toBe(a.run.id);
    const a2 = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "prospecting", presetName: "A", config: cfg({ terms: ["solar"], maxOrganizations: 5 }) }, deps);
    expect(a2.run.id).toBe(a.run.id);                            // the equivalent request reuses
    await drain(a.run.id); await drain(b.run.id);
  });

  it("refuses an opportunity scan with organization sources instead of silently running organization discovery", async () => {
    await expect(startScan(t.db, { mandateId: WS, requestedBy: U, section: "projects", presetName: "Tenders", config: zScanConfig.parse({ mode: "opportunities", audience: "objective", capabilities: ["solar PV"], providers: ["gleif", "funding_calls"] }) }, deps))
      .rejects.toBeInstanceOf(ScanBlocked);
  });

  it("reports a source that made no calls as skipped, never as a success", async () => {
    // Open web counts as usable when Claude is configured, but GLEIF uses the allowance of 1 first, so web never makes a call.
    const aiDeps = { ...deps, ai: { apiKey: "test-only", model: "m", fastModel: "m" } as never };
    const { run } = await startScan(t.db, { mandateId: WS, requestedBy: U, section: "organizations", presetName: "Skip check", config: cfg({ providers: ["gleif", "web"], maxOrganizations: 1 }) }, aiDeps);
    for (let i = 0; i < 200; i++) if (!(await scanStep(t.db, run.id, aiDeps))) break;
    const [done] = await t.db.select().from(scanRuns).where(eq(scanRuns.id, run.id));
    const web = done.providers.find(p => p.provider === "web")!;
    expect(web.calls ?? 0).toBe(0);
    expect(web.status).toBe("skipped");
    expect(web.detail).toMatch(/allowance/i);
    expect(done.providers.find(p => p.provider === "gleif")!.status).toBe("ok");
  });
});
