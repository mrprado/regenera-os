// Saved searches (docs/plans/phase-3.md item 2, SPEC section 5). Apollo people searches are free (0 credits)
// and run on a cadence; each run keeps only people not already in the CRM or already found. Google X-ray and
// Sales Navigator Booleans are link-outs that open in Prado's own browser: no search API, no scraping.
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, savedSearches, searchResults, segments } from "@/db/schema";
import { type ApolloConfig, type PeopleSearchParams, searchPeople } from "@/lib/sources/apollo";
import { nextRun } from "@/lib/time/cadence";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

export const XRAY_QUERIES: { key: string; name: string; query: string; region?: string }[] = [
  { key: "xray:sustainability_energy_latam_africa", name: "Heads of sustainability, energy and infrastructure (Chile, Peru, South Africa, Ghana)", query: 'site:linkedin.com/in "head of sustainability" (energy OR infrastructure) (Chile OR Peru OR "South Africa" OR Ghana)' },
  { key: "xray:family_office_real_assets", name: "Family office real assets and impact (Miami, Mexico City, São Paulo, Dubai)", query: 'site:linkedin.com/in "family office" ("real assets" OR impact OR regenerative) (Miami OR "Mexico City" OR "São Paulo" OR Dubai)' },
  { key: "xray:new_cso_2026", name: "New chief sustainability or impact officers, this year", query: `"appointed" ("chief sustainability officer" OR "head of impact") ${new Date().getUTCFullYear()}` },
  { key: "xray:fund_launch_2026", name: "Natural capital, regen ag and infrastructure fund launches, this year", query: `("natural capital fund" OR "regenerative agriculture fund" OR "infrastructure fund") ("first close" OR launch) ${new Date().getUTCFullYear()}` },
  { key: "xray:waste_tender", name: "Landfill and waste tenders or crises", query: '(landfill OR "waste management") (tender OR crisis OR closure)' },
  { key: "xray:interconnection", name: "Interconnection queue delays", query: '"interconnection queue" (delay OR backlog)' },
  { key: "xray:calls_nbs", name: "Calls for proposals: nature-based, circular, water", query: '"call for proposals" ("nature-based solutions" OR "circular economy" OR "water infrastructure")' },
];

export const SALESNAV_QUERIES: { key: string; name: string; query: string }[] = [
  { key: "salesnav:sustainability_leaders", name: "Sustainability leaders (add industry, region, changed jobs in 90 days)", query: '("Chief Sustainability Officer" OR "Head of Sustainability" OR "Head of ESG" OR "Director of Sustainability" OR "VP Environment")' },
  { key: "salesnav:impact_capital", name: "Impact capital (VC and PE or Investment Management)", query: '("Investment Director" OR Principal OR CIO OR Partner) AND (impact OR "natural capital" OR regenerative OR "blended finance" OR "nature-based" OR "real assets" OR infrastructure)' },
  { key: "salesnav:family_offices", name: "Family offices (company keyword \"family office\")", query: '(CIO OR "Head of Investments" OR Principal)' },
  { key: "salesnav:agri_sourcing", name: "Agri sourcing (Food and Beverage or Farming)", query: '("Head of Sourcing" OR "Sustainable Sourcing" OR "Regenerative Agriculture")' },
  { key: "salesnav:municipal", name: "Municipal (Government Administration)", query: '("Director of Public Works" OR "Environmental Services" OR "Solid Waste" OR "Chief Resilience Officer")' },
  { key: "salesnav:epc_partners", name: "EPC partners (Civil Engineering or Construction)", query: '("Business Development Director" OR "Head of Sustainability")' },
  { key: "salesnav:energy_developers", name: "Energy developers (Renewables and Environment)", query: '("Head of Development" OR "Development Director" OR "Land Manager")' },
];

export function linkFor(kind: string, query: string): string {
  return kind === "xray"
    ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
    : `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(query)}`;
}

/** Idempotent. One weekly Apollo search per enabled segment, spread over weekdays, plus the link-outs. */
export async function ensureSavedSearches(db: Db, mandateId: string) {
  const segs = await db.select().from(segments).where(eq(segments.enabled, true)).orderBy(asc(segments.key));
  let i = 0;
  for (const s of segs) {
    const cadence = `weekly:${WEEKDAYS[i++ % WEEKDAYS.length]}:06:${String((i * 7) % 60).padStart(2, "0")}`;
    await db.insert(savedSearches).values({ mandateId, key: `seg:${s.key}`, name: `${s.name}: new people`, kind: "apollo_people", segmentId: s.id, params: s.apolloFilters, cadence })
      .onConflictDoNothing();
  }
  for (const x of XRAY_QUERIES) await db.insert(savedSearches).values({ mandateId, key: x.key, name: x.name, kind: "xray", query: x.query, cadence: "manual", enabled: true }).onConflictDoNothing();
  for (const x of SALESNAV_QUERIES) await db.insert(savedSearches).values({ mandateId, key: x.key, name: x.name, kind: "salesnav", query: x.query, cadence: "manual", enabled: true }).onConflictDoNothing();
}

/** Apollo searches whose cadence says they are due. */
export async function dueSavedSearches(db: Db, now = new Date()) {
  const rows = await db.select().from(savedSearches).where(and(eq(savedSearches.kind, "apollo_people"), eq(savedSearches.enabled, true),
    or(isNull(savedSearches.lastRunAt), lte(savedSearches.lastRunAt, new Date(now.getTime() - 86_400_000).toISOString()))));
  return rows.filter(r => !r.lastRunAt || nextRun(r.cadence, new Date(r.lastRunAt)) <= now);
}

const PEOPLE_KEYS = ["person_titles", "person_seniorities", "person_locations", "organization_locations", "q_keywords", "include_similar_titles"] as const;

export function toPeopleParams(params: Record<string, unknown> | null): PeopleSearchParams {
  const out: Record<string, unknown> = {};
  for (const k of PEOPLE_KEYS) if (params?.[k] !== undefined) out[k] = params[k];
  return out as PeopleSearchParams;
}

/** Runs one Apollo people search (0 credits). Returns how many new people were found. */
export async function runSavedSearch(db: Db, cfg: ApolloConfig, id: string, now = new Date(), fetchImpl?: typeof fetch): Promise<number> {
  const [s] = await db.select().from(savedSearches).where(eq(savedSearches.id, id));
  if (!s || s.kind !== "apollo_people") return 0;
  const res = await searchPeople(db, cfg, { ...toPeopleParams(s.params), per_page: 50, page: 1 }, fetchImpl);
  const ids = res.people.map(p => p.id);
  const inCrm = new Set(ids.length ? (await db.select({ id: contacts.apolloPersonId }).from(contacts)
    .where(and(eq(contacts.mandateId, s.mandateId), inArray(contacts.apolloPersonId, ids)))).map(r => r.id) : []);
  let added = 0;
  for (const p of res.people) {
    if (inCrm.has(p.id)) continue;
    const name = p.name || [p.first_name, p.last_name ?? p.last_name_obfuscated].filter(Boolean).join(" ") || "Unknown";
    const rows = await db.insert(searchResults).values({
      mandateId: s.mandateId, savedSearchId: s.id, kind: "person", externalId: p.id, name,
      subtitle: [p.title, p.organization?.name].filter(Boolean).join(" · ") || null, payload: p as Record<string, unknown>,
    }).onConflictDoNothing().returning({ id: searchResults.id });
    added += rows.length;
  }
  await db.update(savedSearches).set({ lastRunAt: now.toISOString(), lastNew: added, updatedAt: now.toISOString() }).where(eq(savedSearches.id, s.id));
  return added;
}
