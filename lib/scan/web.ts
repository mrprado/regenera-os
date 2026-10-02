// Open-web account discovery (scan provider "web"): Claude searches public sources (company sites, member directories,
// registries, procurement portals, news) for organizations matching the scan, then a structured pass keeps only
// candidates whose source URL appears in the research notes. Spend is capped per scan (researchBudgetUsd), every call is
// logged in ai_runs with the scan as its entity, and page text is treated as data. Coverage is broad, never "all sites".
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { aiRuns } from "@/db/schema";
import { runStructured, runWebResearch, type AiConfig } from "@/lib/ai/run";
import type { Audience } from "./audiences";
import type { ScanConfig } from "./config";
import { countryName, expandGeography, REGION_LABELS } from "./countries";

const zCandidates = z.object({
  candidates: z.array(z.object({
    name: z.string().min(2).max(200),
    website: z.string().max(300).default(""),
    country: z.string().max(80).default(""),
    evidence: z.string().max(600).default(""),
    sources: z.array(z.string().max(600)).default([]),
  })).max(40),
});
export type WebCandidate = z.infer<typeof zCandidates>["candidates"][number];

export const PER_CALL = 15;

export async function scanSpend(db: Db, runId: string): Promise<number> {
  const [r] = await db.select({ usd: sql<number>`coalesce(sum(${aiRuns.costUsd}), 0)` }).from(aiRuns).where(and(eq(aiRuns.entity, "scan_run"), eq(aiRuns.entityId, runId)));
  return r?.usd ?? 0;
}

/** Keeps candidates with at least one source URL present in the notes; normalizes URLs; never LinkedIn. */
const noteUrls = (notes: string) => new Set([...notes.matchAll(/https?:\/\/[^\s<>()"']+/g)].map(m => m[0].replace(/[.,;]+$/, "")));
const cleanSources = (sources: string[], urls: Set<string>) => sources.map(s => s.replace(/^<|>$/g, "").replace(/[.,;]+$/, "")).filter(s => urls.has(s) && !/linkedin\.com/i.test(s));
export function keepSourced(cands: WebCandidate[], notes: string): WebCandidate[] {
  const urls = noteUrls(notes);
  return cands.map(c => ({ ...c, sources: cleanSources(c.sources, urls) })).filter(c => c.sources.length > 0);
}

export function discoveryBrief(a: Audience, c: ScanConfig, already: string[], want: number) {
  const geo = c.geography.map(g => (g in REGION_LABELS ? REGION_LABELS[g as keyof typeof REGION_LABELS] : countryName(g)));
  return [
    `Audience: ${a.label}. ${a.purpose}`,
    `Geography: ${geo.length ? `${geo.join(", ")} (countries: ${expandGeography(c.geography).map(countryName).join(", ")})` : "any country"}.`,
    `Organization terms (any of): ${[...a.orgTerms, ...c.terms].join(", ")}.`,
    c.excludeTerms.length || a.exclude ? `Exclude organizations that are: ${[...c.excludeTerms, ...(a.exclude ? a.exclude.source.replace(/\\b|\(|\)|\//g, "").split("|") : [])].join(", ")}.` : "",
    c.signalCriteria ? `Prefer organizations with current evidence of: ${c.signalCriteria}.` : "",
    `Find up to ${want} organizations.`,
    already.length ? `Already found (skip these): ${already.slice(-120).join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}

const zOpps = z.object({
  items: z.array(z.object({
    title: z.string().min(3).max(300), type: z.enum(["tender", "rfp", "seeking_partner", "announcement"]), buyer: z.string().max(200).default(""),
    country: z.string().max(80).default(""), region: z.string().max(120).default(""), scope: z.string().max(400).default(""),
    size: z.number().nullable().default(null), sizeUnit: z.string().max(20).default(""), deadline: z.string().max(10).default(""),
    evidence: z.string().max(600).default(""), sources: z.array(z.string().max(600)).default([]),
  })).max(40),
});
export type WebOpportunity = z.infer<typeof zOpps>["items"][number];

export function opportunityBrief(c: ScanConfig, already: string[], want: number) {
  const geo = c.geography.map(g => (g in REGION_LABELS ? REGION_LABELS[g as keyof typeof REGION_LABELS] : countryName(g)));
  return [
    `Capabilities / scope the party delivers: ${c.capabilities.join(", ") || "not stated"}.`,
    `Geography: ${geo.length ? geo.join(", ") : "any"}.`,
    c.sizeMin != null || c.sizeMax != null ? `Size range: ${c.sizeMin ?? 0}–${c.sizeMax ?? "any"} ${c.sizeUnit ?? ""}.` : "",
    c.stages.length ? `Stages: ${c.stages.join(", ")}.` : "",
    c.excludeTerms.length ? `Exclude: ${c.excludeTerms.join(", ")}.` : "",
    `Find up to ${want} current items.`,
    already.length ? `Already found (skip): ${already.slice(-120).join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}

export async function webOpportunities(db: Db, cfg: AiConfig, runId: string, c: ScanConfig, already: string[], client?: Anthropic) {
  const notes = await runWebResearch(db, cfg, "scan.find_opportunities", opportunityBrief(c, already, PER_CALL), { maxSearches: 8, maxFetches: 8 }, { entity: "scan_run", entityId: runId }, client);
  if (!notes.trim()) return [] as WebOpportunity[];
  const out = await runStructured(db, cfg, "scan.extract_opportunities", notes, zOpps, { entity: "scan_run", entityId: runId }, client);
  const urls = noteUrls(notes);
  return out.items.map(i => ({ ...i, sources: cleanSources(i.sources, urls) })).filter(i => i.sources.length > 0);
}

export async function webDiscover(db: Db, cfg: AiConfig, runId: string, a: Audience, c: ScanConfig, already: string[], client?: Anthropic) {
  const notes = await runWebResearch(db, cfg, "scan.discover", discoveryBrief(a, c, already, PER_CALL), { maxSearches: 8, maxFetches: 8 }, { entity: "scan_run", entityId: runId }, client);
  if (!notes.trim()) return { candidates: [] as WebCandidate[], notes };
  const out = await runStructured(db, cfg, "scan.extract", notes, zCandidates, { entity: "scan_run", entityId: runId }, client);
  return { candidates: keepSourced(out.candidates, notes), notes };
}
