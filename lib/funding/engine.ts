// Funding engine (docs/plans/phase-5.md part A): rotating scans across sources, cross-source de-duplication,
// expiry, Claude's fit read, applicant matching, and bids. Every opportunity kept is open or forthcoming.
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { activities, deals, fundingMatches, fundingOpportunities, organizations, segments, tasks } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { geocode } from "@/lib/sources/geocode";
import { getState, setState } from "@/lib/state";
import { SECTORS } from "@/lib/vocab";
import { euFunding, grantsGov, tedFunding, ukContracts, worldBankFunding, type FundingItem } from "./sources";

type SourceKey = FundingItem["source"];

/** Keyword sets aligned to Regenera's sectors and services. Each runs against every source. */
export const FUNDING_QUERIES: { key: string; label: string; text: string; sector: keyof typeof SECTORS | null }[] = [
  { key: "watershed", label: "Watershed and water resilience", text: "watershed", sector: "water_food_nature" },
  { key: "water_infra", label: "Water infrastructure", text: "water infrastructure", sector: "infrastructure" },
  { key: "restoration", label: "Ecosystem and land restoration", text: "ecosystem restoration", sector: "water_food_nature" },
  { key: "nbs", label: "Nature-based solutions", text: "nature-based solutions", sector: "water_food_nature" },
  { key: "regen_ag", label: "Regenerative and sustainable agriculture", text: "regenerative agriculture", sector: "water_food_nature" },
  { key: "renewables", label: "Renewable energy", text: "renewable energy", sector: "energy" },
  { key: "grid", label: "Grid and energy transition", text: "energy transition", sector: "energy" },
  { key: "circular", label: "Circular economy and waste", text: "circular economy", sector: "waste_resource_systems" },
  { key: "solid_waste", label: "Solid waste and landfill", text: "solid waste", sector: "waste_resource_systems" },
  { key: "resilient_infra", label: "Climate-resilient infrastructure", text: "climate resilience infrastructure", sector: "infrastructure" },
  { key: "site_rehab", label: "Site rehabilitation and brownfield", text: "brownfield", sector: "land_built_environment" },
  { key: "urban_regen", label: "Urban regeneration", text: "urban regeneration", sector: "land_built_environment" },
  { key: "project_prep", label: "Project preparation and feasibility (Regenera bids)", text: "feasibility study", sector: null },
  { key: "tech_assist", label: "Technical assistance (Regenera bids)", text: "technical assistance", sector: null },
];

const SOURCES: Record<SourceKey, (db: Db, text: string, now: Date, f?: typeof fetch) => Promise<FundingItem[]>> = {
  grants_gov: grantsGov, eu_funding: euFunding, uk_contracts: ukContracts, ted: tedFunding, worldbank: worldBankFunding,
};
const SOURCE_KEYS = Object.keys(SOURCES) as SourceKey[];
const PAIRS = FUNDING_QUERIES.flatMap(q => SOURCE_KEYS.map(s => ({ q, s })));

export const dedupeKeyOf = (title: string, deadline: string | null) => `${normalizeOrgName(title).slice(0, 120)}|${deadline ?? ""}`;

// A quick keyword fit (0 to 60) so opportunities rank before Claude reads them; Claude's read replaces it.
const SERVICE_TERMS = ["watershed", "water", "restoration", "nature", "land", "regenerat", "agricultur", "energy", "grid", "renewable", "waste", "circular", "landfill",
  "infrastructure", "resilien", "feasibility", "technical assistance", "project preparation", "brownfield", "rehabilitat", "urban", "biodiversity", "climate"];
export function keywordFit(item: Pick<FundingItem, "title" | "description">) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  return Math.min(60, SERVICE_TERMS.filter(t => text.includes(t)).length * 12);
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" };

/** Decodes common HTML entities and drops zero-width characters that sources leave in titles. */
export function cleanText(s: string): string {
  return s.replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

// Grants.gov uses 999,999,999 and similar as "no ceiling" placeholders.
const realAmount = (n: number | null) => (n !== null && n > 0 && n < 999_000_000 ? n : null);

/** Inserts or refreshes one item. The same call seen from a second source is skipped (dedupe key). */
export async function upsertFunding(db: Db, mandateId: string, raw: FundingItem, queryKey: string | null, now = new Date()): Promise<"new" | "updated" | "duplicate"> {
  const item: FundingItem = {
    ...raw, title: cleanText(raw.title), funder: raw.funder ? cleanText(raw.funder) : null,
    description: raw.description ? cleanText(raw.description) : raw.description,
    amountMin: realAmount(raw.amountMin), amountMax: realAmount(raw.amountMax),
    // Far-future dates (2076, 2099) are "open until further notice" placeholders: treat as rolling.
    deadline: raw.deadline && raw.deadline > `${now.getUTCFullYear() + 5}` ? null : raw.deadline,
  };
  const iso = now.toISOString();
  const key = dedupeKeyOf(item.title, item.deadline);
  const [same] = await db.select({ id: fundingOpportunities.id, source: fundingOpportunities.source, externalId: fundingOpportunities.externalId }).from(fundingOpportunities)
    .where(and(eq(fundingOpportunities.mandateId, mandateId), eq(fundingOpportunities.source, item.source), eq(fundingOpportunities.externalId, item.externalId)));
  if (same) {
    await db.update(fundingOpportunities).set({
      title: item.title, deadline: item.deadline, status: item.status, amountMin: item.amountMin, amountMax: item.amountMax,
      ...(item.description ? { description: item.description } : {}), ...(item.applicantTypes.length ? { applicantTypes: item.applicantTypes } : {}), updatedAt: iso,
    }).where(eq(fundingOpportunities.id, same.id));
    return "updated";
  }
  const [dupe] = await db.select({ id: fundingOpportunities.id }).from(fundingOpportunities)
    .where(and(eq(fundingOpportunities.mandateId, mandateId), eq(fundingOpportunities.dedupeKey, key)));
  if (dupe) return "duplicate";
  await db.insert(fundingOpportunities).values({
    mandateId, source: item.source, externalId: item.externalId, dedupeKey: key, title: item.title.slice(0, 500), funder: item.funder, programme: item.programme,
    type: item.type, amountMin: item.amountMin, amountMax: item.amountMax, currency: item.currency, openDate: item.openDate, deadline: item.deadline,
    countries: item.countries, applicantTypes: item.applicantTypes, url: item.url, description: item.description, status: item.status,
    fit: keywordFit(item), queryKey,
  }).onConflictDoNothing();
  return "new";
}

/** Closes anything past its deadline, so the Funding tab only ever shows live opportunities. */
export async function closeExpired(db: Db, now = new Date()) {
  const r = await db.update(fundingOpportunities).set({ status: "closed", updatedAt: now.toISOString() })
    .where(and(ne(fundingOpportunities.status, "closed"), lt(fundingOpportunities.deadline, now.toISOString().slice(0, 10)))).returning({ id: fundingOpportunities.id });
  return r.length;
}

/** Runs the next `pairs` (query, source) combinations in rotation. A failing source never stops the others. */
export async function scanFunding(db: Db, mandateId: string, now = new Date(), fetchImpl?: typeof fetch, pairs = 8, only?: { query?: string; source?: SourceKey }) {
  const list = PAIRS.filter(p => (!only?.query || p.q.key === only.query) && (!only?.source || p.s === only.source));
  const start = only ? 0 : Number((await getState(db, "funding_scan_cursor")) ?? 0) % PAIRS.length;
  const batch = only ? list : Array.from({ length: Math.min(pairs, list.length) }, (_, i) => list[(start + i) % list.length]);
  const result = { runs: 0, fresh: 0, updated: 0, duplicates: 0, offTopic: 0, errors: [] as string[] };
  for (const { q, s } of batch) {
    try {
      const items = await SOURCES[s](db, q.text, now, fetchImpl);
      result.runs++;
      for (const it of items) {
        // Some source searches are loose (taxis, bedding plants): when the call text is known and names
        // no Regenera service term, skip it. Items without text (Grants.gov beyond the first details) are kept.
        if (it.description && keywordFit(it) === 0) { result.offTopic++; continue; }
        const r = await upsertFunding(db, mandateId, it, q.key, now);
        if (r === "new") result.fresh++; else if (r === "updated") result.updated++; else result.duplicates++;
      }
    } catch (e) {
      result.errors.push(`${s}/${q.key}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  if (!only) await setState(db, "funding_scan_cursor", String((start + batch.length) % PAIRS.length));
  await closeExpired(db, now);
  await setState(db, "funding_scan_last", JSON.stringify({ at: now.toISOString(), ...result }));
  return result;
}

// ---------- Claude's funding read ----------
export const zFundingRead = z.object({
  fit: z.number().int().min(0).max(100).describe("Fit to Regenera's services and focus, 0 to 100"),
  route: z.enum(["regenera_bid", "client_support", "consortium", "signal"]),
  type: z.enum(["grant", "tender", "call", "prize", "concessional"]),
  summary: z.string().describe("Two sentences: what is funded and for whom"),
  why: z.string().describe("One sentence on why it fits Regenera, or why not"),
  eligible_applicants: z.array(z.string()).describe("Normalized applicant types, e.g. local government, nonprofit, business, consortium"),
  eligible_countries: z.array(z.string()),
  sectors: z.array(z.enum(Object.keys(SECTORS) as [string, ...string[]])),
  consortium_needed: z.boolean(),
  caveats: z.array(z.string()).describe("Eligibility or co-financing points to check"),
  cofinancing_pct: z.number().int().min(0).max(100).nullable(),
});

export async function readFunding(db: Db, cfg: AiConfig, limit = 10, now = new Date(), client?: Anthropic) {
  const rows = await db.select().from(fundingOpportunities)
    .where(and(isNull(fundingOpportunities.readAt), ne(fundingOpportunities.status, "closed"), inArray(fundingOpportunities.decision, ["new", "watching"])))
    .orderBy(sql`coalesce(${fundingOpportunities.fit}, 0) desc`, asc(fundingOpportunities.deadline)).limit(limit);
  for (const o of rows) {
    const input = [
      `Title: ${o.title}`, `Funder: ${o.funder ?? "unknown"}${o.programme ? `, programme ${o.programme}` : ""}`, `Source: ${o.source}, listed as ${o.type}`,
      `Amount: ${o.amountMin ?? "?"} to ${o.amountMax ?? "?"} ${o.currency ?? ""}`, `Deadline: ${o.deadline ?? "not stated"}`,
      `Countries listed: ${(o.countries ?? []).join(", ") || "not stated"}`, `Applicants listed: ${(o.applicantTypes ?? []).join(", ") || "not stated"}`,
      `Description: ${o.description.slice(0, 2500) || "none"}`,
    ].join("\n");
    const r = await runStructured(db, cfg, "funding.read", input, zFundingRead, { entity: "funding", entityId: o.id }, client);
    await db.update(fundingOpportunities).set({
      fit: r.fit, route: r.route, type: r.type, sectors: r.sectors, cofinancingPct: r.cofinancing_pct,
      applicantTypes: r.eligible_applicants.length ? r.eligible_applicants : o.applicantTypes,
      countries: r.eligible_countries.length ? r.eligible_countries : o.countries,
      read: { summary: r.summary, why: r.why, caveats: r.caveats, consortium: r.consortium_needed }, readAt: now.toISOString(), updatedAt: now.toISOString(),
    }).where(eq(fundingOpportunities.id, o.id));
  }
  return rows.length;
}

// ---------- Find applicants ----------
const EU_COUNTRIES = ["austria", "belgium", "bulgaria", "croatia", "cyprus", "czech", "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "ireland",
  "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal", "romania", "slovakia", "slovenia", "spain", "sweden"];

export function countryMatches(oppCountries: string[], orgPlace: string): boolean {
  const place = orgPlace.toLowerCase();
  if (!place) return false;
  return oppCountries.some(c => {
    const k = c.toLowerCase();
    if (k.includes("european union") || k === "eu") return EU_COUNTRIES.some(e => place.includes(e));
    if (k === "united states" || k === "usa" || k === "us") return /united states|\busa\b|\bus\b/.test(place);
    if (k.includes("global") || k.includes("worldwide") || k.includes("any country")) return true;
    return place.includes(k);
  });
}

export function applicantGroups(types: string[]): Set<string> | null {
  if (!types.length) return null; // not stated: any group may apply
  const t = types.join(" ").toLowerCase();
  const groups = new Set<string>();
  if (/government|municipal|county|city|state|local|tribal|public|ministr|authorit/.test(t)) groups.add("public");
  if (/nonprofit|non-profit|ngo|foundation|community|cooperative|civil society|land trust/.test(t)) groups.add("community");
  if (/business|compan|for-profit|sme|enterprise|private|consult|industry/.test(t)) { groups.add("corporate"); groups.add("channel"); }
  if (/investor|fund|financ/.test(t)) groups.add("capital");
  return groups.size ? groups : null;
}

export async function matchApplicants(db: Db, opportunityId: string, limit = 25) {
  const [o] = await db.select().from(fundingOpportunities).where(eq(fundingOpportunities.id, opportunityId));
  if (!o) return 0;
  const groups = applicantGroups(o.applicantTypes ?? []);
  const orgs = await db.select({ id: organizations.id, name: organizations.name, country: organizations.country, location: organizations.location, group: segments.group, sector: organizations.sector })
    .from(organizations).leftJoin(segments, eq(segments.id, organizations.segmentId))
    .where(and(eq(organizations.mandateId, o.mandateId), isNull(organizations.archivedAt))).limit(2000);
  const wanted = new Set(o.sectors ?? []);
  let n = 0;
  for (const org of orgs) {
    if (n >= limit) break;
    const place = `${org.country ?? ""} ${org.location ?? ""}`;
    const countries = o.countries ?? [];
    if (countries.length && !countryMatches(countries, place)) continue;
    if (groups && (!org.group || !groups.has(org.group))) continue;
    if (wanted.size && org.sector && !wanted.has(org.sector)) continue;
    const reason = [countries.length ? `eligible country (${org.country ?? org.location})` : null, groups && org.group ? `${org.group} applicant` : null, org.sector && wanted.has(org.sector) ? `sector ${SECTORS[org.sector as keyof typeof SECTORS] ?? org.sector}` : null].filter(Boolean).join(", ") || "possible applicant";
    const r = await db.insert(fundingMatches).values({ mandateId: o.mandateId, opportunityId: o.id, orgId: org.id, reason }).onConflictDoNothing().returning({ id: fundingMatches.id });
    n += r.length;
  }
  if (n && o.decision === "new") await db.update(fundingOpportunities).set({ decision: "matched", updatedAt: new Date().toISOString() }).where(eq(fundingOpportunities.id, o.id));
  return n;
}

// ---------- Bid ----------
/** Tasks back-planned from the deadline, never earlier than tomorrow. */
export function bidPlan(deadline: string | null, now = new Date()) {
  const d = deadline ? Date.parse(`${deadline}T12:00:00Z`) : now.getTime() + 30 * 86_400_000;
  const floor = now.getTime() + 86_400_000;
  const at = (daysBefore: number) => new Date(Math.max(floor, d - daysBefore * 86_400_000)).toISOString().slice(0, 10);
  return [
    { title: "Bid or no bid: eligibility, capacity, fit, co-financing", due: at(21) },
    { title: "Confirm partners and roles (consortium, letters of support)", due: at(18) },
    { title: "Draft the technical proposal from the bid library", due: at(10) },
    { title: "Budget, co-financing and compliance checks", due: at(7) },
    { title: "Internal review and sign-off", due: at(4) },
    { title: "Submit on the funder's portal", due: at(1) },
  ];
}

export async function bidOnOpportunity(db: Db, opportunityId: string, actor: string, now = new Date()) {
  const [o] = await db.select().from(fundingOpportunities).where(eq(fundingOpportunities.id, opportunityId));
  if (!o) throw new Error("Opportunity not found");
  if (o.dealId) return o.dealId;
  let funderOrgId = o.funderOrgId;
  if (!funderOrgId && o.funder) {
    const key = normalizeOrgName(o.funder);
    const [f] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, o.mandateId), eq(organizations.nameNormalized, key)));
    funderOrgId = f?.id ?? (await db.insert(organizations).values({ mandateId: o.mandateId, name: o.funder.slice(0, 200), nameNormalized: key, source: "procurement", fieldSources: {} }).returning({ id: organizations.id }))[0].id;
  }
  const [deal] = await db.insert(deals).values({
    mandateId: o.mandateId, orgId: funderOrgId ?? null, name: `Bid: ${o.title.slice(0, 160)}`, path: "project_diagnostic", stage: "lead",
    engagement: o.route === "client_support" ? "readiness_mandate" : "diagnostic", source: "procurement", opportunityId: o.id, expectedClose: o.deadline,
    valueEstimate: o.amountMax ?? null, nextAction: "Bid or no bid decision", nextActionDate: bidPlan(o.deadline, now)[0].due,
    notes: [`Funding opportunity: ${o.url}`, o.read?.summary, o.read?.caveats?.length ? `Check: ${o.read.caveats.join("; ")}` : null].filter(Boolean).join("\n"),
  }).returning({ id: deals.id });
  for (const t of bidPlan(o.deadline, now)) {
    await db.insert(tasks).values({ mandateId: o.mandateId, orgId: funderOrgId ?? null, dealId: deal.id, type: "other", title: t.title, body: o.title, dueAt: t.due });
  }
  await db.insert(activities).values({ mandateId: o.mandateId, orgId: funderOrgId ?? null, dealId: deal.id, type: "note", method: "funding", detail: `Bid opened on "${o.title.slice(0, 120)}" (deadline ${o.deadline ?? "not stated"})`, source: "manual", actor });
  await db.update(fundingOpportunities).set({ decision: "bidding", dealId: deal.id, funderOrgId, updatedAt: now.toISOString() }).where(eq(fundingOpportunities.id, o.id));
  return deal.id;
}

// ---------- Map ----------
/** Places opportunities that name a specific country (not "European Union" or "global"). Returns whether rows remain. */
export async function placeFunding(db: Db, limit = 20, wait = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const rows = await db.select({ id: fundingOpportunities.id, countries: fundingOpportunities.countries }).from(fundingOpportunities)
    .where(and(isNull(fundingOpportunities.lat), ne(fundingOpportunities.status, "closed"))).limit(limit);
  let placed = 0;
  for (const r of rows) {
    const c = (r.countries ?? []).find(x => !/union|global|worldwide|associated|third countr|any/i.test(x));
    if (!c) { await db.update(fundingOpportunities).set({ lat: 0, lng: 0 }).where(eq(fundingOpportunities.id, r.id)); continue; } // 0,0 = not placeable
    let p = await geocode(db, c);
    if (p === "busy") { await wait(1200); p = await geocode(db, c); } // Nominatim allows one request a second
    if (p === "busy") return { placed, more: true };
    await db.update(fundingOpportunities).set(p ? { lat: p.lat, lng: p.lng } : { lat: 0, lng: 0 }).where(eq(fundingOpportunities.id, r.id));
    placed++;
  }
  return { placed, more: rows.length === limit };
}
