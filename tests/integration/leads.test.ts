// Phase 27: lead searches attach to records within scope, are idempotent, skip community bodies when found, and
// community contacts are never enrolled in outreach.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { communities, contacts, mandates, organizations, projects, savedSearches, searchResults, sequences } from "@/db/schema";
import type { UserScope } from "@/lib/db/scoped";
import { leadContext, leadSuggestions, saveLeadSearch } from "@/lib/leads/context";
import { runSavedSearch } from "@/lib/radar/saved-searches";
import { enrollContacts } from "@/lib/outreach/sequences";
import { createTestDb } from "../helpers/d1";

const M = "c0000000-0000-4000-8000-000000000001", OTHER = "c0000000-0000-4000-8000-000000000002";
const scope: UserScope = { kind: "user", userId: "u", email: "u@example.com", mandateIds: [M], ownerOf: [M] };
let t: Awaited<ReturnType<typeof createTestDb>>;
let projectId = "", foreignProject = "";

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [[M, "m"], [OTHER, "o"]]) await t.db.insert(mandates).values({ id, slug, name: slug, type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  projectId = (await t.db.insert(projects).values({ mandateId: M, name: "Valle Solar", sector: "energy", country: "MEX" }).returning({ id: projects.id }))[0].id;
  foreignProject = (await t.db.insert(projects).values({ mandateId: OTHER, name: "Elsewhere", sector: "energy" }).returning({ id: projects.id }))[0].id;
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("lead searches for records", () => {
  it("reads a record only within the user's workspaces, with its sector and country", async () => {
    expect(await leadContext(t.db, scope, "project", foreignProject)).toBeNull();
    const ctx = await leadContext(t.db, scope, "project", projectId);
    expect(ctx).toMatchObject({ title: "Valle Solar", sector: "energy", country: "Mexico" });
    expect(ctx!.workflows[0]).toBe("sponsor");
  });

  it("saves one search per record and need, and never schedules it", async () => {
    const ctx = (await leadContext(t.db, scope, "project", projectId))!;
    const a = await saveLeadSearch(t.db, ctx, { workflow: "lenders", sector: "energy", country: "Mexico" }, "u@example.com");
    const b = await saveLeadSearch(t.db, ctx, { workflow: "lenders", sector: "energy", country: "Mexico" }, "u@example.com");
    expect(b).toBe(a);
    const rows = await t.db.select().from(savedSearches);
    expect(rows.filter(r => r.entityId === projectId)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false, entityType: "project", workflow: "lenders", kind: "apollo_people" });
  });

  it("keeps people found, drops community bodies, and lists them on the record", async () => {
    const ctx = (await leadContext(t.db, scope, "project", projectId))!;
    const id = await saveLeadSearch(t.db, ctx, { workflow: "sponsor", sector: "energy" }, "u@example.com");
    const people = [
      { id: "p1", name: "Ana Ruiz", first_name: "Ana", title: "Head of Development", organization: { name: "Valle Energía" } },
      { id: "p2", name: "Luis Pech", first_name: "Luis", title: "Director", organization: { name: "Ejido X'Pichil" } },
    ];
    const fetchImpl = (async () => new Response(JSON.stringify({ people, contacts: [], accounts: [] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const added = await runSavedSearch(t.db, { apiKey: "test", monthlyCreditBudget: 0 }, id, new Date(), fetchImpl);
    expect(added).toBe(1);
    const s = await leadSuggestions(t.db, scope, "project", projectId);
    expect(s.map(x => x.r.name)).toEqual(["Ana Ruiz"]);
    expect(await leadSuggestions(t.db, { ...scope, mandateIds: [OTHER] }, "project", projectId)).toEqual([]);
    expect((await t.db.select().from(searchResults)).some(r => r.name === "Luis Pech")).toBe(false);
  });

  it("never enrols contacts of community bodies in outreach", async () => {
    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "Comunidad Maya Kuxtal", nameNormalized: "comunidad maya kuxtal", source: "other" }).returning();
    await t.db.insert(communities).values({ mandateId: M, name: "Kuxtal", orgId: org.id, createdBy: "u@example.com", updatedBy: "u@example.com" } as never);
    const [plain] = await t.db.insert(organizations).values({ mandateId: M, name: "Valle Energía", nameNormalized: "valle energia", source: "other" }).returning();
    const mk = (email: string, orgId: string) => t.db.insert(contacts).values({ mandateId: M, fullName: email, nameNormalized: email, email, emailLower: email, source: "referral", orgId } as never).returning();
    const [[c1], [c2]] = await Promise.all([mk("lider@kuxtal.org", org.id), mk("ana@valle.mx", plain.id)]);
    const [seq] = await t.db.insert(sequences).values({ mandateId: M, key: "lead-test", name: "Seq", tier: "targeted", steps: [{ step: 1, channel: "email", delayDays: 0 }] as never }).returning();
    const out = await enrollContacts(t.db, { contactIds: [c1.id, c2.id], sequenceId: seq.id, actor: "u@example.com" });
    expect(out.enrolled).toBe(1);
    expect(out.skipped).toMatchObject({ community_body: 1 });
  });
});
