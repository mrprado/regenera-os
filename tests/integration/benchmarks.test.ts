// Benchmarks: FX + CPI normalisation with provenance notes, exclusion of unknown currency / year, percentile and
// material-deviation questions, and contradiction detection across project, model and EPC sources.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { costBenchmarks, finModels, mandates, projects, sourceCache } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compareValue, contradictions, normalise, percentile } from "@/lib/benchmarks/engine";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [costBenchmarks, finModels, projects, sourceCache, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

const fake: typeof fetch = async input => {
  const url = String(input);
  if (url.includes("frankfurter")) return new Response(JSON.stringify({ rates: { USD: url.includes("base=EUR") ? 1.1 : 0.05 } }), { status: 200 });
  if (url.includes("FP.CPI.TOTL")) return new Response(JSON.stringify([{}, [{ date: "2020", value: 100 }, { date: "2024", value: 120 }]]), { status: 200 });
  return new Response("{}", { status: 404 });
};
const bench = (o: Partial<typeof costBenchmarks.$inferInsert>) => ({ mandateId: M, technology: "solar", metric: "capex_per_mwac", value: 1_000_000, currency: "USD", baseYear: 2024, source: "test", createdBy: "t", ...o });

describe("normalisation", () => {
  it("converts currency at the base year and inflates with US CPI; excludes unknowns with a reason", async () => {
    await t.db.insert(costBenchmarks).values([bench({ currency: "EUR", baseYear: 2020, value: 1_000_000 }), bench({ currency: null }), bench({ baseYear: null })]);
    const n = await normalise(t.db, await t.db.select().from(costBenchmarks), 2024, fake);
    const eur = n.find(x => x.b.currency === "EUR")!;
    expect(eur.usd).toBeCloseTo(1_000_000 * 1.1 * 1.2, 2);
    expect(eur.notes.join(" ")).toMatch(/EUR→USD.*ECB/);
    expect(n.find(x => x.b.currency === null)!.notes[0]).toMatch(/Currency unknown/);
    expect(n.filter(x => x.usd === null)).toHaveLength(2);
  });
});

describe("comparison", () => {
  it("places the project in the distribution and asks why when materially above", async () => {
    expect(percentile([1, 2, 3, 4], 3)).toBe(63);
    await t.db.insert(costBenchmarks).values([0.9, 1.0, 1.05, 1.1, 1.2].map(v => bench({ value: v * 1_000_000, country: "MEX" })));
    const c = await compareValue(t.db, [M], { technology: "solar", metric: "capex_per_mwac", value: 1_550_000, currency: "USD", year: 2024, country: "MEX" }, fake);
    expect(c.flag).toBe("material_above");
    expect(c.question).toMatch(/Ask why/);
    expect(c.sets.find(s => s.name.startsWith("Local"))!.n).toBe(5);
    const w = await compareValue(t.db, [M], { technology: "solar", metric: "capex_per_mwac", value: 1_040_000, currency: "USD", year: 2024 }, fake);
    expect(w.flag).toBe("within");
    const few = await compareValue(t.db, [M], { technology: "wind", metric: "capex_per_mwac", value: 1, currency: "USD", year: 2024 }, fake);
    expect(few.flag).toBe("insufficient");
  });
});

describe("contradictions", () => {
  it("lists every source and flags a material CAPEX conflict without resolving it", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
    await t.db.update(projects).set({ capex: 120_000_000, currency: "USD", capacity: 100, capacityUnit: "MW" }).where(eq(projects.id, p.id));
    await t.db.insert(finModels).values({ mandateId: M, projectId: p.id, name: "Base", definition: { currency: "USD", generation: { capacityMw: 100 } } as never, summary: { capex: 131_000_000 } });
    const c = await contradictions(t.db, p.id);
    const capex = c.find(x => x.fact === "CAPEX")!;
    expect(capex.values.map(v => v.source)).toEqual(["Project record", "Financial model Base v1"]);
    expect(capex.material).toBe(false); // 9.2% < 10%
    await t.db.update(projects).set({ capex: 110_000_000 }).where(eq(projects.id, p.id));
    const c2 = (await contradictions(t.db, p.id)).find(x => x.fact === "CAPEX")!;
    expect(c2.material).toBe(true);
    expect(c2.note).toMatch(/MATERIAL DATA CONFLICT/);
    expect((await contradictions(t.db, p.id)).find(x => x.fact === "Capacity (MW)")!.material).toBe(false);
  });
});
