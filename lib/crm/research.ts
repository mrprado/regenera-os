// Research and scoring pipeline (docs/plans/phase-1.md sections 3 and 4).
// research.gather (web search + fetch) -> research.dossier (structured, sources checked) -> score.match.
import type Anthropic from "@anthropic-ai/sdk";
import { warmPaths } from "@/lib/outreach/relationships";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { activities, contacts, dossiers, organizations, scores, segments, triggers } from "@/db/schema";
import { runStructured, runWebResearch, type AiConfig } from "@/lib/ai/run";
import { freshnessSince } from "@/lib/freshness";
import { enqueue } from "@/lib/jobs/queue";
import { ENGAGEMENT_PATHS, ENGAGEMENTS, PRACTICES, SCREENING_QUADRANTS } from "@/lib/vocab";

const sourced = <T extends z.ZodType>(value: T) => z.object({ value, sources: z.array(z.string()), confidence: z.enum(["high", "medium", "low"]) });

export const zDossier = z.object({
  mandate: sourced(z.string()),
  investment_focus: sourced(z.string()),
  ticket_and_structure: sourced(z.string()),
  development_mandate: sourced(z.string()),
  recent_activity: z.array(z.object({ date: z.string(), fact: z.string(), source: z.string() })),
  live_opportunities: z.array(z.object({ fact: z.string(), deadline: z.string(), source: z.string() })),
  partner_ecosystem: sourced(z.array(z.string())),
  decision_map: sourced(z.string()),
  headquarters: z.object({ city: z.string(), country: z.string(), source: z.string() }),
  regenerative_angle: z.string(),
  decision_read: z.string(),
  overall_confidence: z.enum(["high", "medium", "low"]),
});
export type DossierFields = z.infer<typeof zDossier>;

const URL_RE = /https?:\/\/[^\s<>)"']+/g;

/** Keeps only sources that appear in the gather notes, and drops dated items older than this year. */
export function enforceSources(d: DossierFields, notes: string, now = new Date()): { fields: DossierFields; removed: number } {
  const allowed = new Set((notes.match(URL_RE) ?? []).map(u => u.replace(/[.,;]+$/, "")));
  let removed = 0;
  const keep = (u: string) => { const ok = allowed.has(u.replace(/[.,;]+$/, "")); if (!ok) removed++; return ok; };
  const fix = <V>(s: { value: V; sources: string[]; confidence: "high" | "medium" | "low" }) => {
    const sources = s.sources.filter(keep);
    return sources.length ? { ...s, sources } : { ...s, value: (Array.isArray(s.value) ? [] : "") as V, sources: [], confidence: "low" as const };
  };
  const since = freshnessSince(now).toISOString().slice(0, 7);
  const fields: DossierFields = {
    ...d,
    mandate: fix(d.mandate), investment_focus: fix(d.investment_focus), ticket_and_structure: fix(d.ticket_and_structure),
    development_mandate: fix(d.development_mandate), partner_ecosystem: fix(d.partner_ecosystem), decision_map: fix(d.decision_map),
    recent_activity: d.recent_activity.filter(a => keep(a.source) && a.date.slice(0, 7) >= since),
    live_opportunities: d.live_opportunities.filter(o => keep(o.source)),
    headquarters: d.headquarters.source && !keep(d.headquarters.source) ? { city: "", country: "", source: "" } : d.headquarters,
  };
  return { fields, removed };
}

/** Starts (or restarts) research for an organization; the gather step runs as its own job. */
export async function requestResearch(db: Db, orgId: string, depth: "full" | "light", contactId?: string | null) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new Error("Organization not found");
  const [row] = await db.insert(dossiers).values({ mandateId: org.mandateId, orgId, contactId: contactId ?? null, depth, status: "gathering" }).returning();
  await enqueue(db, "research.gather", { dossierId: row.id }, { dedupeKey: `gather:${row.id}` });
  return row.id;
}

export async function gatherStep(db: Db, cfg: AiConfig, dossierId: string, client?: Anthropic) {
  const [d] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!d || d.status !== "gathering") return;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, d.orgId));
  const contact = d.contactId ? (await db.select().from(contacts).where(eq(contacts.id, d.contactId)))[0] : undefined;
  const orgTriggers = await db.select().from(triggers).where(and(eq(triggers.orgId, d.orgId), gte(triggers.eventDate, freshnessSince().toISOString().slice(0, 10)))).limit(5);
  const input = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Organization: ${org.name}`, org.website ? `Website: ${org.website}` : org.domain ? `Domain: ${org.domain}` : "",
    org.location || org.country ? `Location: ${org.location ?? ""} ${org.country ?? ""}` : "",
    contact ? `Contact: ${contact.fullName}${contact.title ? `, ${contact.title}` : ""}` : "",
    contact?.linkedinProfileText ? `LinkedIn profile text supplied by Prado:\n${contact.linkedinProfileText.slice(0, 4000)}` : "",
    orgTriggers.length ? `Current triggers:\n${orgTriggers.map(t => `- ${t.eventDate} ${t.type}: ${t.summary} <${t.sourceUrl ?? ""}>`).join("\n")}` : "",
    d.depth === "light" ? "Depth: light. Website and current triggers only." : "Depth: full.",
  ].filter(Boolean).join("\n");
  const limits = d.depth === "full" ? { maxSearches: 8, maxFetches: 6 } : { maxSearches: 2, maxFetches: 2 };
  const notes = await runWebResearch(db, cfg, "research.gather", input, limits, { entity: "dossier", entityId: d.id }, client);
  await db.update(dossiers).set({ notes, status: "synthesizing", updatedAt: new Date().toISOString() }).where(eq(dossiers.id, d.id));
  await enqueue(db, "research.dossier", { dossierId: d.id }, { dedupeKey: `synth:${d.id}` });
}

export async function synthesizeStep(db: Db, cfg: AiConfig, dossierId: string, client?: Anthropic) {
  const [d] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!d || d.status !== "synthesizing") return;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, d.orgId));
  const out = await runStructured(db, cfg, "research.dossier", `Organization: ${org.name}\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nResearch notes:\n${d.notes}`, zDossier, { entity: "dossier", entityId: d.id }, client);
  const { fields, removed } = enforceSources(out, d.notes);
  const now = new Date().toISOString();
  await db.update(dossiers).set({ fields: { ...fields, _removedUnsourced: removed }, confidence: fields.overall_confidence, status: "ready", refreshedAt: now, updatedAt: now }).where(eq(dossiers.id, d.id));
  if (fields.headquarters.city || fields.headquarters.country) {
    if (!org.location) await db.update(organizations).set({ location: [fields.headquarters.city, fields.headquarters.country].filter(Boolean).join(", "), updatedAt: now }).where(eq(organizations.id, org.id));
    if (org.lat == null) await enqueue(db, "geo.org", { orgId: org.id }, { dedupeKey: `geo:${org.id}:${d.id}` });
  }
  await db.insert(activities).values({ mandateId: d.mandateId, orgId: d.orgId, contactId: d.contactId, type: "research", detail: `Dossier ready (${d.depth}, confidence ${fields.overall_confidence})`, source: "job" });
  const people = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.orgId, d.orgId));
  for (const p of people) await enqueue(db, "score.match", { contactId: p.id }, { dedupeKey: `score:${p.id}:${d.id}` });
}

// ---------- scoring ----------
export const WEIGHTS = { fit: 0.4, trigger: 0.35, access: 0.25 };

export function totalScore(s: { fit: number; trigger: number; access: number }, w = WEIGHTS): number {
  return Math.round(s.fit * w.fit + s.trigger * w.trigger + s.access * w.access);
}

export function tierFor(total: number): "targeted" | "mass" | "watchlist" | "parked" {
  return total >= 75 ? "targeted" : total >= 50 ? "mass" : total >= 30 ? "watchlist" : "parked";
}

/** Readiness and alignment are separate tests (regenera.bio Capital Partners screening logic). */
export function screeningQuadrant(readiness: Record<string, "low" | "medium" | "high">, alignment: "low" | "high"): (typeof SCREENING_QUADRANTS)[number] {
  const levels: number[] = Object.values(readiness).map(v => (v === "high" ? 2 : v === "medium" ? 1 : 0));
  const avg = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
  const ready = avg >= 1.2;
  if (ready && alignment === "high") return "proceed";
  if (!ready && alignment === "high") return "develop";
  if (ready && alignment === "low") return "redirect";
  return "decline";
}

const zScore = z.object({
  fit: z.number().int().min(0).max(100), trigger: z.number().int().min(0).max(100), access: z.number().int().min(0).max(100),
  rationale: z.object({ fit: z.string(), trigger: z.string(), access: z.string() }),
});
const zMatch = z.object({
  primary: z.object({ engagement_path: z.enum(ENGAGEMENT_PATHS), practice: z.enum(Object.keys(PRACTICES) as [string, ...string[]]), engagement: z.enum(Object.keys(ENGAGEMENTS) as [string, ...string[]]), offer: z.string(), angle: z.string() }),
  secondary: z.object({ engagement_path: z.enum(ENGAGEMENT_PATHS), practice: z.enum(Object.keys(PRACTICES) as [string, ...string[]]), engagement: z.enum(Object.keys(ENGAGEMENTS) as [string, ...string[]]), offer: z.string(), angle: z.string() }),
  rationale: z.string(),
});
const zLevel = z.object({ level: z.enum(["low", "medium", "high"]), evidence: z.string() });
const zScreen = z.object({
  readiness: z.object({ control: zLevel, technical: zLevel, commercial: zLevel, institutional: zLevel, capital: zLevel }),
  alignment: z.enum(["low", "high"]),
  alignment_reason: z.string(),
});

export async function scoreContact(db: Db, cfg: AiConfig, contactId: string, client?: Anthropic) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c?.orgId) return;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, c.orgId));
  const [d] = await db.select().from(dossiers).where(and(eq(dossiers.orgId, c.orgId), eq(dossiers.status, "ready"))).orderBy(desc(dossiers.refreshedAt)).limit(1);
  const seg = c.segmentId ? (await db.select().from(segments).where(eq(segments.id, c.segmentId)))[0] : undefined;
  const orgTriggers = await db.select().from(triggers).where(and(eq(triggers.orgId, c.orgId), inArray(triggers.status, ["new", "pursued", "watched"]), gte(triggers.eventDate, freshnessSince().toISOString().slice(0, 10))));
  const [{ touches }] = await db.select({ touches: sql<number>`count(*)` }).from(activities).where(eq(activities.contactId, c.id));
  const warm = await warmPaths(db, c.mandateId, org.domain);
  const context = [
    `Contact: ${c.fullName}${c.title ? `, ${c.title}` : ""} at ${org.name}`, `Source: ${c.source}`, `Prior touches recorded: ${touches}`,
    warm.length ? `Warm paths (Regenera mailbox metadata, strength 0 to 100; use for the access axis):\n${warm.map(w => `- ${w.email} via ${w.mailbox}: ${w.emailsSent} sent, ${w.emailsReceived} received, ${w.meetings} meetings, last ${w.lastContactAt?.slice(0, 10) ?? "unknown"}, strength ${w.strength}`).join("\n")}` : "No warm paths found in Regenera mailboxes.",
    seg ? `Segment: ${seg.name}. Entry offer: ${seg.entryOffer}. Angle: ${seg.angle}` : "",
    orgTriggers.length ? `Current triggers:\n${orgTriggers.map(t => `- ${t.eventDate} ${t.type} (urgency ${t.urgency}): ${t.summary}`).join("\n")}` : "No current trigger.",
    d ? `Dossier:\n${JSON.stringify(d.fields).slice(0, 12000)}` : "No dossier yet.",
  ].filter(Boolean).join("\n\n");
  const meta = { entity: "contact", entityId: c.id };
  const s = await runStructured(db, cfg, "score.lead", context, zScore, meta, client);
  const m = await runStructured(db, cfg, "match.offer", context, zMatch, meta, client);
  let screening: z.infer<typeof zScreen> | null = null;
  if (d) screening = await runStructured(db, cfg, "screen.deal", context, zScreen, meta, client);
  const total = totalScore(s);
  const tier = tierFor(total);
  const quadrant = screening ? screeningQuadrant(Object.fromEntries(Object.entries(screening.readiness).map(([k, v]) => [k, v.level])), screening.alignment) : null;
  await db.insert(scores).values({
    mandateId: c.mandateId, contactId: c.id, fit: s.fit, trigger: s.trigger, access: s.access, total, tier,
    rationale: s.rationale, match: m, screeningQuadrant: quadrant, screening, modelVersion: "score.lead@1",
  });
  await db.update(contacts).set({ score: total, tier, leadState: tier === "parked" ? "parked" : "qualified", updatedAt: new Date().toISOString() }).where(eq(contacts.id, c.id));
}
