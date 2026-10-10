// AI-drafted Steward place assessments (phase 28D). The OS builds an evidence pack from authorised records with ids;
// the model writes facts (each citing ids), interpretations, gaps and one next action; citations to unknown ids are
// refused; the result is saved as a draft for review. Governed knowledge enters the pack only when its custodian has
// allowed AI summarisation, and each use is recorded so a withdrawal invalidates the draft.
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { careActions, carePlans, knowledgeRecords, knowledgeUses, stewardDrafts, stewardPlaces, stewardSourceRecords } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { checkPermission } from "@/lib/community/engine";
import type { UserScope } from "@/lib/db/scoped";
import { canSeeKnowledge, currentAssessments, indicatorsFor } from "./engine";
import { ASSESSMENT_DIMENSIONS, ASSESSMENT_STATUS } from "./vocab";

export const zDraft = z.object({
  facts: z.array(z.object({ statement: z.string(), evidence: z.array(z.string()).min(1) })),
  interpretations: z.array(z.object({ statement: z.string(), wouldConfirm: z.string() })),
  gaps: z.array(z.string()),
  nextAction: z.string(),
});
export type DraftContent = z.infer<typeof zDraft>;

/** The evidence pack: every item has an id the draft must cite. */
export async function evidencePack(db: Db, scope: UserScope, placeId: string, now = new Date()) {
  const [place] = await db.select().from(stewardPlaces).where(eq(stewardPlaces.id, placeId));
  if (!place || !scope.mandateIds.includes(place.mandateId)) throw new Error("Place not found");
  const items: { id: string; text: string }[] = [];
  items.push({ id: "P1", text: `Place "${place.name}": ${place.geometryAccuracy}${place.areaHa != null ? `, ${place.areaHa} ha geodesic` : place.geometry ? ", point only (no area)" : ", no geometry"}; ${[place.region, place.country].filter(Boolean).join(", ")}.` });
  (await currentAssessments(db, placeId)).forEach((a, i) => items.push({ id: `A${i + 1}`, text: `${ASSESSMENT_DIMENSIONS[a.dimension]}: ${ASSESSMENT_STATUS[a.status]}${a.basis ? `. Basis: ${a.basis}` : ""}${a.assessedAt ? ` (${a.assessedAt.slice(0, 10)})` : ""}` }));
  let m = 0;
  for (const ind of await indicatorsFor(db, placeId)) {
    for (const x of [ind.baseline, ind.latest].filter(Boolean)) items.push({ id: `M${++m}`, text: `${ind.name} (${ind.unit}) ${x!.kind}: ${x!.value} on ${x!.periodStart}; evidence: ${x!.evidence}; ${x!.reviewStatus}${x!.uncertainty ? `; uncertainty ${x!.uncertainty}` : ""}` });
  }
  const recs = await db.select().from(stewardSourceRecords).where(eq(stewardSourceRecords.placeId, placeId)).orderBy(desc(stewardSourceRecords.observedStart)).limit(400);
  const bySource = new Map<string, typeof recs>();
  for (const r of recs) bySource.set(r.sourceKey, [...(bySource.get(r.sourceKey) ?? []), r]);
  let sIdx = 0;
  for (const [key, rows] of bySource) {
    const latest = rows.find(r => r.observedStart)?.observedStart ?? "undated";
    const sample = key === "gbif_occurrence" ? `; taxa include ${[...new Set(rows.map(r => r.title))].slice(0, 12).join(", ")}` : key === "soilgrids" ? `; ${rows.slice(0, 9).map(r => `${r.title} ${r.value} ${r.unit}`).join("; ")}` : "";
    items.push({ id: `S${++sIdx}`, text: `${key}: ${rows.length} stored records, latest observation ${latest}${sample}. ${rows[0].method}` });
  }
  const plans = await db.select().from(carePlans).where(eq(carePlans.placeId, placeId));
  const acts = plans.length ? await db.select().from(careActions).where(inArray(careActions.planId, plans.map(p => p.id))) : [];
  const today = now.toISOString().slice(0, 10);
  items.push({ id: "C1", text: `${plans.length} care plans; ${acts.filter(a => a.status === "done").length} actions done, ${acts.filter(a => a.status !== "done" && a.status !== "cancelled").length} open, ${acts.filter(a => a.dueDate && a.dueDate < today && a.status !== "done" && a.status !== "cancelled").length} overdue.` });
  const knowledge: string[] = [];
  const ks = await db.select().from(knowledgeRecords).where(and(eq(knowledgeRecords.placeId, placeId), isNull(knowledgeRecords.deletedAt)));
  let k = 0;
  for (const r of ks) {
    if (!canSeeKnowledge(scope, r)) continue;
    const p = await checkPermission(db, r.id, "ai_summarization", now);
    if (!p.allowed || !r.descriptionPublic) continue;
    items.push({ id: `K${++k}`, text: `Governed knowledge (summarise only as given${p.conditions ? `; conditions: ${p.conditions}` : ""}): ${r.descriptionPublic}` });
    knowledge.push(r.id);
  }
  return { place, items, knowledge };
}

export async function draftPlaceAssessment(db: Db, cfg: AiConfig, scope: UserScope, placeId: string, actor: string, client?: Anthropic) {
  const pack = await evidencePack(db, scope, placeId);
  const ids = new Set(pack.items.map(i => i.id));
  const input = `Evidence pack (cite ids exactly):\n${pack.items.map(i => `${i.id}: ${i.text}`).join("\n")}`;
  const out = await runStructured(db, cfg, "steward.place_assessment", input, zDraft, { entity: "steward_place", entityId: placeId }, client);
  const unknown = out.facts.flatMap(f => f.evidence).filter(e => !ids.has(e));
  // A fact citing evidence that does not exist is dropped and listed, never kept.
  const content = { ...out, facts: out.facts.filter(f => f.evidence.every(e => ids.has(e))), droppedForUnknownEvidence: unknown };
  const [draft] = await db.insert(stewardDrafts).values({ mandateId: pack.place.mandateId, placeId, content, evidenceIds: [...ids], knowledgeIds: pack.knowledge, model: "claude-sonnet-5", createdBy: actor }).returning();
  for (const recordId of pack.knowledge) await db.insert(knowledgeUses).values({ mandateId: pack.place.mandateId, recordId, activity: "ai_summarization", outputType: "steward_draft", outputRef: draft.id, usedBy: actor, description: "Steward place assessment draft" });
  return draft;
}
