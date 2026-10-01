// Analyst workbench (analyst-production prompt; hardening §14–15, §63, §67): the question gets an issue tree, formal
// conclusions need evidence, sign-off is prepared → reviewed → approved by different named humans, AI never signs,
// approval writes the project decision, findings become tasks/risks/decisions, and the memo cites sources by number.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analysisRequests, decisions, evidenceItems, findings, issueNodes, mandates, projects, reviewMarks, risks, storyPoints, tasks } from "@/db/schema";
import { addEvidence, addFinding, addNode, approve, closeQuick, concludeNode, convertFinding, createRequest, isHuman, loadRequest, markForReview, memo, prepare, resolveMark, review, setIc, signOffGaps } from "@/lib/workbench/engine";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera", A = "analyst@regenera.bio", R = "reviewer@regenera.bio", P = "partner@regenera.bio";
let projectId = "";

beforeEach(async () => {
  for (const x of [reviewMarks, storyPoints, findings, evidenceItems, issueNodes, analysisRequests, decisions, risks, tasks, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  projectId = (await createProject(t.db, { mandateId: M, name: "Ostrea Solar" }, A)).id;
});

const fresh = async (mode: "formal" | "quick" = "formal") => createRequest(t.db, { mandateId: M, question: "Is Ostrea ready for institutional investor outreach?", template: "capital_readiness", mode, projectId }, A);

describe("workplan", () => {
  it("seeds a consulting-style issue tree from the template", async () => {
    const r = await fresh();
    const d = (await loadRequest(t.db, r.id))!;
    expect(d.r.status).toBe("workplan");
    expect(d.nodes.filter(n => !n.parentId).map(n => n.text)).toEqual(["Land", "Technical", "Grid", "Commercial", "Permitting", "Financial", "Sponsor", "Legal"]);
    expect(d.nodes.find(n => n.text.startsWith("What upgrade cost"))?.parentId).toBe(d.nodes.find(n => n.text === "Grid")?.id);
  });
});

describe("evidence discipline", () => {
  it("a formal hypothesis cannot be concluded without linked evidence, and 'verified' needs primary evidence", async () => {
    const r = await fresh();
    const grid = (await loadRequest(t.db, r.id))!.nodes.find(n => n.text === "Grid")!;
    const h = await addNode(t.db, r, { parentId: grid.id, kind: "hypothesis", text: "Grid connection is the primary obstacle to financing" }, A);
    await expect(concludeNode(t.db, r, h.id, { status: "answered", conclusion: "supported", confidence: "moderate", rationale: "" }, A)).rejects.toThrow(/Link evidence/);
    await expect(addEvidence(t.db, r, { title: "Substation distance", evidenceClass: "modeled" } as never, A)).rejects.toThrow(/source/);
    await addEvidence(t.db, r, { nodeId: h.id, title: "Preliminary grid study: USD 14M network upgrade", evidenceClass: "inferred", kind: "document", source: "Sponsor data room" }, A);
    await expect(concludeNode(t.db, r, h.id, { status: "answered", conclusion: "supported", confidence: "verified", rationale: "" }, A)).rejects.toThrow(/Verified needs primary/);
    await concludeNode(t.db, r, h.id, { status: "answered", conclusion: "supported", confidence: "moderate", rationale: "Upgrade and queue uncertainty dominate" }, A);
  });
});

describe("sign-off", () => {
  async function ready() {
    const r = await fresh();
    const e1 = await addEvidence(t.db, r, { title: "Utility queue position letter", evidenceClass: "primary", kind: "regulatory_source", source: "Utility", sourceDate: "2026-08-12" }, A);
    const e2 = await addEvidence(t.db, r, { title: "Grid study", evidenceClass: "client_provided", kind: "document", source: "Sponsor" }, A);
    const f = await addFinding(t.db, r, { kind: "red_flag", finding: "No executed PPA", implication: "Revenue remains uncontracted", severity: "high", resolution: "Secure an offtake term sheet before the raise", evidenceIds: [e2.id] }, A);
    await addFinding(t.db, r, { kind: "finding", finding: "Queue position 14; energisation 2029 at the earliest", severity: "medium", evidenceIds: [e1.id, e2.id] }, A);
    await t.db.update(analysisRequests).set({ summary: "Strong resource, weak grid position.", recommendation: "Advance grid diligence before increasing development spend." }).where(eq(analysisRequests.id, r.id));
    return { r, f, e1, e2 };
  }

  it("lists gaps, then runs prepare → review (different person) → approve, writing the project decision", async () => {
    const r0 = await fresh();
    expect(signOffGaps((await loadRequest(t.db, r0.id))!)).toEqual(expect.arrayContaining(["No findings recorded", "No executive summary", "No recommendation"]));
    const { r } = await ready();
    await expect(approve(t.db, r.id, P, "Proceed with conditions")).rejects.toThrow(/reviewed/);
    await prepare(t.db, r.id, A);
    await expect(review(t.db, r.id, A)).rejects.toThrow(/cannot be the preparer/);
    await review(t.db, r.id, R);
    await expect(approve(t.db, r.id, "claude:assistant", "Proceed")).rejects.toThrow(/named person/);
    const { decisionId } = await approve(t.db, r.id, P, "Do not start outreach until the grid study update and an offtake term sheet are in hand");
    const [dec] = await t.db.select().from(decisions).where(eq(decisions.id, decisionId!));
    expect(dec).toMatchObject({ projectId, decidedBy: P, status: "decided" });
    expect(dec.evidence).toContain("[1] Grid study");
    expect((await loadRequest(t.db, r.id))!.r.status).toBe("decided");
  });

  it("a review comment sends the analysis back and blocks review until resolved", async () => {
    const { r, f } = await ready();
    await prepare(t.db, r.id, A);
    const m = await markForReview(t.db, (await loadRequest(t.db, r.id))!.r, { targetType: "finding", targetId: f.id, mark: "source", comment: "Which PPA status source?" }, R);
    const back = (await loadRequest(t.db, r.id))!.r;
    expect(back).toMatchObject({ status: "synthesis", version: 2 });
    await expect(prepare(t.db, r.id, A)).rejects.toThrow(/open review comment/);
    await resolveMark(t.db, back, m.id, A);
    await prepare(t.db, r.id, A);
    await review(t.db, r.id, R);
  });

  it("quick work closes without review", async () => {
    const r = await fresh("quick");
    await closeQuick(t.db, r.id, A, "Not yet; revisit after the grid study");
    expect((await loadRequest(t.db, r.id))!.r.status).toBe("closed");
  });

  it("IC outcomes follow the sequence and need a named person with rationale", async () => {
    const { r } = await ready();
    const cur = async () => (await loadRequest(t.db, r.id))!.r;
    await setIc(t.db, await cur(), "draft", A, {});
    await expect(setIc(t.db, await cur(), "ic", A, {})).rejects.toThrow(/cannot move/);
    await setIc(t.db, await cur(), "analyst_review", A, {});
    await setIc(t.db, await cur(), "senior_review", A, {});
    await expect(setIc(t.db, await cur(), "ic_ready", A, {})).rejects.toThrow(/reviewed/);
    await prepare(t.db, r.id, A); await review(t.db, r.id, R);
    await setIc(t.db, await cur(), "ic_ready", R, {});
    await setIc(t.db, await cur(), "ic", R, {});
    await expect(setIc(t.db, await cur(), "approved", P, {})).rejects.toThrow(/rationale/);
    await setIc(t.db, await cur(), "approved", P, { rationale: "Approved subject to offtake", conditions: "Term sheet before capital commitment" });
    expect((await cur()).icStatus).toBe("approved");
  });
});

describe("actions and memo", () => {
  it("converts findings into a task, a risk (with a chosen category) and a decision, once each", async () => {
    const r = await fresh();
    const e = await addEvidence(t.db, r, { title: "Study", evidenceClass: "primary", source: "Utility" }, A);
    const f1 = await addFinding(t.db, r, { kind: "finding", finding: "Upgrade cost unconfirmed", resolution: "Request the facilities study", evidenceIds: [e.id] }, A);
    const f2 = await addFinding(t.db, r, { kind: "red_flag", finding: "Curtailment exposure", severity: "high", evidenceIds: [e.id] }, A);
    const f3 = await addFinding(t.db, r, { kind: "recommendation", finding: "Add 2h BESS", evidenceIds: [] }, A);
    expect(await convertFinding(t.db, r, f1.id, "task", A)).toMatch(/^task:/);
    await expect(convertFinding(t.db, r, f1.id, "task", A)).rejects.toThrow(/Already/);
    await expect(convertFinding(t.db, r, f2.id, "risk", A)).rejects.toThrow(/category/);
    expect(await convertFinding(t.db, r, f2.id, "risk", A, { riskCategory: "offtake" })).toMatch(/^risk:/);
    expect(await convertFinding(t.db, r, f3.id, "decision", A)).toMatch(/^decision:/);
    const [risk] = await t.db.select().from(risks);
    expect(risk).toMatchObject({ projectId, category: "offtake", impact: "high" });
  });

  it("numbers sources by first citation and lists open questions", async () => {
    const r = await fresh();
    const a = await addEvidence(t.db, r, { title: "A", evidenceClass: "primary", source: "x" }, A);
    const b = await addEvidence(t.db, r, { title: "B", evidenceClass: "secondary", source: "y" }, A);
    await addFinding(t.db, r, { kind: "finding", finding: "F1", evidenceIds: [b.id] }, A);
    await addFinding(t.db, r, { kind: "finding", finding: "F2", evidenceIds: [a.id, b.id] }, A);
    const m = memo((await loadRequest(t.db, r.id))!);
    expect(m.sources.map(s => [s.n, s.e.title])).toEqual([[1, "B"], [2, "A"]]);
    expect(m.findings.map(f => f.cites)).toEqual([[1], [1, 2]]);
    expect(m.open.length).toBeGreaterThan(10);
  });

  it("recognises human signers", () => {
    expect(isHuman("alan@regenera.bio")).toBe(true);
    expect(isHuman("claude:assistant")).toBe(false);
    expect(isHuman("ai@regenera.bio")).toBe(true);   // an address is a person; only actor prefixes like ai: are refused
    expect(isHuman("system")).toBe(false);
  });
});
