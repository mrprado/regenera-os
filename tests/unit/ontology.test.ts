import { describe, expect, it } from "vitest";
import { ENTITIES, ENTITY_TYPES } from "@/lib/ontology/entities";
import { pickCanonical, type FieldValue } from "@/lib/ontology/conflicts";
import { normalizeAlias } from "@/lib/ontology/identity";
import { allowedEdge, PREDICATES, PREDICATE_KEYS } from "@/lib/ontology/relations";
import { gateOf, MACHINES, PROJECT_GATES, transition } from "@/lib/ontology/states";
import { DATA_ROOM_FOLDERS, levelCode, MATCH_KINDS, MATCH_ROLE } from "@/lib/ontology/taxonomies";
import { PROJECT_STAGES } from "@/lib/projects/vocab";
import { DOCUMENT_CATEGORIES } from "@/lib/contracts/catalog";
import { NETWORK_ROLES } from "@/lib/procurement/vocab";
import { PARTY_ROLES } from "@/lib/projects/vocab";

describe("ontology v1.0: entities and grammar", () => {
  it("defines 20–30 entities, every predicate uses only known entity types", () => {
    expect(ENTITY_TYPES.length).toBeGreaterThanOrEqual(20);
    expect(ENTITY_TYPES.length).toBeLessThanOrEqual(30);
    for (const k of PREDICATE_KEYS) for (const t of [...PREDICATES[k].from, ...PREDICATES[k].to]) expect(ENTITIES[t], `${k} → ${t}`).toBeDefined();
    expect(PREDICATE_KEYS.length).toBeGreaterThanOrEqual(40);
  });
  it("refuses an edge that breaks the grammar", () => {
    expect(allowedEdge("works_at", "person", "organization")).toBe(true);
    expect(allowedEdge("works_at", "organization", "person")).toBe(false);
    expect(allowedEdge("connects_to", "project", "grid_node")).toBe(true);
    expect(allowedEdge("depends_on", "permit", "project")).toBe(false);
    expect(allowedEdge("nonsense", "person", "person")).toBe(false);
  });
});

describe("state machines and gates", () => {
  it("maps every tracker stage to exactly one gate, in order", () => {
    for (const s of Object.keys(PROJECT_STAGES)) expect(PROJECT_GATES.filter(g => (g.stages as readonly string[]).includes(s)), s).toHaveLength(1);
    expect(gateOf("capital_alignment").gate).toBe(4);
    expect(gateOf("operations").gate).toBe(8);
  });
  it("never skips financial close, and marks human-only moves", () => {
    expect(transition("project", "development", "diligence").ok).toBe(true);
    expect(transition("project", "development", "construction").ok).toBe(false);
    expect(transition("project", "financial_close", "construction").ok).toBe(true);
    expect(transition("project", "diligence", "financial_close").humanOnly).toBe(true);
    expect(transition("project", "development", "screening").ok).toBe(false); // more than one step back
    expect(transition("project", "diligence", "capital_alignment").ok).toBe(true); // one step back
  });
  it("permit and claim machines: verification and decisions are human", () => {
    expect(transition("permit", "submitted", "approved")).toMatchObject({ ok: true, humanOnly: true });
    expect(transition("permit", "not_started", "approved").ok).toBe(false);
    expect(transition("claim", "ai_inferred", "verified").humanOnly).toBe(true);
    for (const m of Object.values(MACHINES)) for (const s of m.humanOnly) expect(m.states[s], `${m.label}:${s}`).toBeDefined();
  });
});

describe("identity resolution", () => {
  it("normalizes names across punctuation, accents and legal suffixes", () => {
    expect(normalizeAlias("name", "China Machinery Engineering Corporation")).toBe(normalizeAlias("name", "CHINA MACHINERY ENGINEERING CORP."));
    expect(normalizeAlias("name", "Energía Renovable, S.A. de C.V.")).toBe("energia renovable");
    expect(normalizeAlias("lei", "5493 00 ABC-DEF")).toBe("549300abcdef");
    expect(normalizeAlias("domain", "https://www.Regenera.bio/about")).toBe("regenera.bio");
  });
});

describe("source conflicts", () => {
  const v = (value: string, status: string, method: string | null, extra: Partial<FieldValue> = {}): FieldValue => ({ claimId: value + status, value, unit: "MW", status, sources: [], method, validFrom: null, validTo: null, createdAt: "2026-01-01", ...extra });
  it("keeps every value and picks the strongest, never an AI inference over a sourced value", () => {
    const r = pickCanonical([v("95", "source_provided", "api"), v("104", "verified", "document"), v("120", "ai_inferred", "ai")]);
    expect(r.canonical?.value).toBe("104");
    expect(pickCanonical([v("95", "source_provided", "api"), v("120", "ai_inferred", "ai")]).canonical?.value).toBe("95");
  });
  it("ignores disputed and out-of-date values", () => {
    expect(pickCanonical([v("1", "disputed", null), v("2", "verified", null, { validTo: "2020-01-01" })], "2026-10-07").canonical).toBeNull();
  });
});

describe("taxonomies line up with stored vocabularies", () => {
  it("data-room folders use real document categories; match roles use real network and party roles", () => {
    for (const f of DATA_ROOM_FOLDERS) for (const c of f.categories) expect(DOCUMENT_CATEGORIES, c).toHaveProperty(c);
    for (const k of Object.keys(MATCH_KINDS) as (keyof typeof MATCH_KINDS)[]) {
      for (const r of MATCH_ROLE[k].network) expect(NETWORK_ROLES, r).toHaveProperty(r);
      for (const r of MATCH_ROLE[k].party) expect(PARTY_ROLES, r).toHaveProperty(r);
    }
    expect(DATA_ROOM_FOLDERS).toHaveLength(11);
  });
  it("legacy evidence levels 1/2/3 read as L1/L2/L3", () => {
    expect([0, 1, 2, 3, 4].map(levelCode)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
  });
});
