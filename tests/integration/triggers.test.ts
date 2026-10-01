import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiRuns, jobs, organizations, signals, triggerQueries, triggers } from "@/db/schema";
import { classifyNewSignals, readSignal, scanDueQueries } from "@/lib/triggers/engine";
import { ensureTriggerQueries } from "@/lib/triggers/queries";
import type { RawSignal } from "@/lib/sources/signals";
import { createTestDb } from "../helpers/d1";
import { fakeAnthropic } from "../helpers/fake-anthropic";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
beforeEach(async () => {
  for (const table of [signals, triggers, organizations, jobs, triggerQueries, aiRuns]) await t.db.delete(table);
});

const NOW = new Date("2026-09-23T15:00:00Z");
const CFG = { apiKey: "test", monthlyBudgetUsd: 50 };

const sig = (over: Partial<RawSignal>): RawSignal => ({
  source: "worldbank", externalId: crypto.randomUUID(), title: "t", url: "https://example.org", publishedAt: "2026-09-20T00:00:00Z", ...over,
});

describe("scanDueQueries", () => {
  it("runs at most one GDELT and two other queries per call, stores signals once, and enqueues classification", async () => {
    await ensureTriggerQueries(t.db);
    const calls: string[] = [];
    const fetcher = (source: RawSignal["source"]) => async (_db: unknown, q: string) => {
      calls.push(`${source}:${q}`);
      return [sig({ source, externalId: `${source}-fixed`, title: `${source} signal` })];
    };
    const fetchers = { gdelt: fetcher("gdelt"), ted: fetcher("ted"), worldbank: fetcher("worldbank"), edgar_form_d: fetcher("edgar_form_d"), gdacs: fetcher("gdacs") };
    const r = await scanDueQueries(t.db, NOW, fetchers);
    expect(calls.filter(c => c.startsWith("gdelt:"))).toHaveLength(1);
    expect(calls.length).toBe(3);
    expect(r.ran).toHaveLength(3);
    // Same external id from repeated runs is stored once.
    await scanDueQueries(t.db, NOW, fetchers);
    const stored = await t.db.select().from(signals);
    expect(new Set(stored.map(s => `${s.source}:${s.externalId}`)).size).toBe(stored.length);
    expect((await t.db.select().from(jobs).where(eq(jobs.type, "triggers.classify"))).length).toBeGreaterThan(0);
  });

  it("does not rerun a query before its rescan interval", async () => {
    await ensureTriggerQueries(t.db);
    const seen: string[] = [];
    const f = (source: string) => async (_db: unknown, q: string) => { seen.push(`${source}:${q}`); return []; };
    const fetchers = { gdelt: f("gdelt"), ted: f("ted"), worldbank: f("worldbank"), edgar_form_d: f("edgar_form_d"), gdacs: f("gdacs") };
    for (let i = 0; i < 20; i++) await scanDueQueries(t.db, NOW, fetchers);
    expect(new Set(seen).size).toBe(seen.length); // every query ran at most once at this instant
  });
});

describe("classify and read", () => {
  it("marks relevant signals, then turns one into a trigger with an organization and decision read", async () => {
    await t.db.insert(signals).values([
      { source: "worldbank", externalId: "OP1", title: "Consulting services for ESIA, Kathmandu Valley Water Security", url: "https://wb/1", publishedAt: "2026-09-22T00:00:00Z", deadline: "2026-10-14T00:00:00Z", country: "Nepal", orgName: "Kathmandu Valley Water Supply Management Board" },
      { source: "gdelt", externalId: "u2", title: "Stock market closes higher", url: "https://news/2", publishedAt: "2026-09-22T00:00:00Z" },
    ]);
    const { client, calls } = fakeAnthropic([
      { items: [
        { index: 0, relevant: true, relevance: 86, trigger_type: "procurement", org_name: "Kathmandu Valley Water Supply Management Board", country: "Nepal", city: "Kathmandu", urgency: 4, reason: "Water security ESIA consulting" },
        { index: 1, relevant: false, relevance: 3, trigger_type: "event", org_name: "", country: "", city: "", urgency: 1, reason: "Generic market news" },
      ] },
      {
        decision_read: "The board must commission the ESIA before financing proceeds.", org_name: "Kathmandu Valley Water Supply Management Board",
        event_date: "2026-09-22", trigger_type: "procurement", urgency: 4, engagement_path: "project_diagnostic", engagement: "diagnostic",
        practices: ["systems_intelligence"], sectors: ["water_food_nature"], territorial_systems: ["water"], suggested_titles: ["Executive Director"], location: "Kathmandu, Nepal",
      },
    ]);
    const r = await classifyNewSignals(t.db, CFG, 15, NOW, client);
    expect(r).toEqual({ classified: 2, relevant: 1 });
    expect(calls[0].model).toBe("claude-haiku-4-5");
    const [relevant] = await t.db.select().from(signals).where(eq(signals.status, "relevant"));
    expect(relevant.externalId).toBe("OP1");
    expect((await t.db.select().from(jobs).where(eq(jobs.type, "triggers.read")))).toHaveLength(1);

    const triggerId = await readSignal(t.db, CFG, relevant.id, NOW, client);
    expect(calls[1].model).toBe("claude-sonnet-5");
    const [trig] = await t.db.select().from(triggers).where(eq(triggers.id, triggerId!));
    expect(trig.type).toBe("procurement");
    expect(trig.decisionRead).toMatch(/ESIA/);
    const [org] = await t.db.select().from(organizations).where(eq(organizations.id, trig.orgId));
    expect(org.name).toBe("Kathmandu Valley Water Supply Management Board");
    expect(org.location).toBe("Kathmandu, Nepal");
    expect((await t.db.select().from(jobs).where(eq(jobs.type, "geo.org")))).toHaveLength(1);
    const runs = await t.db.select().from(aiRuns);
    expect(runs.every(x => x.status === "ok" && x.costUsd > 0)).toBe(true);
  });

  it("stops at the monthly AI budget without calling the model", async () => {
    await t.db.insert(signals).values({ source: "gdelt", externalId: "x", title: "x", url: "https://x", publishedAt: "2026-09-22T00:00:00Z" });
    await t.db.insert(aiRuns).values({ promptKey: "trigger.classify", promptVersion: 1, model: "claude-haiku-4-5", costUsd: 60, status: "ok", createdAt: new Date().toISOString() }); // the guard reads the real current month
    const { client, calls } = fakeAnthropic([]);
    await expect(classifyNewSignals(t.db, CFG, 15, NOW, client)).rejects.toThrow(/budget/);
    expect(calls).toHaveLength(0);
  });
});
