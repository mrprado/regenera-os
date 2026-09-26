import { unzipSync, strFromU8 } from "fflate";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { esignEnvelopes, generatedDocuments, mandates, placeFacts, projects } from "@/db/schema";
import { approveLegal, DRAFT_MARK, generateDocument, MockESignProvider, newVersion, recordSignedUpload, renderDocument, startSignature } from "@/lib/documents/engine";
import { fillTemplate, openPlaceholders, TEMPLATES } from "@/lib/documents/library";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [esignEnvelopes, generatedDocuments, placeFacts, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

describe("template library", () => {
  it("has the 27 template types; empty placeholders never pass silently", () => {
    expect(TEMPLATES).toHaveLength(27);
    const nda = TEMPLATES.find(x => x.key === "mutual-nda")!;
    const md = fillTemplate(nda, { counterparty: "Acme SA" });
    expect(md).toContain("Acme SA");
    expect(openPlaceholders(md)).toContain("Purpose of the disclosure");
  });
});

describe("generated documents", () => {
  it("legal drafts carry the counsel mark and watermark; approval needs complete fields and a named reviewer; signature waits for approval", async () => {
    const d = await generateDocument(t.db, { mandateId: M, templateKey: "referral-agreement", values: { counterparty: "Intro MX" } }, "alan");
    expect(d.body.startsWith(`> ${DRAFT_MARK}`)).toBe(true);
    expect(d.legalReviewStatus).toBe("pending");
    await expect(approveLegal(t.db, d.id, "Counsel X", "alan")).rejects.toThrow(/open items/);
    await expect(startSignature(t.db, d.id, [{ name: "A", email: "a@x.com", role: "Introducer" }], "mock", "alan")).rejects.toThrow(/Counsel review/);
    const pdf = await renderDocument(d, "pdf");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");

    const full = Object.fromEntries(TEMPLATES.find(x => x.key === "referral-agreement")!.fields.map(f => [f.key, `v-${f.key}`]));
    const v2 = await newVersion(t.db, d.id, full, "alan");
    expect(v2).toMatchObject({ version: 2, previousId: d.id });
    await approveLegal(t.db, v2.id, "Counsel X (Mexico City)", "alan");
    const [approved] = await t.db.select().from(generatedDocuments).where(eq(generatedDocuments.id, v2.id));
    expect(approved.body).toContain("Counsel reviewed: Counsel X (Mexico City)");
    expect(approved.body).not.toContain(DRAFT_MARK);
    expect((await t.db.select().from(generatedDocuments).where(eq(generatedDocuments.id, d.id)))[0].version).toBe(1); // history kept

    const env = await startSignature(t.db, v2.id, [{ name: "A", email: "a@x.com", role: "Introducer" }, { name: "B", email: "b@regenera.bio", role: "Regenera" }], "mock", "alan");
    await MockESignProvider.recordSignature(t.db, env, "a@x.com", "alan");
    expect(await MockESignProvider.getStatus(t.db, env)).toBe("sent");
    await MockESignProvider.recordSignature(t.db, env, "b@regenera.bio", "alan");
    expect(await MockESignProvider.getStatus(t.db, env)).toBe("completed");
    await expect(startSignature(t.db, v2.id, [{ name: "A", email: "a@x.com", role: "x" }], "docusign", "alan")).rejects.toThrow(/credential required/);
    await expect(recordSignedUpload(t.db, v2.id, "http://insecure", "alan")).rejects.toThrow(/https/);
  });

  it("reports come from records and state their sources and unknowns; DOCX is a valid package", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle", lat: 20.9, lng: -89.6, assetClass: "solar" }, "alan");
    await t.db.insert(placeFacts).values({ projectId: p.id, mandateId: M, dimension: "climate", key: "pv_specific_yield", label: "PV specific yield", value: "1,519 kWh/kWp/year", integrationKey: "pvgis", tier: 1, retrievedAt: "2026-09-26T00:00:00Z", license: "PVGIS" });
    const r = await generateDocument(t.db, { mandateId: M, templateKey: "site-intelligence-report", entityType: "project", entityId: p.id }, "alan", "2026-09-26");
    expect(r.legal).toBe(false);
    expect(r.body).toContain("PV specific yield: 1,519 kWh/kWp/year (pvgis, tier 1");
    expect(r.body).toContain("Unknown: Watershed and aquifer");
    expect(r.body).toContain("Report date: 2026-09-26");
    const docx = await renderDocument(r, "docx");
    const files = unzipSync(docx as Uint8Array);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/header1.xml", "word/footer1.xml"]));
    expect(strFromU8(files["word/document.xml"])).toContain("PV specific yield");
    expect(strFromU8(files["word/header1.xml"])).toContain("Regenerative Ecosystem Advisory");
  });
});
