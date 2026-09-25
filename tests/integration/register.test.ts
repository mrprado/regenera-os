import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contractObligations, contractParties, contracts, contractVersions, documentLinks, documents, mandates } from "@/db/schema";
import {
  addObligation, completeObligation, newDocumentVersion, obligationAlerts, registerAmendment, registerContract, setLifecycle, toCsv, updateKeyTerms,
} from "@/lib/contracts/register";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const NOW = new Date("2026-09-24T12:00:00Z");

beforeEach(async () => {
  for (const x of [documentLinks, documents, contractObligations, contractParties, contractVersions, contracts, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: OTHER, slug: "other", name: "Other", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
  ]);
});

describe("agreement register", () => {
  it("registers any agreement type; executed agreements are locked; capital-linked compensation flags a review", async () => {
    const [doc] = await t.db.insert(documents).values({ mandateId: M, title: "PPA executed", category: "commercial", url: "https://drive.example/ppa.pdf" }).returning();
    const ppa = await registerContract(t.db, { mandateId: M, category: "energy_commercial", contractType: "ppa", title: "PPA with offtaker", lifecycle: "active", governingLaw: "Mexico", executionDate: "2026-06-01", endDate: "2046-06-01", documentId: doc.id, parties: [{ name: "Offtaker SA", role: "counterparty" }] }, "alan", NOW);
    expect(ppa).toMatchObject({ kind: "registered", lifecycle: "active", status: "signed", reviewRequired: false, governingLaw: "Mexico" });
    expect(ppa.lockedAt).not.toBeNull();
    expect(await t.db.select().from(contractParties)).toHaveLength(1);
    expect(await t.db.select().from(documentLinks)).toEqual([expect.objectContaining({ entity: "contract", entityId: ppa.id })]);
    const fee = await registerContract(t.db, { mandateId: M, category: "regenera_commercial", contractType: "success_fee" }, "alan", NOW);
    expect(fee).toMatchObject({ reviewRequired: true, lifecycle: "draft", title: "Success-fee arrangement", lockedAt: null });
  });

  it("locked agreements cannot go back to pre-execution or change terms; amendments carry the change", async () => {
    const c = await registerContract(t.db, { mandateId: M, category: "land", contractType: "lease", lifecycle: "negotiation" }, "alan", NOW);
    expect(await updateKeyTerms(t.db, c.id, { summary: "25-year lease", keyTerms: { termination: "Cl. 14: 12 months' notice" } }, "alan")).toBe(2);
    await setLifecycle(t.db, c.id, "active", "alan", NOW);
    const [active] = await t.db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(active.lockedAt).not.toBeNull();
    await expect(setLifecycle(t.db, c.id, "negotiation", "alan")).rejects.toThrow("amendment");
    await expect(updateKeyTerms(t.db, c.id, { summary: "changed" }, "alan")).rejects.toThrow("locked");
    const a = await registerAmendment(t.db, c.id, { summary: "Rent indexation changed (Cl. 5)", executionDate: "2026-10-01", lifecycle: "effective" }, "alan");
    expect(a).toMatchObject({ parentContractId: c.id, contractType: "amendment" });
    expect((await t.db.select().from(contracts).where(eq(contracts.id, c.id)))[0].lifecycle).toBe("amended");
  });

  it("obligations need their evidence, recurring ones roll forward, and alerts stay within the entity", async () => {
    const c = await registerContract(t.db, { mandateId: M, category: "financing", contractType: "loan", title: "Senior facility", lifecycle: "active", endDate: "2026-12-01" }, "alan", NOW);
    const q = await addObligation(t.db, c.id, { obligation: "Deliver DSCR compliance certificate", responsibleParty: "Borrower", category: "covenant", dueDate: "2026-09-30", recurrence: "quarterly", evidenceRequired: "Signed certificate", sourceClause: "21.2" });
    await addObligation(t.db, c.id, { obligation: "Late notice", responsibleParty: "Borrower", category: "notice", dueDate: "2026-09-01" });
    await addObligation(t.db, c.id, { obligation: "Far away", responsibleParty: "Borrower", dueDate: "2027-06-01" });
    const other = await registerContract(t.db, { mandateId: OTHER, category: "financing", contractType: "loan", lifecycle: "active" }, "alan", NOW);
    await addObligation(t.db, other.id, { obligation: "Hidden", responsibleParty: "X", dueDate: "2026-09-25" });
    const fee = await registerContract(t.db, { mandateId: M, category: "regenera_commercial", contractType: "referral" }, "alan", NOW);

    const a = await obligationAlerts(t.db, [M], NOW);
    expect(a.due.map(d => [d.obligation, d.overdue])).toEqual([["Late notice", true], ["Deliver DSCR compliance certificate", false]]);
    expect(a.expiring.map(e => e.title)).toEqual(["Senior facility"]);
    expect(a.reviews.map(r => r.id)).toEqual([fee.id]);

    await expect(completeObligation(t.db, q.id, { status: "done" }, "alan", NOW)).rejects.toThrow("Evidence required");
    const next = await completeObligation(t.db, q.id, { status: "done", evidence: "Certificate sent 2026-09-29" }, "alan", NOW);
    expect(next).toMatchObject({ dueDate: "2026-12-30", status: "open", sourceClause: "21.2", recurrence: "quarterly" });
  });

  it("new document versions supersede the old one and keep its links", async () => {
    const [d] = await t.db.insert(documents).values({ mandateId: M, title: "ESIA", category: "environmental", version: "1", status: "approved" }).returning();
    await t.db.insert(documentLinks).values({ documentId: d.id, mandateId: M, entity: "project", entityId: "p1" });
    const v2 = await newDocumentVersion(t.db, d.id, { version: "2", url: "https://drive.example/esia-v2.pdf" }, "alan");
    expect((await t.db.select().from(documents).where(eq(documents.id, d.id)))[0].status).toBe("superseded");
    expect(v2).toMatchObject({ version: "2", supersedesId: d.id, title: "ESIA" });
    expect((await t.db.select().from(documentLinks).where(eq(documentLinks.documentId, v2.id)))[0]).toMatchObject({ entity: "project", entityId: "p1" });
  });

  it("CSV registers escape commas, quotes and new lines", () => {
    expect(toCsv(["A", "B"], [["x,y", 'say "hi"'], ["line\nbreak", null]])).toBe('A,B\n"x,y","say ""hi"""\n"line\nbreak",\n');
  });
});
