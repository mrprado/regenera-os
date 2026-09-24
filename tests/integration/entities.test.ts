import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contacts, organizations } from "@/db/schema";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
beforeEach(async () => { await t.db.delete(contacts); await t.db.delete(organizations); });

const M = "mandate_regenera";

describe("upsertOrganization", () => {
  it("matches by domain across name variants and fills empty fields with provenance", async () => {
    const a = await upsertOrganization(t.db, M, { name: "Acme Renewables S.A. de C.V.", website: "https://www.acme-renovables.mx" }, "apollo", { source: "apollo" });
    const b = await upsertOrganization(t.db, M, { name: "ACME Renovables", domain: "acme-renovables.mx", country: "MEX", lei: "5299001234567890ABCD" }, "other", { source: "gleif", confidence: "high" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.row.id).toBe(a.row.id);
    expect(b.row.lei).toBe("5299001234567890ABCD");
    expect(b.row.fieldSources.lei.source).toBe("gleif");
    expect(b.row.fieldSources.domain.source).toBe("apollo");
    expect(await t.db.select().from(organizations)).toHaveLength(1);
  });

  it("flags conflicts instead of overwriting", async () => {
    await upsertOrganization(t.db, M, { name: "Blue Water Fund", domain: "bluewater.com", country: "USA" }, "apollo", { source: "apollo" });
    const r = await upsertOrganization(t.db, M, { name: "Blue Water Fund", domain: "bluewater.com", country: "GBR" }, "other", { source: "wikidata" });
    expect(r.row.country).toBe("USA");
    expect(r.conflicts[0]).toMatch(/country/);
  });

  it("does not merge same-name organizations with different domains", async () => {
    await upsertOrganization(t.db, M, { name: "Terra Capital", domain: "terracapital.com" }, "apollo", { source: "apollo" });
    const r = await upsertOrganization(t.db, M, { name: "Terra Capital", domain: "terra-capital.co.uk" }, "apollo", { source: "apollo" });
    expect(r.created).toBe(true);
  });

  it("does not merge different companies that share an email-derived domain", async () => {
    await upsertOrganization(t.db, M, { name: "Andes Agua", domain: "group.com", domainInferred: true }, "other", { source: "csv" });
    const r = await upsertOrganization(t.db, M, { name: "Cerrado Capital", domain: "group.com", domainInferred: true }, "other", { source: "csv" });
    expect(r.created).toBe(true);
    expect(r.row.domain).toBeNull();
    const same = await upsertOrganization(t.db, M, { name: "Andes Agua S.A.", domain: "group.com", domainInferred: true }, "other", { source: "csv" });
    expect(same.created).toBe(false);
  });

  it("keeps mandates separate", async () => {
    await upsertOrganization(t.db, M, { name: "Shared Co", domain: "shared.co" }, "apollo", { source: "apollo" });
    const r = await upsertOrganization(t.db, "mandate_other", { name: "Shared Co", domain: "shared.co" }, "apollo", { source: "apollo" });
    expect(r.created).toBe(true);
  });
});

describe("upsertContact", () => {
  it("dedupes by Apollo ID, then email, then LinkedIn, then name at the same org", async () => {
    const org = (await upsertOrganization(t.db, M, { name: "Acme", domain: "acme.com" }, "apollo", { source: "apollo" })).row;
    const a = await upsertContact(t.db, M, { fullName: "Jane Doe", apolloPersonId: "ap1", orgId: org.id, title: "CIO" }, "apollo", { source: "apollo" });
    const b = await upsertContact(t.db, M, { fullName: "Jane Doe", apolloPersonId: "ap1", email: "Jane@Acme.com", emailStatus: "verified_provider" }, "apollo", { source: "apollo" });
    expect(b.row.id).toBe(a.row.id);
    expect(b.row.emailLower).toBe("jane@acme.com");
    expect(b.row.emailStatus).toBe("verified_provider");
    const c = await upsertContact(t.db, M, { fullName: "J. Doe", email: "jane@acme.com" }, "website", { source: "site" });
    expect(c.row.id).toBe(a.row.id);
    const d = await upsertContact(t.db, M, { fullName: "Jane Doe", orgId: org.id }, "other", { source: "csv" });
    expect(d.row.id).toBe(a.row.id);
    expect(await t.db.select().from(contacts)).toHaveLength(1);
  });

  it("canonicalizes LinkedIn URLs for matching", async () => {
    const a = await upsertContact(t.db, M, { fullName: "Luis Pérez", linkedinUrl: "https://mx.linkedin.com/in/luis-perez/" }, "linkedin", { source: "manual" });
    const b = await upsertContact(t.db, M, { fullName: "Luis Perez", linkedinUrl: "linkedin.com/in/Luis-Perez" }, "linkedin", { source: "manual" });
    expect(b.row.id).toBe(a.row.id);
  });
});
