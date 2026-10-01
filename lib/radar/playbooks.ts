// Prospecting playbooks (docs/plans/phase-4.md item 8). One per segment: who to reach, the keywords that match
// Regenera's services, one clear message, searches for LinkedIn, Google, Sales Navigator and Apollo, and message
// templates that become a playbook sequence. LinkedIn and Google are link-outs opened by Prado: no search API
// exists for free and LinkedIn is never scraped. Apollo people search runs automatically (0 credits).
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { playbookDrafts, segments, sequences, type SequenceStep } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { checkDraft } from "@/lib/outreach/sequences";
import { ENGAGEMENTS, PRACTICES, SECTORS } from "@/lib/vocab";
import { audienceForSegment, uniqueTitles } from "@/lib/scan/audiences";

// Service keywords, from the site's own vocabulary (practices, sectors, territorial systems).
const SECTOR_TERMS: Record<string, string[]> = {
  energy: ["renewable energy", "energy transition", "grid", "interconnection"],
  infrastructure: ["infrastructure", "PPP", "public works"],
  land_built_environment: ["land", "real estate", "masterplan", "site rehabilitation"],
  waste_resource_systems: ["waste", "circular economy", "landfill", "resource recovery"],
  water_food_nature: ["regenerative agriculture", "nature-based solutions", "water", "natural capital", "biodiversity"],
};
const PRACTICE_TERMS: Record<string, string[]> = {
  systems_intelligence: ["territorial", "feasibility", "systems"],
  development_strategy: ["project development", "development strategy"],
  capital_partnerships: ["impact investing", "blended finance", "real assets"],
};
// Company terms come from the audience definition for the segment (lib/scan/audiences.ts), with a per-segment fallback;
// never per group, so a bank segment cannot inherit "EPC" or "law firm" and a real-estate playbook stays real estate.
const SEGMENT_COMPANY_TERMS: Record<string, string[]> = {
  pensions_insurers: ["pension fund", "insurance company", "institutional investor"],
  sovereign_funds_mena: ["sovereign wealth fund", "state investment fund"],
  post_industrial_land: ["mining company", "industrial site owner", "brownfield redevelopment"],
  agribusiness: ["agribusiness", "agricultural producer", "agri-food company"],
  food_consumer_brands: ["food company", "beverage company", "consumer goods"],
  hospitality_tourism: ["resort developer", "hotel developer", "hospitality group"],
  national_ministries: ["ministry", "national agency"],
  sezs_development_authorities: ["special economic zone", "development authority"],
  tourism_authorities: ["tourism board", "tourism authority"],
  big4_sustainability: ["sustainability consulting", "climate advisory"],
};
export function companyTermsFor(segmentKey: string): string[] {
  return audienceForSegment(segmentKey)?.orgTerms ?? SEGMENT_COMPANY_TERMS[segmentKey] ?? [];
}

export const REGIONS: Record<string, string[]> = {
  latam: ["Mexico", "Colombia", "Peru", "Chile", "Brazil", "Argentina", "Costa Rica", "Panama"],
  mena: ["Saudi Arabia", "United Arab Emirates", "Qatar", "Oman", "Egypt", "Morocco"],
  africa: ["South Africa", "Kenya", "Ghana", "Nigeria", "Rwanda"],
  europe: ["Spain", "Portugal", "United Kingdom", "Netherlands", "Germany", "France"],
  north_america: ["United States", "Canada"],
  asia_pacific: ["Singapore", "Indonesia", "India", "Australia", "Philippines"],
};

type Segment = typeof segments.$inferSelect;
const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
const or = (terms: string[]) => (terms.length === 1 ? q(terms[0]) : `(${terms.map(q).join(" OR ")})`);

export type Playbook = ReturnType<typeof buildPlaybook>;

export function buildPlaybook(s: Segment, region?: string) {
  const titles = uniqueTitles([...(s.titles ?? []), ...(((s.apolloFilters as { person_titles?: string[] }).person_titles) ?? [])])
    .map(t => t.replace(/\b\w/g, c => c.toUpperCase())).slice(0, 6);
  const sectorTerms = [...new Set(s.sectors.flatMap(k => SECTOR_TERMS[k] ?? []))].slice(0, 5);
  const practiceTerms = [...new Set(s.practices.flatMap(k => PRACTICE_TERMS[k] ?? []))].slice(0, 3);
  const topics = [...new Set([...sectorTerms, ...practiceTerms])].slice(0, 6);
  const companyTerms = companyTermsFor(s.key);
  const places = region ? REGIONS[region] ?? [] : [];
  const where = places.length ? ` ${or(places)}` : "";
  const peopleBoolean = `${or(titles)} AND ${or(topics.slice(0, 4))}`;
  const companyBoolean = `${or(companyTerms.slice(0, 3))} AND ${or(sectorTerms.slice(0, 3))}`;
  const practiceNames = s.practices.map(p => PRACTICES[p as keyof typeof PRACTICES] ?? p).join(" and ");
  const ask = s.path === "partner_network" ? "a short call about joining the Partner Network"
    : s.path === "capital_mandate" ? "a 20 minute call to define the mandate criteria" : "a 20 minute scoping call";
  return {
    segmentId: s.id, key: s.key, name: s.name, group: s.group, path: s.path, enabled: s.enabled,
    who: { titles, companyTypes: companyTerms, sectors: s.sectors.map(k => SECTORS[k as keyof typeof SECTORS] ?? k) },
    keywords: { topics, practiceTerms, sectorTerms },
    message: {
      whyRegenera: `${practiceNames}. ${s.angle}`,
      whyNow: s.triggers,
      offer: s.entryOffer,
      ask,
      oneLiner: `${s.angle} Regenera starts with a ${s.entryOffer.charAt(0).toLowerCase()}${s.entryOffer.slice(1)}, then ${ask}.`,
    },
    searches: {
      linkedinPeople: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(peopleBoolean + where)}`,
      linkedinCompanies: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(`${or(companyTerms.slice(0, 3))} ${sectorTerms[0] ?? ""}`.trim() + where)}`,
      googlePeople: `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in ${or(titles.slice(0, 4))} ${or(topics.slice(0, 3))}${where}`)}`,
      googleCompanies: `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/company ${companyBoolean}${where}`)}`,
      salesNavigator: `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(peopleBoolean)}`,
      peopleBoolean, companyBoolean,
    },
  };
}

export async function listPlaybooks(db: Db, region?: string) {
  const segs = await db.select().from(segments).orderBy(asc(segments.group), asc(segments.name));
  return segs.map(s => buildPlaybook(s, region));
}

// ---------- message and sequence templates ----------
export const PLAYBOOK_STEPS: (SequenceStep & { step: number })[] = [
  { step: 0, day: 0, channel: "linkedin_connect", purpose: "Connection note: one specific reason to connect, no pitch" },
  { step: 1, day: 2, channel: "email", purpose: "First email: their situation, the decision they hold, the entry offer, one small ask" },
  { step: 2, day: 5, channel: "linkedin_message", purpose: "Share one relevant insight or Field Note, no ask" },
  { step: 3, day: 12, channel: "email", purpose: "Proof point or a sharper angle, with the scoping-call link" },
  { step: 4, day: 21, channel: "email", purpose: "Close the loop politely and leave the door open" },
];

const zTemplates = z.object({
  messages: z.array(z.object({ step: z.number().int(), subject: z.string(), body: z.string() })),
});

/** Claude writes one template per step from the playbook; house style is checked and retried once. */
export async function draftPlaybookTemplates(db: Db, cfg: AiConfig, mandateId: string, segmentId: string, client?: Anthropic) {
  const [s] = await db.select().from(segments).where(eq(segments.id, segmentId));
  if (!s) throw new Error("Segment not found");
  const pb = buildPlaybook(s);
  const input = [
    `Playbook: ${pb.name} (${pb.group}, path ${pb.path}).`,
    `Who: ${pb.who.titles.join(", ")} at ${pb.who.companyTypes.join(", ")}. Sectors: ${pb.who.sectors.join(", ")}.`,
    `Why Regenera: ${pb.message.whyRegenera}`, `Why now (typical triggers): ${pb.message.whyNow}`,
    `Entry offer: ${pb.message.offer} (${ENGAGEMENTS[s.path === "capital_mandate" ? "capital_screening" : "diagnostic"]}). Ask: ${pb.message.ask}.`,
    `Write templates for these steps. Use the placeholders {first_name}, {organization} and {trigger} where a personal detail belongs. LinkedIn connection notes stay under 280 characters.`,
    PLAYBOOK_STEPS.map(x => `step ${x.step}: day ${x.day}, ${x.channel}, ${x.purpose}`).join("\n"),
  ].join("\n\n");
  let out = await runStructured(db, cfg, "playbook.messages", input, zTemplates, { entity: "segment", entityId: segmentId }, client);
  const check = (o: typeof out) => o.messages.map(m => {
    const def = PLAYBOOK_STEPS.find(x => x.step === m.step);
    return { m, def, issues: def ? checkDraft({ step: m.step, channel: def.channel, subject: m.subject, body: m.body, angle_tag: "", personalization_refs: [] }, def.channel === "email" && m.step === 1) : [] };
  });
  let checked = check(out);
  const failing = checked.filter(c => c.issues.length);
  if (failing.length) {
    out = await runStructured(db, cfg, "playbook.messages", `${input}\n\nFix these house-style issues and rewrite all steps:\n${failing.map(f => `step ${f.m.step}: ${f.issues.map(i => i.detail).join(" ")}`).join("\n")}`, zTemplates, { entity: "segment", entityId: segmentId }, client);
    checked = check(out);
  }
  for (const { m, def, issues } of checked) {
    if (!def) continue;
    const values = { mandateId, segmentId, step: m.step, day: def.day, channel: def.channel, purpose: def.purpose, subject: def.channel === "email" ? m.subject : "", body: m.body, styleIssues: issues.length ? issues : null };
    await db.insert(playbookDrafts).values(values).onConflictDoUpdate({ target: [playbookDrafts.mandateId, playbookDrafts.segmentId, playbookDrafts.step], set: { ...values, updatedAt: new Date().toISOString() } });
  }
  return checked.length;
}

/** Creates (or refreshes) the playbook's targeted sequence. Each step's purpose carries the approved template,
 *  so personal drafts for each person follow the playbook message. */
export async function playbookSequence(db: Db, mandateId: string, segmentId: string) {
  const [s] = await db.select().from(segments).where(eq(segments.id, segmentId));
  if (!s) throw new Error("Segment not found");
  const drafts = await db.select().from(playbookDrafts).where(and(eq(playbookDrafts.mandateId, mandateId), eq(playbookDrafts.segmentId, segmentId))).orderBy(asc(playbookDrafts.step));
  const steps: SequenceStep[] = PLAYBOOK_STEPS.map(def => {
    const d = drafts.find(x => x.step === def.step);
    return { day: def.day, channel: def.channel, purpose: d ? `${def.purpose}. Adapt this approved template to the person: ${d.subject ? `Subject "${d.subject}". ` : ""}${d.body}` : def.purpose };
  });
  const key = `pb:${s.key}`;
  const [row] = await db.insert(sequences).values({ mandateId, key, name: `${s.name} playbook`, tier: "targeted", segmentId, steps })
    .onConflictDoUpdate({ target: [sequences.mandateId, sequences.key], set: { steps, updatedAt: new Date().toISOString() } }).returning();
  return row;
}
