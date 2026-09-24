// Free legal-entity and identity sources (SPEC section 12a): GLEIF LEI, Wikidata, SEC EDGAR.
// Identity facts read today are current by definition; they carry their source for provenance.
import { z } from "zod";
import type { Db } from "@/db";
import { acquireSlot, fetchJson } from "./http";

const DAY = 86_400_000;

// ---------- GLEIF (no key) ----------
const zGleifRecord = z.object({
  id: z.string(),
  attributes: z.object({
    lei: z.string(),
    entity: z.object({
      legalName: z.object({ name: z.string() }),
      jurisdiction: z.string().nullish(),
      category: z.string().nullish(),
      status: z.string().nullish(),
      headquartersAddress: z.object({ city: z.string().nullish(), country: z.string().nullish() }).passthrough(),
    }).passthrough(),
    registration: z.object({ status: z.string().nullish(), lastUpdateDate: z.string().nullish() }).passthrough(),
  }).passthrough(),
}).passthrough();
const zGleifList = z.object({ data: z.array(zGleifRecord) });
const zGleifSingle = z.object({ data: zGleifRecord.nullable() });

export type LegalEntity = { lei: string; legalName: string; jurisdiction: string | null; country: string | null; city: string | null; status: string | null; lastUpdate: string | null };

const toEntity = (r: z.infer<typeof zGleifRecord>): LegalEntity => ({
  lei: r.attributes.lei,
  legalName: r.attributes.entity.legalName.name,
  jurisdiction: r.attributes.entity.jurisdiction ?? null,
  country: r.attributes.entity.headquartersAddress.country ?? null,
  city: r.attributes.entity.headquartersAddress.city ?? null,
  status: r.attributes.registration.status ?? null,
  lastUpdate: r.attributes.registration.lastUpdateDate ?? null,
});

export async function gleifSearch(db: Db, name: string, fetchImpl?: typeof fetch): Promise<LegalEntity[]> {
  const q = new URLSearchParams({ "filter[fulltext]": name, "filter[registration.status]": "ISSUED", "page[size]": "5" });
  const res = await fetchJson(db, {
    provider: "gleif", endpoint: "lei_search", url: `https://api.gleif.org/api/v1/lei-records?${q}`,
    schema: zGleifList, cacheKey: `search:${name.toLowerCase()}`, cacheTtlMs: 7 * DAY, fetchImpl,
  });
  return res.data.map(toEntity);
}

/** Direct or ultimate parent from GLEIF relationship records (fund to GP, subsidiary to group). */
export async function gleifParent(db: Db, lei: string, level: "direct" | "ultimate" = "ultimate", fetchImpl?: typeof fetch): Promise<LegalEntity | null> {
  try {
    const res = await fetchJson(db, {
      provider: "gleif", endpoint: "lei_parent", url: `https://api.gleif.org/api/v1/lei-records/${lei}/${level}-parent`,
      schema: zGleifSingle, cacheKey: `parent:${level}:${lei}`, cacheTtlMs: 7 * DAY, fetchImpl, retries: 0,
    });
    return res.data ? toEntity(res.data) : null;
  } catch {
    return null; // 404 = no reported parent
  }
}

// ---------- Wikidata (no key; UA required) ----------
const zWbSearch = z.object({ search: z.array(z.object({ id: z.string(), label: z.string().nullish(), description: z.string().nullish() })) });
const zClaimValue = z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).nullish() }) }).passthrough();
const zWbEntities = z.object({
  entities: z.record(z.object({
    labels: z.record(z.object({ value: z.string() })).nullish(),
    descriptions: z.record(z.object({ value: z.string() })).nullish(),
    claims: z.record(z.array(zClaimValue)).nullish(),
  }).passthrough()),
});

export type WikidataOrg = {
  qid: string; label: string | null; description: string | null; website: string | null;
  lei: string | null; hqQid: string | null; coordinates: { lat: number; lng: number } | null; countryQid: string | null;
};

function claim(entity: z.infer<typeof zWbEntities>["entities"][string], prop: string): unknown[] {
  return (entity.claims?.[prop] ?? []).map(c => c.mainsnak.datavalue?.value).filter(v => v !== undefined);
}
const qidOf = (v: unknown) => (v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : null);

export async function wikidataFindOrg(db: Db, name: string, fetchImpl?: typeof fetch): Promise<{ qid: string; label: string | null; description: string | null }[]> {
  const q = new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", type: "item", format: "json", limit: "5" });
  const res = await fetchJson(db, {
    provider: "wikidata", endpoint: "search", url: `https://www.wikidata.org/w/api.php?${q}`,
    schema: zWbSearch, cacheKey: `search:${name.toLowerCase()}`, cacheTtlMs: 7 * DAY, fetchImpl,
  });
  return res.search.map(s => ({ qid: s.id, label: s.label ?? null, description: s.description ?? null }));
}

export async function wikidataOrg(db: Db, qid: string, fetchImpl?: typeof fetch): Promise<WikidataOrg | null> {
  const q = new URLSearchParams({ action: "wbgetentities", ids: qid, props: "labels|descriptions|claims", languages: "en", format: "json" });
  const res = await fetchJson(db, {
    provider: "wikidata", endpoint: "entity", url: `https://www.wikidata.org/w/api.php?${q}`,
    schema: zWbEntities, cacheKey: `entity:${qid}`, cacheTtlMs: 7 * DAY, fetchImpl,
  });
  const e = res.entities[qid];
  if (!e) return null;
  const coord = claim(e, "P625")[0] as { latitude?: number; longitude?: number } | undefined;
  return {
    qid,
    label: e.labels?.en?.value ?? null,
    description: e.descriptions?.en?.value ?? null,
    website: (claim(e, "P856")[0] as string | undefined) ?? null,
    lei: (claim(e, "P1278")[0] as string | undefined) ?? null,
    hqQid: qidOf(claim(e, "P159")[0]),
    countryQid: qidOf(claim(e, "P17")[0]),
    coordinates: coord?.latitude !== undefined && coord.longitude !== undefined ? { lat: coord.latitude, lng: coord.longitude } : null,
  };
}

/** Coordinates of a place item (HQ city), used when the org item has none. */
export async function wikidataCoordinates(db: Db, qid: string, fetchImpl?: typeof fetch): Promise<{ lat: number; lng: number } | null> {
  const org = await wikidataOrg(db, qid, fetchImpl);
  return org?.coordinates ?? null;
}

// ---------- SEC EDGAR (no key; UA required; max 10 req/s) ----------
const zEftsHit = z.object({
  _id: z.string(),
  _source: z.object({
    ciks: z.array(z.string()).default([]),
    display_names: z.array(z.string()).default([]),
    file_date: z.string(),
    form: z.string().nullish(),
    root_forms: z.array(z.string()).default([]),
    biz_locations: z.array(z.string()).default([]),
    biz_states: z.array(z.string()).default([]),
    inc_states: z.array(z.string()).default([]),
    adsh: z.string().nullish(),
  }).passthrough(),
});
const zEfts = z.object({ hits: z.object({ total: z.object({ value: z.number() }).passthrough(), hits: z.array(zEftsHit) }) });

export type EdgarFiling = {
  accession: string; form: string; fileDate: string; entityName: string; cik: string;
  location: string | null; url: string;
};

/** EDGAR full-text search, e.g. new Form D fund raises mentioning "natural capital" since a date. */
export async function edgarSearch(db: Db, params: { q: string; forms?: string[]; since: string; until: string }, fetchImpl?: typeof fetch): Promise<EdgarFiling[]> {
  await acquireSlot(db, "edgar", 150);
  const q = new URLSearchParams({ q: params.q, dateRange: "custom", startdt: params.since, enddt: params.until });
  if (params.forms?.length) q.set("forms", params.forms.join(","));
  const res = await fetchJson(db, {
    provider: "edgar", endpoint: "full_text_search", url: `https://efts.sec.gov/LATEST/search-index?${q}`,
    schema: zEfts, cacheKey: `efts:${q}`, cacheTtlMs: 6 * 3_600_000, fetchImpl,
  });
  return res.hits.hits.map(h => {
    const accession = h._source.adsh ?? h._id.split(":")[0];
    const cik = (h._source.ciks?.[0] ?? "").replace(/^0+/, "");
    const name = (h._source.display_names?.[0] ?? "").replace(/\s*\(CIK \d+\)\s*$/, "").trim();
    return {
      accession,
      form: h._source.form ?? h._source.root_forms?.[0] ?? "",
      fileDate: h._source.file_date,
      entityName: name,
      cik,
      location: h._source.biz_locations?.[0] ?? null,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/`,
    };
  });
}
