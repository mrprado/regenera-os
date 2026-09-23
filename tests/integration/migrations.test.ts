import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

describe("migrations", () => {
  it("apply cleanly to a fresh D1", async () => {
    const { results } = await t.d1.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<{ name: string }>();
    const names = results.map(r => r.name);
    for (const table of ["audit_log", "job_schedules", "jobs", "mandate_members", "mandates", "oauth_accounts", "system_state"]) {
      expect(names).toContain(table);
    }
  });

  it("enforce CHECK constraints on closed sets", async () => {
    await expect(
      t.d1.prepare("INSERT INTO mandates (id, slug, name, type, rules) VALUES ('x', 'x', 'X', 'hedge_fund', '{}')").run(),
    ).rejects.toThrow(/CHECK/);
  });
});
