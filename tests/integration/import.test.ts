import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contacts, imports, jobs, organizations } from "@/db/schema";
import { detectMapping, parseCsv } from "@/lib/import/csv";
import { importKey, processImportChunk, type ImportStore } from "@/lib/import/process";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
beforeEach(async () => { for (const x of [contacts, organizations, imports, jobs]) await t.db.delete(x); });

function memStore(): ImportStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, put: async (k, v) => { data.set(k, v); }, get: async k => data.get(k) ?? null };
}

describe("CSV import", () => {
  it("imports 250 rows in two chunks and dedupes against seeded duplicates", async () => {
    // 240 unique people plus 10 duplicates of earlier rows (same email, different case) = 250 rows.
    const lines = ["First Name,Last Name,Title,Company,Email,Website"];
    for (let i = 0; i < 240; i++) lines.push(`P${i},Lastname,Analyst,Org ${i % 20},p${i}@org${i % 20}.com,org${i % 20}.com`);
    for (let i = 0; i < 10; i++) lines.push(`P${i},Lastname,Analyst,Org ${i % 20},P${i}@ORG${i % 20}.COM,org${i % 20}.com`);
    const parsed = parseCsv(lines.join("\n"));
    const [headers, ...rows] = parsed;
    const store = memStore();
    const [imp] = await t.db.insert(imports).values({ mandateId: "m1", kind: "csv", filename: "test.csv", totalRows: rows.length, status: "processing", mapping: Object.fromEntries(Object.entries(detectMapping(headers)).map(([k, v]) => [k, String(v)])), createdBy: "alan" }).returning();
    await store.put(importKey(imp.id), JSON.stringify({ headers, rows }));

    await processImportChunk(t.db, store, imp.id, 0);
    const next = await t.db.select().from(jobs).where(eq(jobs.type, "import.process"));
    expect(next).toHaveLength(1);
    expect(next[0].payload).toEqual({ importId: imp.id, offset: 200 });
    await processImportChunk(t.db, store, imp.id, 200);

    const [done] = await t.db.select().from(imports).where(eq(imports.id, imp.id));
    expect(done).toMatchObject({ status: "done", processedRows: 250, created: 240, updated: 10 });
    expect(await t.db.select().from(contacts)).toHaveLength(240);
    expect(await t.db.select().from(organizations)).toHaveLength(20);
    // 250 rows through the local D1 proxy is the heaviest test; the repo sits in OneDrive, which slows file I/O.
  }, 60_000);
});
