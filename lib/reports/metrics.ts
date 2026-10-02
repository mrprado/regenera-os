// Reports (SPEC section 14). Every figure is computed from the CRM tables for one period and a set of mandates.
// Small volumes (hundreds to low thousands of rows), so rows are read once and grouped in memory.
import { and, desc, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, deals, deliverabilityChecks, messages, partners, replies, segments, triggers } from "@/db/schema";
import { inChunks } from "@/lib/db/chunk";
import { DEAL_STAGES } from "@/lib/vocab";

export type Period = { from: string; to: string }; // ISO, [from, to)
export type RateRow = { key: string; sent: number; replies: number; positive: number; replyRate: number; positiveRate: number };

const POSITIVE = new Set(["interested", "question", "referral"]);
const NOT_A_REPLY = new Set(["out_of_office", "bounce"]);
/** Default win probability by stage when a deal has none set. */
export const STAGE_PROBABILITY: Partial<Record<keyof typeof DEAL_STAGES, number>> = {
  lead: 5, contacted: 10, engaged: 20, call_booked: 30, proposal: 50, signed: 90, active: 100, expansion: 100, nurture: 5,
};
const WON = new Set(["signed", "active", "expansion", "completed"]);

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function rates(groups: Map<string, { sent: number; replies: number; positive: number }>): RateRow[] {
  return [...groups.entries()].map(([key, g]) => ({ key, ...g, replyRate: pct(g.replies, g.sent), positiveRate: pct(g.positive, g.sent) }))
    .sort((a, b) => b.sent - a.sent);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function computeMetrics(db: Db, mandateIds: string[], p: Period) {
  if (!mandateIds.length) mandateIds = ["__none__"];
  // Independent reads start together; each is awaited where it is used (fewer sequential D1 round trips).
  const trigP = db.select({ id: triggers.id, type: triggers.type, createdAt: triggers.createdAt }).from(triggers)
    .where(and(inArray(triggers.mandateId, mandateIds), gte(triggers.createdAt, new Date(Date.parse(p.from) - 90 * 86_400_000).toISOString())));
  const allDealsP = db.select({ id: deals.id, stage: deals.stage, practice: deals.practice, feeType: deals.feeType, engagement: deals.engagement, value: deals.valueEstimate, probability: deals.probability,
    source: deals.source, partnerId: deals.partnerId, stageChangedAt: deals.stageChangedAt }).from(deals)
    .where(and(inArray(deals.mandateId, mandateIds), notInArray(deals.stage, ["churned"])));
  const partnerRowsP = db.select({ id: partners.id, tier: partners.tier }).from(partners).where(inArray(partners.mandateId, mandateIds));
  const checksP = db.select().from(deliverabilityChecks).orderBy(desc(deliverabilityChecks.checkedAt)).limit(20);
  // ---------- outreach ----------
  const sent = await db.select({
    id: messages.id, contactId: messages.contactId, tier: messages.tier, angle: messages.angleTag, sentAt: messages.sentAt,
    source: contacts.source, segment: segments.name, triggerType: triggers.type, language: contacts.language,
  }).from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .leftJoin(segments, eq(segments.id, contacts.segmentId))
    .leftJoin(triggers, eq(triggers.id, contacts.sourceTriggerId))
    .where(and(inArray(messages.mandateId, mandateIds), eq(messages.channel, "email"), eq(messages.direction, "out"), eq(messages.status, "sent"), gte(messages.sentAt, p.from), lt(messages.sentAt, p.to)));
  const contactIds = [...new Set(sent.map(s => s.contactId))];
  const reps = contactIds.length ? await db.select({ contactId: replies.contactId, cls: replies.classification, messageId: replies.messageId }).from(replies)
    .where(and(inArray(replies.mandateId, mandateIds), gte(replies.receivedAt, p.from))) : [];
  // A contact counts once per dimension: did they reply (at all / positively) after being emailed in the period.
  const replied = new Map<string, { any: boolean; positive: boolean }>();
  for (const r of reps) {
    if (!r.contactId || !r.cls || NOT_A_REPLY.has(r.cls)) continue;
    const cur = replied.get(r.contactId) ?? { any: false, positive: false };
    replied.set(r.contactId, { any: true, positive: cur.positive || POSITIVE.has(r.cls) });
  }
  const dims = { segment: (s: (typeof sent)[number]) => s.segment ?? "No segment", funnel: (s: (typeof sent)[number]) => s.source, triggerType: (s: (typeof sent)[number]) => s.triggerType ?? "No trigger",
    angle: (s: (typeof sent)[number]) => s.angle ?? "Manual", tier: (s: (typeof sent)[number]) => s.tier ?? "manual", language: (s: (typeof sent)[number]) => s.language ?? "Unknown" };
  const byDim: Record<keyof typeof dims, RateRow[]> = {} as never;
  for (const [name, fn] of Object.entries(dims) as [keyof typeof dims, (s: (typeof sent)[number]) => string][]) {
    const g = new Map<string, { sent: number; replies: number; positive: number; seen: Set<string> }>();
    for (const s of sent) {
      const k = fn(s);
      const cur = g.get(k) ?? { sent: 0, replies: 0, positive: 0, seen: new Set<string>() };
      cur.sent++;
      if (!cur.seen.has(s.contactId)) {
        cur.seen.add(s.contactId);
        const r = replied.get(s.contactId);
        if (r?.any) cur.replies++;
        if (r?.positive) cur.positive++;
      }
      g.set(k, cur);
    }
    byDim[name] = rates(new Map([...g.entries()].map(([k, v]) => [k, { sent: v.sent, replies: v.replies, positive: v.positive }])));
  }
  const totalReplied = contactIds.filter(id => replied.get(id)?.any).length;
  const totalPositive = contactIds.filter(id => replied.get(id)?.positive).length;

  // Scoping calls per 100 contacts emailed in the period.
  const meetings = contactIds.length ? await db.select({ contactId: activities.contactId }).from(activities)
    .where(and(inArray(activities.mandateId, mandateIds), eq(activities.type, "meeting"), gte(activities.occurredAt, p.from))) : [];
  const met = new Set(meetings.map(m => m.contactId).filter((x): x is string => !!x && contactIds.includes(x)));

  // ---------- trigger to first touch ----------
  const trig = await trigP;
  const firstTouch = new Map<string, number[]>();
  if (trig.length) {
    const touched = await inChunks(trig.map(t => t.id), ids => db.select({ triggerId: contacts.sourceTriggerId, sentAt: messages.sentAt }).from(messages)
      .innerJoin(contacts, eq(contacts.id, messages.contactId))
      .where(and(inArray(contacts.sourceTriggerId, ids), eq(messages.status, "sent"), gte(messages.sentAt, p.from), lt(messages.sentAt, p.to))), 80);
    const first = new Map<string, string>();
    for (const t of touched) if (t.triggerId && t.sentAt && (!first.has(t.triggerId) || t.sentAt < first.get(t.triggerId)!)) first.set(t.triggerId, t.sentAt);
    for (const t of trig) {
      const f = first.get(t.id);
      if (!f) continue;
      firstTouch.set(t.type, [...(firstTouch.get(t.type) ?? []), (Date.parse(f) - Date.parse(t.createdAt)) / 3_600_000]);
    }
  }

  // ---------- pipeline ----------
  const allDeals = await allDealsP;
  const open = allDeals.filter(d => !["lost", "completed"].includes(d.stage));
  const weight = (d: (typeof allDeals)[number]) => (d.value ?? 0) * ((d.probability ?? STAGE_PROBABILITY[d.stage] ?? 0) / 100);
  const pipeline = (key: (d: (typeof allDeals)[number]) => string) => {
    const g = new Map<string, { deals: number; value: number; weighted: number }>();
    for (const d of open) {
      const k = key(d);
      const cur = g.get(k) ?? { deals: 0, value: 0, weighted: 0 };
      g.set(k, { deals: cur.deals + 1, value: cur.value + (d.value ?? 0), weighted: cur.weighted + weight(d) });
    }
    return [...g.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.weighted - a.weighted);
  };
  // Win rate: deals that closed (won or lost) during the period, by engagement.
  const closed = allDeals.filter(d => d.stageChangedAt >= p.from && d.stageChangedAt < p.to && (WON.has(d.stage) || d.stage === "lost"));
  const winBy = new Map<string, { won: number; lost: number }>();
  for (const d of closed) {
    const cur = winBy.get(d.engagement) ?? { won: 0, lost: 0 };
    if (WON.has(d.stage)) cur.won++; else cur.lost++;
    winBy.set(d.engagement, cur);
  }

  // ---------- Partner Network ----------
  const refDeals = allDeals.filter(d => d.source === "referral");
  const partnerRows = await partnerRowsP;
  const tierOf = new Map(partnerRows.map(r => [r.id, r.tier]));
  const byTier = new Map<string, { referrals: number; won: number; lost: number }>();
  for (const d of refDeals) {
    const tier = (d.partnerId && tierOf.get(d.partnerId)) || "unknown";
    const cur = byTier.get(tier) ?? { referrals: 0, won: 0, lost: 0 };
    cur.referrals++;
    if (WON.has(d.stage)) cur.won++;
    if (d.stage === "lost") cur.lost++;
    byTier.set(tier, cur);
  }

  // ---------- deliverability ----------
  const checks = await checksP;
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!latest.has(c.domain)) latest.set(c.domain, c);

  return {
    period: p,
    outreach: {
      emailsSent: sent.length, contactsEmailed: contactIds.length, replied: totalReplied, positive: totalPositive,
      replyRate: pct(totalReplied, contactIds.length), positiveRate: pct(totalPositive, contactIds.length),
      callsPer100: contactIds.length ? Math.round((met.size / contactIds.length) * 1000) / 10 : 0,
      byDim,
    },
    triggerToFirstTouchHours: [...firstTouch.entries()].map(([type, hrs]) => ({ type, triggers: hrs.length, medianHours: Math.round((median(hrs) ?? 0) * 10) / 10 })),
    pipeline: {
      openDeals: open.length, value: open.reduce((a, d) => a + (d.value ?? 0), 0), weighted: Math.round(open.reduce((a, d) => a + weight(d), 0)),
      byStage: pipeline(d => d.stage), byPractice: pipeline(d => d.practice ?? "Unassigned"), byFeeType: pipeline(d => d.feeType),
    },
    winRate: [...winBy.entries()].map(([engagement, v]) => ({ engagement, ...v, rate: pct(v.won, v.won + v.lost) })),
    partners: [...byTier.entries()].map(([tier, v]) => ({ tier, ...v, conversion: pct(v.won, v.referrals) })),
    deliverability: [...latest.values()].map(c => ({ domain: c.domain, spf: c.spf, dkim: c.dkim, dmarc: c.dmarc, mx: c.mx, bounceRate: c.bounceRate, complaints: c.complaints, checkedAt: c.checkedAt })),
  };
}
export type Metrics = Awaited<ReturnType<typeof computeMetrics>>;
