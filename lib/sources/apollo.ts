// Apollo.io on the FREE plan (SPEC section 12a). Search is 0 credits; enrichment spends free credits.
// Limits are enforced locally from the provider_calls ledger so the OS never exceeds the free plan.
import { z } from "zod";
import type { Db } from "@/db";
import { callsSince, creditsSince, fetchJson, SourceError } from "./http";

const BASE = "https://api.apollo.io/api/v1";

/** As published for the free plan (docs.apollo.io/reference/rate-limits, checked Sep 23, 2026). */
export const APOLLO_FREE_LIMITS = {
  search: { perMinute: 50, perHour: 200, perDay: 600 },
  enrich: { perMinute: 50, perHour: 200, perDay: 600 },
} as const;

export type ApolloConfig = { apiKey: string; monthlyCreditBudget: number };

const zOrg = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  website_url: z.string().nullish(),
  primary_domain: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  industry: z.string().nullish(),
  estimated_num_employees: z.number().nullish(),
  founded_year: z.number().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  short_description: z.string().nullish(),
}).passthrough();

const zPerson = z.object({
  id: z.string(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  last_name_obfuscated: z.string().nullish(),
  name: z.string().nullish(),
  title: z.string().nullish(),
  seniority: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  email: z.string().nullish(),
  email_status: z.string().nullish(),
  organization_id: z.string().nullish(),
  organization: zOrg.nullish(),
}).passthrough();
export type ApolloPerson = z.infer<typeof zPerson>;
export type ApolloOrg = z.infer<typeof zOrg>;

const zPeopleSearch = z.object({
  people: z.array(zPerson).default([]),
  total_entries: z.number().nullish(),
  pagination: z.object({ page: z.number(), per_page: z.number(), total_entries: z.number(), total_pages: z.number() }).partial().nullish(),
}).passthrough();

const zOrgSearch = z.object({
  organizations: z.array(zOrg).default([]),
  accounts: z.array(zOrg).default([]),
  pagination: z.object({ page: z.number(), per_page: z.number(), total_entries: z.number(), total_pages: z.number() }).partial().nullish(),
}).passthrough();

const zMatch = z.object({ person: zPerson.nullish(), match_confidence: z.string().nullish() }).passthrough();

export type PeopleSearchParams = {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  q_organization_domains_list?: string[];
  q_keywords?: string;
  include_similar_titles?: boolean;
  page?: number;
  per_page?: number;
};

function toQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const item of v) { if (item) q.append(`${k}[]`, String(item)); }
    else q.set(k, String(v));
  }
  return q.toString();
}

/**
 * Throws before a call that would break a free-plan window. Apollo counts per endpoint, per team;
 * every attempt (including failures) is counted, which is the conservative reading.
 */
export async function assertWithinLimits(db: Db, kind: keyof typeof APOLLO_FREE_LIMITS, endpoint: string, now = new Date()) {
  const lim = APOLLO_FREE_LIMITS[kind];
  const checks: [number, number, string][] = [
    [60_000, lim.perMinute, "minute"],
    [3_600_000, lim.perHour, "hour"],
    [86_400_000, lim.perDay, "day"],
  ];
  for (const [ms, max, label] of checks) {
    const used = await callsSince(db, "apollo", new Date(now.getTime() - ms), endpoint);
    if (used >= max) throw new SourceError("apollo", `free-plan limit reached for this ${label} (${max} ${kind} requests). Try again later.`, 429, true);
  }
}

export async function creditsUsedThisMonth(db: Db, now = new Date()): Promise<number> {
  return creditsSince(db, "apollo", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

function headers(cfg: ApolloConfig) {
  return { "x-api-key": cfg.apiKey, "content-type": "application/json", "cache-control": "no-cache" };
}

/** People API Search: net-new people, no emails, 0 credits. Cached 6h per query. */
export async function searchPeople(db: Db, cfg: ApolloConfig, params: PeopleSearchParams, fetchImpl?: typeof fetch) {
  await assertWithinLimits(db, "search", "search_people");
  const query = toQuery({ ...params, per_page: params.per_page ?? 25, page: params.page ?? 1 });
  return fetchJson(db, {
    provider: "apollo", endpoint: "search_people",
    url: `${BASE}/mixed_people/api_search?${query}`,
    init: { method: "POST", headers: headers(cfg) },
    schema: zPeopleSearch, cacheKey: `people:${query}`, cacheTtlMs: 6 * 3_600_000, fetchImpl,
  });
}

export async function searchOrganizations(db: Db, cfg: ApolloConfig, params: {
  q_organization_name?: string; organization_locations?: string[]; q_organization_keyword_tags?: string[];
  organization_num_employees_ranges?: string[]; page?: number; per_page?: number;
}, fetchImpl?: typeof fetch) {
  // Unlike people search, Organization Search costs 1 credit per page (docs, Sep 23, 2026),
  // so pages are always 100 results and cached for a day.
  await assertWithinLimits(db, "search", "search_organizations");
  await assertCredits(db, cfg, 1);
  const query = toQuery({ ...params, per_page: 100, page: params.page ?? 1 });
  return fetchJson(db, {
    provider: "apollo", endpoint: "search_organizations",
    url: `${BASE}/mixed_companies/search?${query}`,
    init: { method: "POST", headers: headers(cfg) },
    schema: zOrgSearch, cacheKey: `orgs:${query}`, cacheTtlMs: 24 * 3_600_000, fetchImpl,
    credits: () => 1,
  });
}

async function assertCredits(db: Db, cfg: ApolloConfig, needed: number) {
  const used = await creditsUsedThisMonth(db);
  if (used + needed > cfg.monthlyCreditBudget) {
    throw new SourceError("apollo", `monthly credit budget reached (${used}/${cfg.monthlyCreditBudget}).`, 402);
  }
}

/**
 * People Enrichment for one person. Never reveals phone numbers (8 credits each).
 * Credits: 1 when an email or demographics come back, 0 when nothing matched.
 */
export async function enrichPerson(db: Db, cfg: ApolloConfig, input: {
  id?: string; first_name?: string; last_name?: string; name?: string; email?: string; domain?: string; organization_name?: string; linkedin_url?: string;
}, fetchImpl?: typeof fetch) {
  await assertWithinLimits(db, "enrich", "enrich_person");
  await assertCredits(db, cfg, 1);
  const query = toQuery({ ...input, reveal_personal_emails: false, reveal_phone_number: false });
  return fetchJson(db, {
    provider: "apollo", endpoint: "enrich_person",
    url: `${BASE}/people/match?${query}`,
    init: { method: "POST", headers: headers(cfg) },
    schema: zMatch,
    credits: d => (d.person && d.match_confidence !== "none" && (d.person.email || d.person.title) ? 1 : 0),
    fetchImpl,
  });
}

export function apolloEmailStatus(status: string | null | undefined): "verified_provider" | "unverified" | "unknown" {
  if (status === "verified") return "verified_provider";
  if (status) return "unverified";
  return "unknown";
}
