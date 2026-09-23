import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobSchedules, mandates } from "@/db/schema";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const statements = readFileSync(join(__dirname, "..", "..", "seed", "seed.sql"), "utf8")
  .split(";").map(s => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);

describe("seed", () => {
  it("loads, and loads again without duplicates", async () => {
    for (let i = 0; i < 2; i++) for (const s of statements) await t.d1.prepare(s).run();
    const m = await t.db.select().from(mandates);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ slug: "regenera", type: "advisory" });
    expect(await t.db.select().from(jobSchedules)).toHaveLength(1);
  });
});
