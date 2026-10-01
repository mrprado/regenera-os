// Data providers against local D1 (WRI prompt §2, §11, §18, §24–25): the registry mirrors the catalogue; a sync
// resolves a Resource Watch dataset with a real (faked) HTTP exchange and records the job; a failed call stays
// failed; GFW without a key is "skipped", never connected; screening flags come from a run's sourced facts.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { datasets, datasetSyncJobs, mandates, projectDatasetLinks, projectScreeningFlags, projects, siteIntelRuns, sourceCache, providerCalls } from "@/db/schema";
import { ensureDataRegistry, providerHealth, syncDataset } from "@/lib/data-providers/engine";
import { refreshScreening } from "@/lib/data-providers/site";
import { DATASETS } from "@/lib/data-providers/catalog";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera", U = "analyst@regenera.bio";

beforeEach(async () => {
  for (const x of [datasetSyncJobs, datasets, projectScreeningFlags, projectDatasetLinks, siteIntelRuns, projects, sourceCache, providerCalls, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

const rw = (async (url: string) => {
  if (String(url).includes("/dataset?")) return Response.json({ data: [{ id: "rw-123", attributes: { name: "Aqueduct Baseline Water Stress", provider: "cartodb", connectorType: "rest", tableName: "wat_050_aqueduct", dataLastUpdated: "2023-08-01T00:00:00Z" } }] });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

describe("registry and sync", () => {
  it("mirrors the catalogue and records a successful resolve", async () => {
    expect(await ensureDataRegistry(t.db)).toBe(DATASETS.length);
    const before = (await providerHealth(t.db, {})).find(h => h.p.key === "wri")!;
    expect(before.connected).toBe(0);
    const r = await syncDataset(t.db, "wri.aqueduct.baseline_water_stress", {}, U, rw);
    expect(r.ok).toBe(true);
    const [row] = await t.db.select().from(datasets).where(eq(datasets.id, "wri.aqueduct.baseline_water_stress"));
    expect(row).toMatchObject({ connection: "connected", failures: 0 });
    expect(JSON.parse(row.resolvedRef!).id).toBe("rw-123");
    expect((await providerHealth(t.db, {})).find(h => h.p.key === "wri")!.connected).toBe(1);
    expect((await t.db.select().from(datasetSyncJobs))[0].status).toBe("ok");
  });

  it("GFW without a key is skipped and never shown as connected", async () => {
    await ensureDataRegistry(t.db);
    const meta = (async () => Response.json({ data: { dataset: "umd_tree_cover_loss", metadata: {} } })) as unknown as typeof fetch;
    const r = await syncDataset(t.db, "wri.gfw.tree_cover_loss", {}, U, meta);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/GFW_API_KEY/);
    const [row] = await t.db.select().from(datasets).where(eq(datasets.id, "wri.gfw.tree_cover_loss"));
    expect(row.connection).not.toBe("connected");
  });

  it("a failed search is recorded as a failure", async () => {
    await ensureDataRegistry(t.db);
    const none = (async () => Response.json({ data: [] })) as unknown as typeof fetch;
    const r = await syncDataset(t.db, "wri.aqueduct.drought_risk", {}, U, none);
    expect(r.ok).toBe(false);
    const [row] = await t.db.select().from(datasets).where(eq(datasets.id, "wri.aqueduct.drought_risk"));
    expect(row.failures).toBe(1);
  });
});

describe("project screening", () => {
  it("links default WRI datasets on creation and turns sourced facts into flags", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", country: "Mexico", lat: 20.9, lng: -89.6 }, U);
    expect((await t.db.select().from(projectDatasetLinks)).map(l => l.datasetId)).toContain("wri.aqueduct.baseline_water_stress");
    await t.db.insert(siteIntelRuns).values({ mandateId: M, projectId: p.id, status: "complete", startedBy: U, stages: [
      { key: "water", status: "done", facts: [{ label: "Baseline water stress (Aqueduct 4.0)", value: "Extremely high (>80%)", source: "WRI", datasetId: "wri.aqueduct.baseline_water_stress", data: { indicator: "bws", category: 4 } }] },
      { key: "grid", status: "done", facts: [{ label: "Transmission line", value: "None mapped within 25.0 km", source: "OSM" }] },
    ] });
    expect((await refreshScreening(t.db, p.id, U)).flags).toBe(2);
    const flags = await t.db.select().from(projectScreeningFlags);
    expect(flags.map(f => f.flag).sort()).toEqual(["grid_gap", "water_stress"]);
    expect(flags.find(f => f.flag === "water_stress")!.diligence).toMatch(/hydrological/);
  });
});
