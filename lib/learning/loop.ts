// Learning loop (SPEC section 14, docs/plans/phase-4.md item 3). Monthly. Proposals only: nothing changes until an
// owner approves it on the Reports screen. Thresholds keep it from reacting to noise.
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { caseRecords, contacts, deals, messages, proposals, replies, scores, segments, sequences } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { scoringWeights } from "@/lib/crm/research";
import { inChunks } from "@/lib/db/chunk";

export const MIN_SENDS_PER_ANGLE = 50;
export const MIN_CLOSED_FOR_WEIGHTS = 20;
const POSITIVE = new Set(["interested", "question", "referral"]);
const WON = ["signed", "active", "expansion", "completed"];

export type AngleStat = { segmentId: string; segment: string; angle: string; sent: number; replied: number; positive: number };

/** Per segment and angle over the last 180 days. A contact counts once per angle. */
export async function angleStats(db: Db, mandateId: string, now = new Date()): Promise<AngleStat[]> {
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
  const sent = await db.select({ contactId: messages.contactId, angle: messages.angleTag, segmentId: contacts.segmentId, segment: segments.name }).from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId)).innerJoin(segments, eq(segments.id, contacts.segmentId))
    .where(and(eq(messages.mandateId, mandateId), eq(messages.status, "sent"), eq(messages.channel, "email"), gte(messages.sentAt, since), isNotNull(messages.angleTag)));
  const rep = await db.select({ contactId: replies.contactId, cls: replies.classification }).from(replies).where(and(eq(replies.mandateId, mandateId), gte(replies.receivedAt, since)));
  const replied = new Map<string, boolean>();
  for (const r of rep) if (r.contactId && r.cls && r.cls !== "out_of_office" && r.cls !== "bounce") replied.set(r.contactId, (replied.get(r.contactId) ?? false) || POSITIVE.has(r.cls));
  const g = new Map<string, AngleStat & { seen: Set<string> }>();
  for (const s of sent) {
    const k = `${s.segmentId}|${s.angle}`;
    const cur = g.get(k) ?? { segmentId: s.segmentId!, segment: s.segment, angle: s.angle!, sent: 0, replied: 0, positive: 0, seen: new Set<string>() };
    cur.sent++;
    if (!cur.seen.has(s.contactId)) {
      cur.seen.add(s.contactId);
      if (replied.has(s.contactId)) cur.replied++;
      if (replied.get(s.contactId)) cur.positive++;
    }
    g.set(k, cur);
  }
  return [...g.values()].map(x => ({ segmentId: x.segmentId, segment: x.segment, angle: x.angle, sent: x.sent, replied: x.replied, positive: x.positive }));
}

const zLearning = z.object({
  proposals: z.array(z.object({
    kind: z.enum(["angle", "timing"]),
    segment_key: z.string(),
    title: z.string(),
    rationale: z.string(),
    new_angle: z.string().describe("For kind angle: the new one-sentence angle, including subject-line guidance"),
    step_days: z.array(z.number().int().min(0).max(60)).describe("For kind timing: the new day offsets, same count as the current steps"),
  })),
});

/** Proposes angle and timing changes where at least one angle in a segment has 50+ sends. */
export async function proposeOutreachChanges(db: Db, cfg: AiConfig, mandateId: string, now = new Date(), client?: Anthropic) {
  const stats = await angleStats(db, mandateId, now);
  const eligible = stats.filter(s => s.sent >= MIN_SENDS_PER_ANGLE);
  if (!eligible.length) return 0;
  const segIds = [...new Set(eligible.map(e => e.segmentId))];
  const segs = await db.select().from(segments).where(inArray(segments.id, segIds));
  const seqs = await db.select().from(sequences).where(eq(sequences.mandateId, mandateId));
  const input = [
    `Segments with enough data (at least ${MIN_SENDS_PER_ANGLE} emails on an angle, last 180 days):`,
    ...segs.map(s => {
      const rows = stats.filter(x => x.segmentId === s.id);
      return `- ${s.key} (${s.name}). Current angle: "${s.angle}". Entry offer: ${s.entryOffer}.\n${rows.map(r => `  angle "${r.angle}": ${r.sent} sent, ${r.replied} replied, ${r.positive} positive`).join("\n")}`;
    }),
    `Current sequences:\n${seqs.map(q => `- ${q.key}: days ${q.steps.map(x => x.day).join(", ")}`).join("\n")}`,
    `Propose at most 3 changes. Only propose where the numbers support it. Timing proposals must keep the same number of steps.`,
  ].join("\n\n");
  const out = await runStructured(db, cfg, "learning.review", input, zLearning, { entity: "mandate", entityId: mandateId }, client);
  let n = 0;
  for (const p of out.proposals.slice(0, 3)) {
    const seg = segs.find(s => s.key === p.segment_key);
    if (!seg) continue;
    const evidence = { stats: stats.filter(x => x.segmentId === seg.id), rationale: p.rationale };
    if (p.kind === "angle" && p.new_angle.trim()) {
      await db.insert(proposals).values({ mandateId, kind: "angle", source: "learning", title: p.title, evidence, change: { action: "segment_angle", args: { segmentId: seg.id, before: seg.angle, after: p.new_angle.trim() } }, createdBy: "learning-loop" });
      n++;
    } else if (p.kind === "timing") {
      const seq = seqs.find(q => q.segmentId === seg.id) ?? seqs.find(q => q.key === "targeted_default");
      if (!seq || p.step_days.length !== seq.steps.length) continue;
      await db.insert(proposals).values({ mandateId, kind: "timing", source: "learning", title: p.title, evidence, change: { action: "sequence_timing", args: { sequenceId: seq.id, before: seq.steps.map(x => x.day), after: p.step_days } }, createdBy: "learning-loop" });
      n++;
    }
  }
  return n;
}

/**
 * Scoring weights: compares the average fit, trigger and access scores of won versus lost deals' contacts.
 * Deterministic, no model. Moves each weight halfway toward the separation it shows, within 0.15 to 0.6.
 */
export async function proposeWeights(db: Db, mandateId: string) {
  const closed = await db.select({ stage: deals.stage, contactId: deals.contactId }).from(deals)
    .where(and(eq(deals.mandateId, mandateId), sql`${deals.stage} in ('signed','active','expansion','completed','lost')`, isNotNull(deals.contactId)));
  if (closed.length < MIN_CLOSED_FOR_WEIGHTS) return null;
  // Latest score per contact; chunked for D1's parameter limit.
  const all = await inChunks([...new Set(closed.map(c => c.contactId!))], ids => db.select({ contactId: scores.contactId, fit: scores.fit, trigger: scores.trigger, access: scores.access, at: scores.scoredAt }).from(scores)
    .where(inArray(scores.contactId, ids)));
  const latest = new Map<string, (typeof all)[number]>();
  for (const r of all) if (!latest.has(r.contactId) || r.at > latest.get(r.contactId)!.at) latest.set(r.contactId, r);
  const sc = [...latest.values()];
  const avg = (rows: typeof sc, k: "fit" | "trigger" | "access") => (rows.length ? rows.reduce((a, r) => a + r[k], 0) / rows.length : 0);
  const wonIds = new Set(closed.filter(c => WON.includes(c.stage)).map(c => c.contactId));
  const won = sc.filter(s => wonIds.has(s.contactId)), lost = sc.filter(s => !wonIds.has(s.contactId));
  if (won.length < 5 || lost.length < 5) return null;
  const sep = { fit: Math.max(0, avg(won, "fit") - avg(lost, "fit")), trigger: Math.max(0, avg(won, "trigger") - avg(lost, "trigger")), access: Math.max(0, avg(won, "access") - avg(lost, "access")) };
  const total = sep.fit + sep.trigger + sep.access;
  if (total <= 0) return null;
  const current = await scoringWeights(db);
  const clamp = (x: number) => Math.min(0.6, Math.max(0.15, x));
  const raw = { fit: clamp((current.fit + sep.fit / total) / 2), trigger: clamp((current.trigger + sep.trigger / total) / 2), access: clamp((current.access + sep.access / total) / 2) };
  const sum = raw.fit + raw.trigger + raw.access;
  const next = { fit: Math.round((raw.fit / sum) * 100) / 100, trigger: Math.round((raw.trigger / sum) * 100) / 100, access: 0 };
  next.access = Math.round((1 - next.fit - next.trigger) * 100) / 100;
  if (Math.abs(next.fit - current.fit) + Math.abs(next.trigger - current.trigger) + Math.abs(next.access - current.access) < 0.06) return null;
  const [p] = await db.insert(proposals).values({
    mandateId, kind: "weights", source: "learning", title: `Scoring weights: fit ${next.fit}, trigger ${next.trigger}, access ${next.access}`,
    evidence: { closed: closed.length, won: won.length, lost: lost.length, averages: { won: { fit: avg(won, "fit"), trigger: avg(won, "trigger"), access: avg(won, "access") }, lost: { fit: avg(lost, "fit"), trigger: avg(lost, "trigger"), access: avg(lost, "access") } } },
    change: { action: "scoring_weights", args: { before: current, after: next } }, createdBy: "learning-loop",
  }).returning();
  return p;
}

/** Engagement ladder: won and lost by entry engagement, with lost reasons. Informational proposal. */
export async function ladderSummary(db: Db, mandateId: string) {
  const rows = await db.select({ engagement: deals.engagement, stage: deals.stage, lostReason: deals.lostReason }).from(deals)
    .where(and(eq(deals.mandateId, mandateId), sql`${deals.stage} in ('signed','active','expansion','completed','lost')`));
  if (rows.length < 5) return null;
  const by = new Map<string, { won: number; lost: number; reasons: string[] }>();
  for (const r of rows) {
    const cur = by.get(r.engagement) ?? { won: 0, lost: 0, reasons: [] };
    if (r.stage === "lost") { cur.lost++; if (r.lostReason) cur.reasons.push(r.lostReason); } else cur.won++;
    by.set(r.engagement, cur);
  }
  const summary = [...by.entries()].map(([engagement, v]) => ({ engagement, ...v, reasons: v.reasons.slice(0, 5) }));
  const [p] = await db.insert(proposals).values({ mandateId, kind: "ladder", source: "learning", title: "Engagement ladder: which entry offers convert", evidence: { summary }, change: { action: "acknowledge", args: {} }, createdBy: "learning-loop" }).returning();
  return p;
}

/** Won deals without a case record get one to fill in (private until disclosure is authorized). */
export async function ensureCaseRecords(db: Db, mandateId: string) {
  const won = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.mandateId, mandateId), inArray(deals.stage, ["signed", "active", "expansion", "completed"])));
  for (const d of won) await db.insert(caseRecords).values({ mandateId, dealId: d.id }).onConflictDoNothing();
  return won.length;
}

