import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capitalProfiles, contacts, mandates, privateCapitalProfiles, projectReadiness, projects, projectStageHistory } from "@/db/schema";
import type { UserScope } from "@/lib/db/scoped";
import { createProject } from "@/lib/projects/engine";
import { globalSearch } from "@/lib/search";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const scope = (owner: boolean): UserScope => ({ kind: "user", userId: "u", email: "a@regenera.bio", mandateIds: [M], ownerOf: owner ? [M] : [] });

beforeEach(async () => {
  for (const x of [privateCapitalProfiles, capitalProfiles, contacts, projectReadiness, projectStageHistory, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: OTHER, slug: "other", name: "Other", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
  ]);
  await createProject(t.db, { mandateId: M, name: "Valle Solar", country: "Mexico" }, "a");
  await createProject(t.db, { mandateId: OTHER, name: "Valle Hidden" }, "a");
  await t.db.insert(capitalProfiles).values({ mandateId: M, name: "Valle Capital Partners", capitalType: "fund" });
  const [c] = await t.db.insert(contacts).values({ mandateId: M, fullName: "Valle Investor", nameNormalized: "valle investor", source: "other" }).returning();
  await t.db.insert(privateCapitalProfiles).values({ mandateId: M, contactId: c.id });
});

describe("global search", () => {
  it("finds records across types within the user's entities only", async () => {
    const hits = await globalSearch(t.db, scope(true), "valle");
    expect(hits.map(h => h.type)).toEqual(expect.arrayContaining(["Project", "Capital partner", "Private investor", "Person"]));
    expect(hits.some(h => h.label === "Valle Hidden")).toBe(false);
    expect(await globalSearch(t.db, scope(true), "v")).toEqual([]);
  });

  it("hides private investors from members", async () => {
    const hits = await globalSearch(t.db, scope(false), "valle");
    expect(hits.some(h => h.type === "Private investor")).toBe(false);
    expect(hits.some(h => h.type === "Person" && h.label === "Valle Investor")).toBe(true); // the person record itself stays visible
  });
});
