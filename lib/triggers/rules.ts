// Rules read for signals (phase 21 §1.1). When AI is unavailable (no key, budget or credit), signals still become
// triggers: the trigger type comes from the query that found the signal, relevance from Regenera's sector terms, and
// the organization only from the source itself (never guessed). Rules-read triggers say so in their decision read;
// signals the rules cannot place stay "new" for the AI classifier.
import { and, asc, eq, inArray, notLike, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { signals, triggerQueries, triggers } from "@/db/schema";
import { upsertOrganization } from "@/lib/crm/entities";
import { enqueue } from "@/lib/jobs/queue";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { TRIGGER_TYPES } from "@/lib/vocab";

type TriggerType = (typeof TRIGGER_TYPES)[number];

const SECTOR_TERMS: [RegExp, string][] = [
  [/\b(solar|photovoltaic|pv|wind|battery|storage|bess|hydro|geothermal|renewable|grid|transmission|substation|mw|gw)\b/i, "energy"],
  [/\b(water|watershed|river|aquifer|irrigation|desalination|wastewater|sanitation)\b/i, "water_food_nature"],
  [/\b(restoration|reforestation|forest|biodiversity|mangrove|agricultur|regenerative|soil|nature-based)\b/i, "water_food_nature"],
  [/\b(waste|landfill|recycling|circular|waste-to-energy|biogas|incinerat)/i, "waste_resource_systems"],
  [/\b(infrastructure|port|road|rail|bridge|resilien|public works|ppp|concession)\b/i, "infrastructure"],
  [/\b(real estate|urban|housing|masterplan|tourism|hospitality|brownfield)\b/i, "land_built_environment"],
];

const TYPE_TERMS: [RegExp, TriggerType][] = [
  [/\b(tender|procurement|rfp|request for proposals?|expression of interest|eoi|bid|invitation to)\b/i, "procurement"],
  [/\b(flood|earthquake|cyclone|hurricane|drought|wildfire|disaster|tsunami)\b/i, "crisis"],
  [/\b(loan|financing|investment|fund(ing)?|grant|bond|raises|equity|credit facility)\b/i, "capital"],
  [/\b(law|regulation|decree|permit|policy|ruling|licen[cs]e)\b/i, "regulatory"],
  [/\b(appoint(s|ed)?|names? new|hires?|chief executive)\b/i, "people"],
  [/\b(net[- ]zero|pledge|commitment|target|sbti)\b/i, "commitment"],
  [/\b(project|plant|construction|commissioning|financial close|groundbreaking)\b/i, "project"],
];

/** Pure: a rules classification of one signal. relevance 0–100; null type when nothing matches. */
export function rulesClassify(s: { title: string; summary: string | null; source: string }, queryType: TriggerType | null) {
  const text = `${s.title} ${s.summary ?? ""}`;
  const sectors = [...new Set(SECTOR_TERMS.filter(([re]) => re.test(text)).map(([, k]) => k))];
  const type = queryType ?? TYPE_TERMS.find(([re]) => re.test(text))?.[1] ?? null;
  // Official sources (procurement and DFI feeds) are relevant on a sector hit alone; news needs a type signal too.
  const official = ["worldbank", "ted", "edgar_form_d", "gdacs"].includes(s.source);
  const relevance = Math.min(100, sectors.length * 30 + (type ? 30 : 0) + (official ? 20 : 0));
  return { type, sectors, relevance };
}

const urgencyOf = (type: TriggerType, deadline: string | null, now: Date) => {
  if (type === "crisis") return 4;
  if (deadline) {
    const days = (Date.parse(deadline) - now.getTime()) / 86_400_000;
    if (days >= 0 && days < 21) return 4;
    if (days >= 0 && days < 60) return 3;
  }
  return 2;
};

/** Classifies up to `batch` new signals by rules. Returns counts; never calls AI. */
export async function classifyByRules(db: Db, batch = 40, now = new Date()) {
  const pending = await db.select().from(signals)
    .where(and(eq(signals.status, "new"), notLike(signals.summary, "%rules-checked%")))
    .orderBy(asc(signals.publishedAt)).limit(batch);
  if (!pending.length) return { checked: 0, triggered: 0 };
  const keys = [...new Set(pending.map(s => s.queryKey).filter((k): k is string => !!k))];
  const qTypes = new Map((keys.length ? await db.select({ key: triggerQueries.key, type: triggerQueries.triggerType }).from(triggerQueries).where(inArray(triggerQueries.key, keys)) : []).map(q => [q.key, q.type]));
  let triggered = 0;
  for (const s of pending) {
    const r = rulesClassify(s, s.queryKey ? qTypes.get(s.queryKey) ?? null : null);
    const note = `rules-checked: ${r.type ?? "no type"}, sectors ${r.sectors.join("/") || "none"}, relevance ${r.relevance}`;
    // Without an organization named by the source the rules cannot place a trigger: leave it for the AI read.
    if (!r.type || r.relevance < 60 || !s.orgName) {
      await db.update(signals).set({ summary: [s.summary, note].filter(Boolean).join(" · ").slice(0, 1000), updatedAt: now.toISOString() }).where(eq(signals.id, s.id));
      continue;
    }
    const org = await upsertOrganization(db, REGENERA_MANDATE_ID, {
      name: s.orgName, country: s.country ?? null, location: s.country ?? null, sector: r.sectors[0] ?? null,
      lat: s.lat ?? null, lng: s.lng ?? null, geoSource: s.lat != null ? s.source : null,
    }, "trigger", { source: s.source, url: s.url, confidence: "medium" });
    const [exists] = await db.select({ id: triggers.id }).from(triggers).where(eq(triggers.signalId, s.id));
    if (!exists) {
      await db.insert(triggers).values({
        mandateId: REGENERA_MANDATE_ID, orgId: org.row.id, type: r.type, summary: s.title.slice(0, 300),
        eventDate: s.publishedAt.slice(0, 10), sourceUrl: s.url, source: s.source, urgency: urgencyOf(r.type, s.deadline, now),
        country: s.country ?? null, lat: s.lat ?? org.row.lat ?? null, lng: s.lng ?? org.row.lng ?? null, signalId: s.id, relevance: r.relevance,
        suggestedEngagement: JSON.stringify({ sectors: r.sectors, classified: "rules" }),
        decisionRead: `Rules read (AI unavailable): ${r.type} signal from ${s.source}${r.sectors.length ? ` in ${r.sectors.join(", ")}` : ""}. Organization as named by the source. Not yet read by AI: confirm before acting.`,
      });
      triggered++;
    }
    await db.update(signals).set({ status: "triggered", relevance: r.relevance, summary: [s.summary, note].filter(Boolean).join(" · ").slice(0, 1000), updatedAt: now.toISOString() }).where(eq(signals.id, s.id));
    if (org.row.lat == null) await enqueue(db, "geo.org", { orgId: org.row.id }, { dedupeKey: `geo:${org.row.id}`, now });
  }
  return { checked: pending.length, triggered };
}

export async function rulesBacklog(db: Db) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(signals).where(and(eq(signals.status, "new"), notLike(signals.summary, "%rules-checked%")));
  return n;
}
