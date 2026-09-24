// Funding sources (docs/plans/phase-5.md part A). Global, free, open data only, checked Sep 24, 2026:
// Grants.gov (US federal, no key), EU Funding & Tenders Portal (public search API), EU TED and World Bank
// (reused from the trigger engine's fetchers), UK Contracts Finder (OCDS JSON). Only open or forthcoming
// opportunities with a deadline today or later are returned.
import { z } from "zod";
import type { Db } from "@/db";
import { fetchJson } from "@/lib/sources/http";
import { tedSignals, worldBankSignals, type RawSignal } from "@/lib/sources/signals";

export type FundingItem = {
  source: "grants_gov" | "eu_funding" | "ted" | "worldbank" | "uk_contracts";
  externalId: string;
  title: string;
  funder: string | null;
  programme: string | null;
  type: "grant" | "tender" | "call" | "prize" | "concessional";
  amountMin: number | null;
  amountMax: number | null;
  currency: string | null;
  openDate: string | null;   // YYYY-MM-DD
  deadline: string | null;   // YYYY-MM-DD
  status: "forthcoming" | "open";
  countries: string[];
  applicantTypes: string[];
  url: string;
  description: string;
};

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const stillOpen = (deadline: string | null, now: Date) => !deadline || deadline >= now.toISOString().slice(0, 10);
const num = (v: unknown) => { const n = typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : typeof v === "number" ? v : NaN; return Number.isFinite(n) && n > 0 ? n : null; };

// ---------- Grants.gov ----------
const zGgSearch = z.object({
  data: z.object({
    oppHits: z.array(z.object({
      id: z.string(), number: z.string().nullish(), title: z.string(), agency: z.string().nullish(), agencyCode: z.string().nullish(),
      openDate: z.string().nullish(), closeDate: z.string().nullish(), oppStatus: z.string().nullish(), docType: z.string().nullish(),
    }).passthrough()).default([]),
  }).passthrough(),
}).passthrough();

const zGgDetail = z.object({
  data: z.object({
    synopsis: z.object({
      awardCeiling: z.union([z.string(), z.number()]).nullish(), awardFloor: z.union([z.string(), z.number()]).nullish(),
      applicantTypes: z.array(z.object({ description: z.string().nullish() }).passthrough()).nullish(),
      synopsisDesc: z.string().nullish(), responseDate: z.string().nullish(),
    }).passthrough().nullish(),
  }).passthrough(),
}).passthrough();

/** "MM/DD/YYYY" to YYYY-MM-DD. */
export function usDate(s: string | null | undefined) {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export async function grantsGov(db: Db, keyword: string, now = new Date(), fetchImpl?: typeof fetch, detailLimit = 8): Promise<FundingItem[]> {
  const res = await fetchJson(db, {
    provider: "grants_gov", endpoint: "search2", url: "https://api.grants.gov/v1/api/search2",
    init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keyword, oppStatuses: "forecasted|posted", rows: 25 }) },
    schema: zGgSearch, cacheKey: `gg:${keyword}:${now.toISOString().slice(0, 10)}`, cacheTtlMs: 12 * 3_600_000, fetchImpl,
  });
  const out: FundingItem[] = [];
  let details = 0;
  for (const h of res.data.oppHits) {
    const deadline = usDate(h.closeDate);
    if (!stillOpen(deadline, now)) continue;
    const item: FundingItem = {
      source: "grants_gov", externalId: h.id, title: h.title, funder: h.agency ?? h.agencyCode ?? null, programme: h.number ?? null,
      type: "grant", amountMin: null, amountMax: null, currency: "USD", openDate: usDate(h.openDate), deadline,
      status: h.oppStatus === "forecasted" ? "forthcoming" : "open", countries: ["United States"], applicantTypes: [],
      url: `https://www.grants.gov/search-results-detail/${h.id}`, description: "",
    };
    // Details (amounts, eligible applicants, description) for the first few hits of each search only.
    if (details < detailLimit) {
      details++;
      try {
        const d = await fetchJson(db, {
          provider: "grants_gov", endpoint: "fetchOpportunity", url: "https://api.grants.gov/v1/api/fetchOpportunity",
          init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId: Number(h.id) }) },
          schema: zGgDetail, cacheKey: `gg-detail:${h.id}`, cacheTtlMs: 7 * 86_400_000, fetchImpl,
        });
        const s = d.data.synopsis;
        if (s) {
          item.amountMin = num(s.awardFloor); item.amountMax = num(s.awardCeiling);
          item.applicantTypes = (s.applicantTypes ?? []).map(a => a.description ?? "").filter(Boolean).slice(0, 12);
          item.description = (s.synopsisDesc ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
        }
      } catch { /* the search hit still stands without details */ }
    }
    out.push(item);
  }
  return out;
}

// ---------- EU Funding & Tenders Portal ----------
const zEu = z.object({
  results: z.array(z.object({
    reference: z.string().nullish(), summary: z.string().nullish(), content: z.string().nullish(),
    metadata: z.record(z.string(), z.array(z.string()).nullish()).nullish(),
  }).passthrough()).default([]),
}).passthrough();

type EuBudget = { budgetTopicActionMap?: Record<string, { minContribution?: number; maxContribution?: number }[]> };

export function euBudgetRange(raw: string | undefined): { min: number | null; max: number | null } {
  try {
    const b = raw ? (JSON.parse(raw) as EuBudget) : {};
    const actions = Object.values(b.budgetTopicActionMap ?? {}).flat();
    const mins = actions.map(a => a.minContribution ?? 0).filter(n => n > 0);
    const maxs = actions.map(a => a.maxContribution ?? 0).filter(n => n > 0);
    return { min: mins.length ? Math.min(...mins) : null, max: maxs.length ? Math.max(...maxs) : null };
  } catch { return { min: null, max: null }; }
}

const EU_STATUS: Record<string, "forthcoming" | "open"> = { "31094501": "forthcoming", "31094502": "open" };

export async function euFunding(db: Db, text: string, now = new Date(), fetchImpl?: typeof fetch): Promise<FundingItem[]> {
  const form = new FormData();
  form.append("query", new Blob([JSON.stringify({ bool: { must: [{ terms: { type: ["1", "2", "8"] } }, { terms: { status: ["31094501", "31094502"] } }] } })], { type: "application/json" }));
  form.append("languages", new Blob([JSON.stringify(["en"])], { type: "application/json" }));
  const res = await fetchJson(db, {
    provider: "eu_funding", endpoint: "search",
    url: `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=${encodeURIComponent(text)}&pageSize=40&pageNumber=1`,
    init: { method: "POST", body: form },
    schema: zEu, cacheKey: `eu:${text}:${now.toISOString().slice(0, 10)}`, cacheTtlMs: 12 * 3_600_000, fetchImpl,
  });
  const out: FundingItem[] = [];
  for (const r of res.results) {
    const m = r.metadata ?? {};
    const id = m.identifier?.[0];
    const status = EU_STATUS[m.status?.[0] ?? ""];
    const deadline = day(m.deadlineDate?.[0]);
    if (!id || !status || !stillOpen(deadline, now)) continue;
    const { min, max } = euBudgetRange(m.budgetOverview?.[0]);
    out.push({
      source: "eu_funding", externalId: id, title: m.title?.[0] ?? r.summary ?? id, funder: "European Commission", programme: m.callIdentifier?.[0] ?? null,
      type: "call", amountMin: min, amountMax: max, currency: "EUR", openDate: day(m.startDate?.[0]), deadline, status,
      countries: ["European Union", "Associated and third countries (check the call)"], applicantTypes: [],
      url: `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${id}`,
      description: (r.content ?? r.summary ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000),
    });
  }
  return out;
}

// ---------- UK Contracts Finder (OCDS) ----------
const zUk = z.object({
  releases: z.array(z.object({
    ocid: z.string(), date: z.string().nullish(),
    tender: z.object({
      title: z.string().nullish(), description: z.string().nullish(), status: z.string().nullish(),
      value: z.object({ amount: z.number().nullish(), currency: z.string().nullish() }).nullish(),
      tenderPeriod: z.object({ startDate: z.string().nullish(), endDate: z.string().nullish() }).nullish(),
    }).passthrough().nullish(),
    parties: z.array(z.object({ name: z.string().nullish(), roles: z.array(z.string()).nullish() }).passthrough()).nullish(),
  }).passthrough()).default([]),
}).passthrough();

export async function ukContracts(db: Db, keyword: string, now = new Date(), fetchImpl?: typeof fetch): Promise<FundingItem[]> {
  const res = await fetchJson(db, {
    provider: "uk_contracts", endpoint: "ocds_search",
    url: `https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?keyword=${encodeURIComponent(keyword)}&stages=tender&limit=50`,
    schema: zUk, cacheKey: `uk:${keyword}:${now.toISOString().slice(0, 10)}`, cacheTtlMs: 12 * 3_600_000, fetchImpl,
  });
  const out: FundingItem[] = [];
  for (const r of res.releases) {
    const t = r.tender;
    const deadline = day(t?.tenderPeriod?.endDate);
    if (!t?.title || !deadline || !stillOpen(deadline, now)) continue;
    const buyer = r.parties?.find(p => p.roles?.includes("buyer"))?.name ?? r.parties?.[0]?.name ?? null;
    out.push({
      source: "uk_contracts", externalId: r.ocid, title: t.title, funder: buyer, programme: null, type: "tender",
      amountMin: null, amountMax: t.value?.amount ?? null, currency: t.value?.currency ?? "GBP", openDate: day(t.tenderPeriod?.startDate ?? r.date), deadline,
      status: "open", countries: ["United Kingdom"], applicantTypes: ["Businesses", "Consultancies"],
      url: `https://www.contractsfinder.service.gov.uk/Notice/${r.ocid.replace(/^ocds-b5fd17-/, "")}`,
      description: (t.description ?? "").slice(0, 3000),
    });
  }
  return out;
}

// ---------- EU TED and World Bank: the trigger engine's fetchers, reshaped ----------
function fromSignal(s: RawSignal): FundingItem {
  return {
    source: s.source === "ted" ? "ted" : "worldbank", externalId: s.externalId, title: s.title, funder: s.orgName ?? (s.source === "worldbank" ? "World Bank-financed project" : null),
    programme: null, type: "tender", amountMin: null, amountMax: null, currency: null, openDate: day(s.publishedAt), deadline: day(s.deadline),
    status: "open", countries: s.country ? [s.country] : [], applicantTypes: ["Consultancies", "Businesses"], url: s.url, description: s.summary ?? "",
  };
}

export async function tedFunding(db: Db, text: string, now = new Date(), fetchImpl?: typeof fetch) {
  return (await tedSignals(db, text, now, fetchImpl)).map(fromSignal);
}

export async function worldBankFunding(db: Db, term: string, now = new Date(), fetchImpl?: typeof fetch) {
  return (await worldBankSignals(db, term, now, fetchImpl)).map(fromSignal);
}
