// Commercial pipeline on opportunities (deals), phase 29A. Each move is recorded in pipeline_stage_history with its reason
// and evidence. Gates: Scope agreed needs a Qualified decision, Proposal needs a sent version, Signed only comes from
// recording an agreement on an accepted version, closing needs a reason, and moving back or reopening needs a reason.
// A failed gate can be overridden with a written reason, except Signed.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { deals, offerProposals, offerProposalVersions, opportunityQualifications, pipelineStageHistory } from "@/db/schema";
import { audit } from "@/lib/audit";
import { COMMERCIAL_CLOSED, COMMERCIAL_FORWARD, COMMERCIAL_STAGES, FROM_DEAL_STAGE, PIPELINES, TO_DEAL_STAGE, type CommercialStage } from "./vocab";

type Deal = typeof deals.$inferSelect;
/** The commercial stage; when another part of the OS moved the board stage since, the board stage wins (no drift). */
export const commercialStageOf = (d: Pick<Deal, "commercialStage" | "stage">): CommercialStage => {
  const c = d.commercialStage as CommercialStage | null;
  if (c && c in COMMERCIAL_STAGES && TO_DEAL_STAGE[c] === d.stage) return c;
  return FROM_DEAL_STAGE[d.stage] ?? "need_identified";
};

export async function recordStage(db: Db, e: { mandateId: string; pipeline: keyof typeof PIPELINES; entityType: string; entityId: string; from: string | null; to: string; reason?: string; evidence?: string; override?: boolean; by: string }) {
  await db.insert(pipelineStageHistory).values({ mandateId: e.mandateId, pipeline: e.pipeline, entityType: e.entityType, entityId: e.entityId, fromStage: e.from, toStage: e.to, reason: e.reason ?? "", evidence: e.evidence ?? "", override: !!e.override, by: e.by });
}

export const stageHistory = (db: Db, entityType: string, entityId: string) =>
  db.select().from(pipelineStageHistory).where(and(eq(pipelineStageHistory.entityType, entityType), eq(pipelineStageHistory.entityId, entityId))).orderBy(asc(pipelineStageHistory.at));

/** What stops a deal entering a stage (empty = allowed). */
export async function commercialGates(db: Db, deal: Deal, to: CommercialStage, reason: string): Promise<string[]> {
  const from = commercialStageOf(deal);
  const out: string[] = [];
  if (to === "signed") return ["Signed is set by recording the agreement on an accepted proposal version."];
  if (COMMERCIAL_CLOSED.includes(to) && !reason.trim()) out.push(`${COMMERCIAL_STAGES[to]} needs a reason.`);
  const back = COMMERCIAL_FORWARD.indexOf(to) >= 0 && COMMERCIAL_FORWARD.indexOf(from) > COMMERCIAL_FORWARD.indexOf(to);
  if ((back || COMMERCIAL_CLOSED.includes(from)) && !reason.trim()) out.push(COMMERCIAL_CLOSED.includes(from) ? "Reopening needs a reason." : "Moving back needs a reason.");
  if (from === "signed") out.push("A signed opportunity is managed on its engagement.");
  if (to === "scope_agreed" || to === "proposal" || to === "negotiation") {
    const [q] = await db.select({ decision: opportunityQualifications.decision }).from(opportunityQualifications).where(eq(opportunityQualifications.dealId, deal.id));
    if (q?.decision !== "qualified") out.push("The opportunity is not qualified yet (record the qualification decision).");
  }
  if (to === "proposal" || to === "negotiation") {
    const ps = await db.select({ id: offerProposals.id }).from(offerProposals).where(eq(offerProposals.dealId, deal.id));
    const sent = ps.length ? await db.select({ id: offerProposalVersions.id }).from(offerProposalVersions).where(and(inArray(offerProposalVersions.proposalId, ps.map(p => p.id)), inArray(offerProposalVersions.status, ["sent", "accepted", "declined", "superseded"]))) : [];
    if (!sent.length) out.push("No proposal version has been sent.");
  }
  return out;
}

/** Moves a deal on the commercial pipeline. `override` passes failed gates when a reason is written (never Signed). */
export async function moveCommercialStage(db: Db, dealId: string, to: CommercialStage, input: { reason?: string; evidence?: string; override?: boolean }, by: string) {
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw new Error("Opportunity not found");
  const from = commercialStageOf(deal);
  if (from === to) return deal;
  const reason = (input.reason ?? "").trim();
  const blockers = await commercialGates(db, deal, to, reason);
  const hard = blockers.filter(b => /Signed is set|managed on its engagement|needs a reason/.test(b));
  if (hard.length || (blockers.length && !(input.override && reason.length >= 5))) throw new Error(blockers.join(" "));
  await setDealStage(db, deal, to, by);
  await recordStage(db, { mandateId: deal.mandateId, pipeline: "commercial", entityType: "deal", entityId: deal.id, from, to, reason, evidence: input.evidence, override: blockers.length > 0, by });
  await audit(db, { actor: by, action: "commercial_stage", entity: "deals", entityId: deal.id, before: { stage: from }, after: { stage: to, override: blockers.length > 0 } });
  return { ...deal, commercialStage: to };
}

/** Writes the stage and keeps the older deal stage in step for the existing board and reports. */
export async function setDealStage(db: Db, deal: Pick<Deal, "id" | "lostReason">, to: CommercialStage, _by: string, lostReason?: string) {
  const t = new Date().toISOString();
  await db.update(deals).set({ commercialStage: to, stage: TO_DEAL_STAGE[to] as Deal["stage"], stageChangedAt: t, lostReason: COMMERCIAL_CLOSED.includes(to) ? lostReason ?? deal.lostReason : deal.lostReason, updatedAt: t }).where(eq(deals.id, deal.id));
}
