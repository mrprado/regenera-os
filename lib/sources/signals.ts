// Trigger sources (SPEC sections 4 and 12a). Each returns current signals only (lib/freshness.ts),
// normalized to one shape so the trigger engine can deduplicate, classify and map them.
import { z } from "zod";
import type { Db } from "@/db";
import { compactDate, isCurrent, isOpenDeadline, windowStart } from "@/lib/freshness";
import { acquireSlot, fetchJson, SourceError } from "./http";
import { edgarSearch } from "./identity";

export type RawSignal = {
  source: "gdelt" | "ted" | "worldbank" | "edgar_form_d" | "gdacs";
  externalId: string;
  title: string;
  url: string;
  publishedAt: string;        // ISO
  deadline?: string | null;   // ISO
  country?: string | null;    // name or ISO code as given by the source
  lat?: number | null;
  lng?: number | null;
  orgName?: string | null;
  summary?: string;
};

// ---------- GDELT DOC 2.0: global news, many languages, one request per 5 seconds ----------
const zGdelt = z.object({
  articles: z.array(z.object({
    url: z.string(), title: z.string(), seendate: z.string(), domain: z.string().nullish(),
    language: z.string().nullish(), sourcecountry: z.string().nullish(),
  })).default([]),
}).passthrough();

const gdeltDate = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;

export async function gdeltSignals(db: Db, query: string, now = new Date(), fetchImpl?: typeof fetch): Promise<RawSignal[]> {
  if (!(await acquireSlot(db, "gdelt", 5_500, now))) throw new SourceError("gdelt", "rate slot busy, retry next tick", 429, true);
  const q = new URLSearchParams({
    query, mode: "artlist", format: "json", maxrecords: "50", sort: "datedesc",
    startdatetime: `${compactDate(windowStart("news", now))}000000`,
  });
  const res = await fetchJson(db, {
    provider: "gdelt", endpoint: "doc", url: `https://api.gdeltproject.org/api/v2/doc/doc?${q}`,
    schema: zGdelt, cacheKey: `doc:${query}:${compactDate(now)}`, cacheTtlMs: 3 * 3_600_000, fetchImpl, retries: 0,
  });
  return (res.articles ?? [])
    .map(a => ({
      source: "gdelt" as const, externalId: a.url, title: a.title.trim(), url: a.url, publishedAt: gdeltDate(a.seendate),
      country: a.sourcecountry ?? null, summary: `${a.domain ?? ""}${a.language ? ` (${a.language})` : ""}`,
    }))
    .filter(s => isCurrent(s.publishedAt, "news", now));
}

// ---------- TED: EU public procurement (POST search, no key) ----------
const zTed = z.object({
  notices: z.array(z.object({
    "publication-number": z.string(),
    "publication-date": z.string().nullish(),
    "notice-title": z.record(z.string()).nullish(),
    "buyer-name": z.record(z.array(z.string())).nullish(),
    "buyer-country": z.array(z.string()).nullish(),
    "deadline-receipt-tender-date-lot": z.array(z.string()).nullish(),
    "notice-type": z.string().nullish(),
  }).passthrough()).default([]),
}).passthrough();

const pickLang = (r: Record<string, string | string[]> | null | undefined) => {
  if (!r) return null;
  const v = r.eng ?? r.ENG ?? Object.values(r)[0];
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
};

export async function tedSignals(db: Db, fullText: string, now = new Date(), fetchImpl?: typeof fetch): Promise<RawSignal[]> {
  const since = compactDate(windowStart("procurement", now));
  const res = await fetchJson(db, {
    provider: "ted", endpoint: "notices_search", url: "https://api.ted.europa.eu/v3/notices/search",
    init: {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `FT~"${fullText.replace(/"/g, "")}" AND publication-date>=${since} AND notice-type IN (cn-standard cn-social pin-only pin-cfc-standard)`,
        fields: ["publication-number", "publication-date", "notice-title", "buyer-name", "buyer-country", "deadline-receipt-tender-date-lot", "notice-type"],
        limit: 50, page: 1,
      }),
    },
    schema: zTed, cacheKey: `ft:${fullText}:${compactDate(now)}`, cacheTtlMs: 6 * 3_600_000, fetchImpl,
  });
  return (res.notices ?? [])
    .map(n => {
      const published = (n["publication-date"] ?? "").slice(0, 10);
      const deadline = n["deadline-receipt-tender-date-lot"]?.[0]?.slice(0, 10) ?? null;
      return {
        source: "ted" as const,
        externalId: n["publication-number"],
        title: pickLang(n["notice-title"]) ?? `TED notice ${n["publication-number"]}`,
        url: `https://ted.europa.eu/en/notice/-/detail/${n["publication-number"]}`,
        publishedAt: published ? `${published}T00:00:00Z` : "",
        deadline: deadline ? `${deadline}T23:59:59Z` : null,
        country: n["buyer-country"]?.[0] ?? null,
        orgName: pickLang(n["buyer-name"]),
        summary: n["notice-type"] ?? "",
      };
    })
    .filter(s => isCurrent(s.publishedAt, "procurement", now) && isOpenDeadline(s.deadline, now));
}

// ---------- World Bank procurement notices (no key) ----------
const zWb = z.object({
  procnotices: z.array(z.object({
    id: z.string(), notice_type: z.string().nullish(), noticedate: z.string().nullish(),
    submission_deadline_date: z.string().nullish(), project_ctry_name: z.string().nullish(),
    project_name: z.string().nullish(), bid_description: z.string().nullish(), project_id: z.string().nullish(),
  }).passthrough()).default([]),
}).passthrough();

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const wbDate = (s: string | null | undefined) => {
  const m = s?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  return m ? `${m[3]}-${MONTHS[m[2]] ?? "01"}-${m[1].padStart(2, "0")}T00:00:00Z` : "";
};

export async function worldBankSignals(db: Db, term: string, now = new Date(), fetchImpl?: typeof fetch): Promise<RawSignal[]> {
  const q = new URLSearchParams({
    format: "json", rows: "50", os: "0", qterm: term,
    strdate: windowStart("procurement", now).toISOString().slice(0, 10),
    fl: "id,notice_type,noticedate,submission_deadline_date,project_ctry_name,project_name,bid_description,project_id",
  });
  const res = await fetchJson(db, {
    provider: "worldbank", endpoint: "procnotices", url: `https://search.worldbank.org/api/v2/procnotices?${q}`,
    schema: zWb, cacheKey: `pn:${term}:${compactDate(now)}`, cacheTtlMs: 6 * 3_600_000, fetchImpl,
  });
  return (res.procnotices ?? [])
    .map(n => ({
      source: "worldbank" as const,
      externalId: n.id,
      title: (n.bid_description || n.project_name || n.id).replace(/\s+/g, " ").trim(),
      url: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
      publishedAt: wbDate(n.noticedate),
      deadline: n.submission_deadline_date ?? null,
      country: n.project_ctry_name ?? null,
      orgName: n.project_name ? `${n.project_name} (World Bank ${n.project_id ?? ""})`.trim() : null,
      summary: n.notice_type ?? "",
    }))
    .filter(s => isCurrent(s.publishedAt, "procurement", now) && isOpenDeadline(s.deadline, now));
}

// ---------- SEC EDGAR Form D: new private fund raises (capital triggers) ----------
export async function formDSignals(db: Db, phrase: string, now = new Date(), fetchImpl?: typeof fetch): Promise<RawSignal[]> {
  const since = windowStart("filing", now).toISOString().slice(0, 10);
  const filings = await edgarSearch(db, { q: `"${phrase}"`, forms: ["D"], since, until: now.toISOString().slice(0, 10) }, fetchImpl);
  return filings
    .map(f => ({
      source: "edgar_form_d" as const,
      externalId: f.accession,
      title: `Form D filed: ${f.entityName}`,
      url: f.url,
      publishedAt: `${f.fileDate}T00:00:00Z`,
      country: "United States",
      orgName: f.entityName,
      summary: [f.location, `matched "${phrase}"`].filter(Boolean).join(" · "),
    }))
    .filter(s => isCurrent(s.publishedAt, "filing", now));
}

// ---------- GDACS hazards, via the regenera.bio intelligence API (already normalized there) ----------
const zGdacs = z.object({
  featureCollection: z.object({
    features: z.array(z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        eventId: z.union([z.number(), z.string()]), eventType: z.string(), name: z.string(),
        country: z.string().nullish(), iso3: z.string().nullish(), alertLevel: z.string().nullish(),
        fromDate: z.string().nullish(), url: z.string().nullish(),
      }).passthrough(),
    })),
  }),
});

export async function gdacsSignals(db: Db, now = new Date(), fetchImpl?: typeof fetch): Promise<RawSignal[]> {
  const res = await fetchJson(db, {
    provider: "gdacs", endpoint: "site_feed", url: "https://regenera.bio/api/intelligence/hazards/gdacs",
    schema: zGdacs, cacheKey: `feed:${now.toISOString().slice(0, 13)}`, cacheTtlMs: 3_600_000, fetchImpl,
  });
  return res.featureCollection.features
    .filter(f => f.properties.alertLevel === "Red" || f.properties.alertLevel === "Orange")
    .map(f => ({
      source: "gdacs" as const,
      externalId: `${f.properties.eventType}-${f.properties.eventId}`,
      title: `${f.properties.alertLevel} alert: ${f.properties.name}`,
      url: f.properties.url ?? "https://www.gdacs.org",
      publishedAt: f.properties.fromDate ? `${f.properties.fromDate}Z`.replace(/ZZ$/, "Z") : now.toISOString(),
      country: f.properties.iso3 ?? f.properties.country ?? null,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      summary: f.properties.eventType,
    }))
    .filter(s => isCurrent(s.publishedAt, "hazard", now));
}
