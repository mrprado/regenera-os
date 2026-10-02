// Mandate → Universe → Match → Qualify → Approve → Pursue against local D1 (docs/plans/phase-14-mandates.md):
// queue rows become screened candidates; the machine stops at pre-qualified; human checks need a basis; the client's
// response fixes attribution and records an approval; a pursuit only opens after approval; a Go is refused over a
// blocker; another workspace sees nothing; queue changes become labelled signals.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvals, mandateCandidates, mandateSignals, pursuits } from "@/db/schema";
import { advanceCandidate, buildUniverse, buildUniverseSlice, clientRespond, getWork, createMandate, createPursuit, decideApproval, decideBid, deliveryFloor, mandateEconomics, movePursuit, recordCheck, requestApproval, saveBidCriteria, signalsFromQueueChanges } from "@/lib/mandates/engine";
import { candidateDetail, mandateById, mandateCommand } from "@/lib/mandates/queries";
import { upsertQueue, type QueueRow } from "@/lib/mandates/queues";
import { enqueue } from "@/lib/jobs/queue";
import { runJobsOfTypes } from "@/lib/jobs/tick";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const WS = "mandate_regenera", U = "lead@regenera.bio";
const scope = { kind: "user" as const, userId: "u", email: U, mandateIds: [WS], ownerOf: [WS] } as never;
const other = { kind: "user" as const, userId: "o", email: "x@client.com", mandateIds: ["mandate_other"], ownerOf: ["mandate_other"] } as never;
const row = (n: string, over: Partial<QueueRow> = {}): QueueRow => ({ key: `SPP:${n}`, iso: "SPP", number: n, state: "OK", county: "Blaine", poi: "Sub", transmissionOwner: "OGE", fuel: "Solar", technology: "solar", mw: 200, mwWinter: 200, queueDate: "2023-01-01", inServiceDate: "2028-06-01", withdrawnDate: null, status: "IA FULLY EXECUTED/ON SCHEDULE", studyPhase: "", iaStatus: "IA FULLY EXECUTED/ON SCHEDULE", raw: {}, ...over });

describe("mandate engine", () => {
  let mId = "", candId = "";
  it("builds a universe from public queue rows and stops the machine at pre-qualified", async () => {
    await upsertQueue(t.db, [row("T-1"), row("T-2", { mw: 20 }), row("T-3", { technology: "wind", fuel: "Wind" }), row("T-4", { status: "IA FULLY EXECUTED/COMMERCIAL OPERATION", iaStatus: "IA FULLY EXECUTED/COMMERCIAL OPERATION" })]);
    const m = await createMandate(t.db, { mandateId: WS, name: "Test EPC pilot", type: "epc_origination", technologies: ["solar", "bess"], geography: { isos: ["SPP"] }, criteria: { minSolarMw: 50, minStorageMw: 50, stages: ["late_development"], procurementHorizonMonths: 30 }, deliveryFloor: [{ metric: "screened", target: 2, period: "month" }], retainer: 15000, termMonths: 3, status: "active" }, U);
    mId = m.id;
    const r = await buildUniverse(t.db, m.id, U, new Date("2026-09-30T00:00:00Z"));
    expect(r.created).toBe(2); // wind excluded by technology; operating position excluded
    const cands = await t.db.select().from(mandateCandidates).where(eq(mandateCandidates.commercialMandateId, m.id));
    const big = cands.find(c => c.entityId === "SPP:T-1")!, small = cands.find(c => c.entityId === "SPP:T-2")!;
    candId = big.id;
    expect(big.stage).toBe("pre_qualified");
    expect(small.stage).toBe("screened");
    expect(small.checks.size.met).toBe("no");
    expect(big.estValueBasis).toMatch(/^Inference/);
    expect(big.evidence[0].kind).toBe("source");
    // rerun keeps a stable universe
    expect((await buildUniverse(t.db, m.id, U, new Date("2026-09-30T00:00:00Z"))).created).toBe(0);
  });

  it("builds in slices as chained background jobs, recording progress, with batched writes", async () => {
    const one = await buildUniverseSlice(t.db, mId, U, new Date("2026-09-30T00:00:00Z"), { offset: 0, limit: 1 });
    expect(one.next).toBe(1);
    expect((await buildUniverseSlice(t.db, mId, U, new Date("2026-09-30T00:00:00Z"), { offset: 1, limit: 1 })).next).toBeNull();
    await enqueue(t.db, "mandates.universe", { id: mId, offset: 0, actor: U });
    const r = await runJobsOfTypes(t.db, ["mandates.universe"], { budgetMs: 20_000 });
    expect(r.more).toBe(false);
    const w = await getWork(t.db, mId);
    expect(w?.phase).toBe("done");
    expect(w?.total).toBe(2);
  });

  it("requires a person and a basis for checks, and the stage's criteria for advancement", async () => {
    await expect(recordCheck(t.db, candId, "sponsor", "yes", "County filing", "system:job")).rejects.toThrow(/person/);
    await expect(recordCheck(t.db, candId, "sponsor", "yes", "", U)).rejects.toThrow(/basis/);
    const blocked = await advanceCandidate(t.db, candId, "qualified", U, "try");
    expect(blocked.ok).toBe(false);
    for (const k of ["sponsor", "epc_open", "blockers"]) await recordCheck(t.db, candId, k, "yes", `Recorded ${k} from a county filing and a call`, U);
    expect((await advanceCandidate(t.db, candId, "qualified", U, "Criteria met")).ok).toBe(true);
  });

  it("refuses a pursuit before the client approves; approval fixes attribution and records the decision", async () => {
    await expect(createPursuit(t.db, candId, U)).rejects.toThrow(/client approves/);
    await clientRespond(t.db, candId, "approve", "client@emc.example", "Pursue");
    const [c] = await t.db.select().from(mandateCandidates).where(eq(mandateCandidates.id, candId));
    expect(c.attribution).toBe("regenera_originated");
    expect(c.stage).toBe("approved");
    const ap = await t.db.select().from(approvals).where(eq(approvals.entityId, candId));
    expect(ap[0].status).toBe("approved");
    expect(ap[0].decidedBy).toBe("client@emc.example");
  });

  it("opens the pursuit, enforces bid / no-bid, and refuses a Go over a blocker", async () => {
    const pid = await createPursuit(t.db, candId, U);
    await expect(movePursuit(t.db, pid, "bid", U, "Submitting")).rejects.toThrow(/bid \/ no-bid/);
    await saveBidCriteria(t.db, pid, { bonding: { rating: "blocker", note: "Above bonding capacity" } }, U);
    await expect(decideBid(t.db, pid, "go", "Strong fit", U)).rejects.toThrow(/Blockers/);
    await decideBid(t.db, pid, "conditional_go", "Go if a surety partner covers bonding", U);
    await movePursuit(t.db, pid, "rfp", U, "RFP received", "RFP ref 123");
    const [p] = await t.db.select().from(pursuits).where(eq(pursuits.id, pid));
    expect(p.stage).toBe("rfp");
    expect(p.attribution).toBe("regenera_originated");
    expect(p.stageHistory.at(-1)!.evidence).toBe("RFP ref 123");
  });

  it("approvals are decided by the named approver, with a rationale", async () => {
    const a = await requestApproval(t.db, { mandateId: WS, kind: "outreach", entityType: "commercial_mandates", entityId: mId, title: "Approach sponsor", approver: "boss@regenera.bio" }, U);
    await expect(decideApproval(t.db, a.id, "approved", "ok", "", U)).rejects.toThrow(/Assigned/);
    await expect(decideApproval(t.db, a.id, "approved", "", "", "boss@regenera.bio")).rejects.toThrow(/rationale/);
    await decideApproval(t.db, a.id, "approved", "Within the approved list", "", "boss@regenera.bio");
  });

  it("queue changes become signals; IA progress is labelled as inference", async () => {
    const changes = await upsertQueue(t.db, [row("T-1", { inServiceDate: "2028-12-01" })]);
    expect(changes.some(c => c.field === "inServiceDate")).toBe(true);
    expect(await signalsFromQueueChanges(t.db, changes)).toBe(1);
    expect(await signalsFromQueueChanges(t.db, changes)).toBe(0); // deduplicated
    const [s] = await t.db.select().from(mandateSignals).where(eq(mandateSignals.candidateId, candId));
    expect(s.kind).toBe("cod_change");
  });

  it("scopes every read to the user's workspaces and computes delivery and economics from records", async () => {
    expect(await mandateById(t.db, other, mId)).toBeNull();
    expect(await candidateDetail(t.db, other, candId)).toBeNull();
    expect((await mandateCommand(t.db, other)).mandates.length).toBe(0);
    const m = (await mandateById(t.db, scope, mId))!;
    const d = await deliveryFloor(t.db, m, "2026-09"); // the universe was screened at 2026-09-30
    expect(d.lines[0].delivered).toBe(2);
    const e = await mandateEconomics(t.db, m);
    expect(e.monthlyRevenue).toBe(15000);
    expect(e.seats.length).toBeGreaterThan(0);
    expect(e.successNote).toMatch(/No success component/);
  });
});
