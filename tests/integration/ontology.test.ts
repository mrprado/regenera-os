import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimEvidence, claims, documents, entityAliases, integrations, landControls, mandates, projects, relationshipEdges, sanctionsChecks, sanctionsLists, stakeholders,
} from "@/db/schema";
import { dataRoom } from "@/lib/diligence/dataroom";
import { clearIntegrationCache } from "@/lib/integrations/engine";
import { valuesBySource } from "@/lib/ontology/conflicts";
import { addOntologyEdge, edgesOf } from "@/lib/ontology/edges";
import { addAlias, resolveAlias } from "@/lib/ontology/identity";
import { gateState, latestCheck, refreshList, screenBeforeAction, screenEntity, storeList } from "@/lib/sanctions/engine";
import type { SanctionsEntry } from "@/lib/sanctions/parse";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const ORG = "11111111-1111-4111-8111-111111111111", ORG2 = "22222222-2222-4222-8222-222222222222";
let projectId = "";

beforeEach(async () => {
  for (const x of [entityAliases, relationshipEdges, sanctionsChecks, sanctionsLists, claimEvidence, claims, documents, landControls, stakeholders, projects, integrations, mandates]) await t.db.delete(x);
  clearIntegrationCache();
  for (const [id, slug] of [[M, "regenera"], [OTHER, "other"]]) await t.db.insert(mandates).values({ id, slug, name: slug, type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  const [p] = await t.db.insert(projects).values({ mandateId: M, name: "Solar A", stage: "development", country: "MEX" }).returning();
  projectId = p.id;
});

const entries = (n: number): SanctionsEntry[] => [["SDN-1", "ACME TRADING LLC", "entity", "IRAN", ""], ...Array.from({ length: n }, (_, i) => [`SDN-${i + 10}`, `LISTED ENTITY NUMBER ${i}`, "entity", "X", ""] as SanctionsEntry)];

describe("identity resolution", () => {
  it("one identifier belongs to one record per workspace; a second claimant is a conflict, not a duplicate", async () => {
    expect((await addAlias(t.db, { mandateId: M, entityType: "organization", entityId: ORG, scheme: "lei", value: "5493 00ABC", createdBy: "a@x" })).ok).toBe(true);
    const again = await addAlias(t.db, { mandateId: M, entityType: "organization", entityId: ORG, scheme: "lei", value: "549300abc", createdBy: "a@x" });
    expect(again).toMatchObject({ ok: true, existed: true });
    const clash = await addAlias(t.db, { mandateId: M, entityType: "organization", entityId: ORG2, scheme: "lei", value: "549300ABC", createdBy: "a@x" });
    expect(clash.ok).toBe(false);
    expect((await resolveAlias(t.db, M, "lei", "549300-ABC"))?.entityId).toBe(ORG);
    expect(await resolveAlias(t.db, OTHER, "lei", "549300ABC")).toBeNull(); // workspace isolation
  });
});

describe("typed edges", () => {
  it("refuses ungrammatical edges and answers as of a date", async () => {
    await expect(addOntologyEdge(t.db, { mandateId: M, fromType: "organization", fromId: ORG, predicate: "works_at", toType: "person", toId: "x", createdBy: "a@x" })).rejects.toThrow(/runs from/);
    await addOntologyEdge(t.db, { mandateId: M, fromType: "organization", fromId: ORG, predicate: "develops", toType: "project", toId: projectId, validFrom: "2024-01-01", validTo: "2026-06-30", createdBy: "a@x" });
    await addOntologyEdge(t.db, { mandateId: M, fromType: "organization", fromId: ORG2, predicate: "develops", toType: "project", toId: projectId, validFrom: "2026-07-01", createdBy: "a@x" });
    expect((await edgesOf(t.db, [M], "project", projectId, "2025-03-01")).map(e => e.fromId)).toEqual([ORG]);
    expect((await edgesOf(t.db, [M], "project", projectId, "2026-09-01")).map(e => e.fromId)).toEqual([ORG2]);
    expect(await edgesOf(t.db, [OTHER], "project", projectId)).toEqual([]);
  });
});

describe("sanctions screening", () => {
  it("stores lists in parts, refuses an implausibly small replacement, screens names and aliases, and gates introductions", async () => {
    expect((await storeList(t.db, "ofac", entries(3000))).parts).toBe(2);
    await expect(storeList(t.db, "ofac", entries(100))).rejects.toThrow(/kept the previous copy/);
    await addAlias(t.db, { mandateId: M, entityType: "organization", entityId: ORG, scheme: "name", value: "Acme Trading", createdBy: "a@x" });
    const c = await screenEntity(t.db, { mandateId: M, entityType: "organization", entityId: ORG, name: "Totally Different Name", actor: "a@x" });
    expect(c.result).toBe("possible_match"); // matched through the recorded alias
    expect(c.matches[0].listId).toBe("SDN-1");
    const g = await screenBeforeAction(t.db, { mandateId: M, entityType: "organization", entityId: ORG, name: "Totally Different Name", actor: "a@x" });
    expect(g).toMatchObject({ proceed: false, state: "pending" });
    const clean = await screenBeforeAction(t.db, { mandateId: M, entityType: "organization", entityId: ORG2, name: "Regenera Development Office", actor: "a@x" });
    expect(clean).toMatchObject({ proceed: true, state: "clear" });
    expect(gateState(await latestCheck(t.db, OTHER, "organization", ORG))).toBe("not_screened");
  });
  it("without loaded lists, proceeds with a warning and never records a clear result", async () => {
    const g = await screenBeforeAction(t.db, { mandateId: M, entityType: "organization", entityId: ORG, name: "Anyone", actor: "a@x" });
    expect(g.proceed).toBe(true);
    expect(g.warning).toMatch(/No sanctions list/);
    expect(await t.db.select().from(sanctionsChecks)).toHaveLength(0);
  });
  it("refreshes a list from a streamed download", async () => {
    const csv = ['36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ', ...Array.from({ length: 60 }, (_, i) => `${100 + i},"NAME ${i}",-0- ,"X",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- `)].join("\n");
    const fetchImpl = (async (url: string) => new Response(/ALT/.test(url) ? '36,12,"aka","AERO-CARIBBEAN",-0- \n' : csv)) as unknown as typeof fetch;
    const r = await refreshList(t.db, "ofac", new Date(), fetchImpl);
    expect(r.entries).toBe(62);
  });
});

describe("diligence", () => {
  it("data room counts final documents and records per folder", async () => {
    await t.db.insert(documents).values([{ mandateId: M, projectId, title: "Option agreement", category: "land", status: "executed" }, { mandateId: M, projectId, title: "Grid study draft", category: "technical", status: "draft" }, { mandateId: OTHER, projectId, title: "Leak", category: "corporate", status: "approved" }]);
    await t.db.insert(landControls).values({ mandateId: M, projectId, parcelRef: "P-1", areaHa: 300, controlType: "option", titleEvidence: "searched" });
    const room = await dataRoom(t.db, [M], projectId);
    const by = Object.fromEntries(room.map(f => [f.key, f]));
    expect(by.land).toMatchObject({ final: 1, state: "filled" });
    expect(by.grid).toMatchObject({ drafts: 1, state: "draft_only" });
    expect(by.corporate.state).toBe("empty"); // other workspace's document does not count
  });
  it("values by source keep every claim and flag disagreement", async () => {
    const [a] = await t.db.insert(claims).values({ mandateId: M, entityType: "project", entityId: projectId, statement: "100 MWac per EIA", field: "capacity", value: "100", unit: "MW", status: "source_provided", createdBy: "a@x" }).returning();
    const [b] = await t.db.insert(claims).values({ mandateId: M, entityType: "project", entityId: projectId, statement: "104 MW per developer", field: "capacity", value: "104", unit: "MW", status: "verified", createdBy: "a@x" }).returning();
    await t.db.insert(claimEvidence).values([{ claimId: a.id, provider: "eia", method: "api", addedBy: "a@x" }, { claimId: b.id, provider: "developer", method: "document", addedBy: "a@x" }]);
    const [f] = await valuesBySource(t.db, [M], "project", projectId);
    expect(f).toMatchObject({ field: "capacity", conflict: true });
    expect(f.values).toHaveLength(2);
    expect(f.canonical?.value).toBe("104");
    expect(await valuesBySource(t.db, [OTHER], "project", projectId)).toEqual([]);
  });
});
