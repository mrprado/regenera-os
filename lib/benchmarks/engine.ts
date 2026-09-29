// Benchmark engine. Normalises money benchmarks to USD in a target year (FX: ECB rates via Frankfurter, with the World
// Bank official rate as fallback; inflation: World Bank US CPI), compares a project value with local / regional /
// global sets (percentile, median, deviation, comparable scale), flags material deviations as questions, and detects
// contradictions between sources for the same fact. It never concludes a figure is wrong; it asks why.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { bids, costBenchmarks, economicCases, finModels, procurementPackages, projects, storageSpecs } from "@/db/schema";
import type { Db } from "@/db";
import { fetchJson } from "@/lib/sources/http";
import { lcos } from "@/lib/power/engine";
import { CURRENCY_COUNTRY, METRICS } from "./vocab";

type Bench = typeof costBenchmarks.$inferSelect;
const DAY = 86_400_000;

const zFx = z.object({ rates: z.record(z.number()) });
const zWb = z.tuple([z.object({}).passthrough(), z.array(z.object({ date: z.string(), value: z.number().nullable() })).nullable()]);

/** USD per unit of `currency` in `year` (mid-year). Null when no free source covers it. */
export async function usdPer(db: Db, currency: string, year: number, fetchImpl?: typeof fetch): Promise<{ rate: number; source: string } | null> {
  const cur = currency.toUpperCase();
  if (cur === "USD") return { rate: 1, source: "USD" };
  const y = Math.min(year, new Date().getUTCFullYear());
  try {
    const r = await fetchJson(db, { provider: "frankfurter", endpoint: "fx", url: `https://api.frankfurter.dev/v1/${y}-07-01?base=${cur}&symbols=USD`, schema: zFx, cacheKey: `fx:${cur}:${y}`, cacheTtlMs: 365 * DAY, staleOnError: true, fetchImpl });
    if (r.rates.USD) return { rate: r.rates.USD, source: `ECB reference rate ${y}-07-01 (Frankfurter)` };
  } catch { /* fall through to the World Bank */ }
  const iso3 = CURRENCY_COUNTRY[cur];
  if (!iso3) return null;
  try {
    const r = await fetchJson(db, { provider: "wb_indicators", endpoint: "fx", url: `https://api.worldbank.org/v2/country/${iso3}/indicator/PA.NUS.FCRF?format=json&date=${y - 3}:${y}`, schema: zWb, cacheKey: `wbfx:${iso3}:${y}`, cacheTtlMs: 180 * DAY, staleOnError: true, fetchImpl });
    const v = (r[1] ?? []).filter(x => x.value !== null).sort((a, b) => b.date.localeCompare(a.date))[0];
    return v?.value ? { rate: 1 / v.value, source: `World Bank official rate ${v.date} (${iso3})` } : null;
  } catch { return null; }
}

/** US CPI (2010 = 100) by year from the World Bank; the latest published year is used for later years (flagged). */
export async function usCpi(db: Db, fetchImpl?: typeof fetch): Promise<Map<number, number>> {
  const r = await fetchJson(db, { provider: "wb_indicators", endpoint: "cpi", url: "https://api.worldbank.org/v2/country/USA/indicator/FP.CPI.TOTL?format=json&date=1990:2030&per_page=60", schema: zWb, cacheKey: "cpi:USA", cacheTtlMs: 30 * DAY, staleOnError: true, fetchImpl });
  return new Map((r[1] ?? []).filter(x => x.value !== null).map(x => [Number(x.date), x.value!]));
}

export type Normalised = { id: string; usd: number | null; notes: string[]; b: Bench };
export async function normalise(db: Db, rows: Bench[], targetYear: number, fetchImpl?: typeof fetch): Promise<Normalised[]> {
  const cpi = rows.some(b => METRICS[b.metric]?.kind.startsWith("money")) ? await usCpi(db, fetchImpl).catch(() => new Map<number, number>()) : new Map<number, number>();
  const latest = cpi.size ? Math.max(...cpi.keys()) : null;
  const cpiAt = (y: number) => cpi.get(y) ?? (latest && y > latest ? cpi.get(latest) : undefined);
  const out: Normalised[] = [];
  for (const b of rows) {
    const kind = METRICS[b.metric]?.kind ?? "physical";
    if (!kind.startsWith("money")) { out.push({ id: b.id, usd: b.value, notes: [], b }); continue; }
    const notes: string[] = [];
    if (!b.currency) { out.push({ id: b.id, usd: null, notes: ["Currency unknown: excluded from comparison"], b }); continue; }
    const year = b.baseYear ?? (b.sourceDate ? Number(b.sourceDate.slice(0, 4)) : null);
    if (!year) { out.push({ id: b.id, usd: null, notes: ["Base year unknown: excluded from comparison"], b }); continue; }
    const fx = await usdPer(db, b.currency, year, fetchImpl);
    if (!fx) { out.push({ id: b.id, usd: null, notes: [`No free FX source for ${b.currency}`], b }); continue; }
    let usd = b.value * fx.rate;
    if (b.currency !== "USD") notes.push(`${b.currency}→USD at ${fx.rate.toPrecision(4)} (${fx.source})`);
    const from = cpiAt(year), to = cpiAt(targetYear);
    if (from && to && year !== targetYear) { usd *= to / from; notes.push(`US CPI ${year}→${targetYear}${latest && targetYear > latest ? ` (latest CPI ${latest})` : ""}`); }
    else if (year !== targetYear) notes.push("Not inflation-adjusted (CPI unavailable)");
    out.push({ id: b.id, usd, notes, b });
  }
  return out;
}

export function percentile(sorted: number[], v: number) {
  if (!sorted.length) return null;
  const below = sorted.filter(x => x < v).length, equal = sorted.filter(x => x === v).length;
  return Math.round(((below + equal / 2) / sorted.length) * 100);
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const q = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };

export type Comparison = {
  metric: string; value: number; valueUsd: number | null; valueNotes: string[]; sets: { name: string; n: number; median: number | null; p10: number | null; p90: number | null; percentile: number | null }[];
  flag: "material_above" | "above" | "within" | "below" | "material_below" | "insufficient"; question: string | null; sources: Normalised[];
};
/** Compare one project value with benchmarks for the same technology and metric. */
export async function compareValue(db: Db, mandateIds: string[], input: { technology: string; metric: string; value: number; currency: string | null; year: number; country?: string | null; region?: string | null; scaleValue?: number | null }, fetchImpl?: typeof fetch): Promise<Comparison> {
  const rows = (await db.select().from(costBenchmarks).where(and(inArray(costBenchmarks.mandateId, mandateIds), eq(costBenchmarks.technology, input.technology), eq(costBenchmarks.metric, input.metric), isNull(costBenchmarks.deletedAt)))).filter(b => !b.projectId || b.projectId !== (input as { projectId?: string }).projectId);
  const norm = (await normalise(db, rows, input.year, fetchImpl)).filter(n => n.usd !== null);
  const money = METRICS[input.metric]?.kind.startsWith("money");
  let valueUsd: number | null = input.value; const valueNotes: string[] = [];
  if (money) {
    const fx = input.currency ? await usdPer(db, input.currency, input.year, fetchImpl) : null;
    valueUsd = fx ? input.value * fx.rate : null;
    if (fx && input.currency !== "USD") valueNotes.push(`${input.currency}→USD (${fx.source})`);
    if (!fx) valueNotes.push("Project currency could not be converted");
  }
  const set = (name: string, f: (n: Normalised) => boolean) => { const xs = norm.filter(f).map(n => n.usd!).sort((a, b) => a - b); return { name, n: xs.length, median: median(xs), p10: q(xs, 10), p90: q(xs, 90), percentile: valueUsd === null ? null : percentile(xs, valueUsd) }; };
  const sets = [
    set("Local (same country)", n => !!input.country && n.b.country === input.country),
    set("Regional", n => !!input.region && !!n.b.region && n.b.region === input.region),
    set("Comparable scale (0.5×–2×)", n => !!input.scaleValue && !!n.b.scaleValue && n.b.scaleValue >= input.scaleValue * 0.5 && n.b.scaleValue <= input.scaleValue * 2),
    set("Global", () => true),
  ];
  const g = sets[3];
  let flag: Comparison["flag"] = "insufficient", question: string | null = null;
  if (valueUsd !== null && g.n >= 3 && g.median) {
    const dev = valueUsd / g.median - 1;
    if (g.p90 !== null && valueUsd > g.p90 && dev > 0.25) { flag = "material_above"; question = `${Math.round(dev * 100)}% above the global median and above P90. Ask why: scope (interconnection, land, development costs, contingency), scale, location, date, or a real cost problem?`; }
    else if (dev > 0.1) flag = "above";
    else if (g.p10 !== null && valueUsd < g.p10 && dev < -0.25) { flag = "material_below"; question = `${Math.round(-dev * 100)}% below the global median and below P10. Ask why: excluded items, an early or partial estimate, or a genuine advantage?`; }
    else if (dev < -0.1) flag = "below";
    else flag = "within";
  }
  return { metric: input.metric, value: input.value, valueUsd, valueNotes, sets, flag, question, sources: norm };
}

const TECH_OF: Record<string, string> = { solar: "solar", wind: "wind", storage: "bess", hydro: "hydro", geothermal: "geothermal", hydrogen: "hydrogen", water_infrastructure: "water_treatment", waste_to_value: "anaerobic_digestion", nature_based: "restoration", agriculture: "regenerative_ag", real_estate: "real_estate" };
export function technologyOf(assetClass: string | null) { return assetClass ? TECH_OF[assetClass] ?? assetClass : null; }

/** Metrics a project can be benchmarked on, derived from its own records (with where each value came from). */
export async function projectMetrics(db: Db, projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return [];
  const out: { technology: string; metric: string; value: number; currency: string | null; from: string; scaleValue: number | null }[] = [];
  const tech = technologyOf(p.assetClass);
  if (tech && p.capex && p.capacity && p.capacityUnit?.toUpperCase() === "MW") out.push({ technology: tech, metric: "capex_per_mwac", value: p.capex / p.capacity, currency: p.currency, from: "Project record (CAPEX ÷ MW)", scaleValue: p.capacity });
  if (tech && p.capex && p.capacity && p.capacityUnit?.toLowerCase() === "ha") out.push({ technology: tech, metric: "cost_per_ha", value: p.capex / p.capacity, currency: p.currency, from: "Project record (CAPEX ÷ ha)", scaleValue: p.capacity });
  const [m] = await db.select().from(finModels).where(eq(finModels.projectId, projectId)).orderBy(desc(finModels.updatedAt)).limit(1);
  if (m && tech && typeof m.summary.capexPerMw === "number" && m.health !== "ERROR") out.push({ technology: tech, metric: "capex_per_mwac", value: m.summary.capexPerMw, currency: m.definition.currency, from: `Financial model ${m.name} v${m.version}`, scaleValue: m.definition.generation?.capacityMw ?? null });
  for (const s of await db.select().from(storageSpecs).where(and(eq(storageSpecs.projectId, projectId), isNull(storageSpecs.deletedAt)))) {
    if (s.capexPerKwh) out.push({ technology: "bess", metric: "capex_per_kwh", value: s.capexPerKwh, currency: s.currency, from: `Storage spec ${s.name}`, scaleValue: s.energyMwh });
    const l = lcos(s);
    if (l.lcos) out.push({ technology: "bess", metric: "lcos", value: l.lcos, currency: s.currency, from: `Storage spec ${s.name} (screening LCOS)`, scaleValue: s.energyMwh });
    if (s.roundTripPct) out.push({ technology: "bess", metric: "round_trip", value: s.roundTripPct, currency: null, from: `Storage spec ${s.name}`, scaleValue: s.energyMwh });
  }
  return out;
}

export type Conflict = { fact: string; values: { source: string; value: number; currency: string | null }[]; spreadPct: number; material: boolean; note: string };
/** Same fact, different sources: listed side by side and never silently resolved. */
export async function contradictions(db: Db, projectId: string): Promise<Conflict[]> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return [];
  const capex: Conflict["values"] = [];
  if (p.capex) capex.push({ source: "Project record", value: p.capex, currency: p.currency });
  const [m] = await db.select().from(finModels).where(eq(finModels.projectId, projectId)).orderBy(desc(finModels.updatedAt)).limit(1);
  if (m && typeof m.summary.capex === "number" && m.summary.capex > 0) capex.push({ source: `Financial model ${m.name} v${m.version}`, value: m.summary.capex, currency: m.definition.currency });
  const cases = await db.select().from(economicCases).where(eq(economicCases.projectId, projectId));
  const base = cases.find(c => c.kind === "base") ?? cases[0];
  if (base?.inputs.capex) capex.push({ source: `Screening case ${base.name}`, value: base.inputs.capex, currency: base.inputs.currency });
  const pk = await db.select().from(procurementPackages).where(and(eq(procurementPackages.projectId, projectId), eq(procurementPackages.category, "epc")));
  if (pk.length) {
    const bs = await db.select().from(bids).where(inArray(bids.packageId, pk.map(x => x.id)));
    const lows = pk.map(x => bs.filter(b => b.packageId === x.id && b.price && ["received", "clarification", "shortlisted", "bafo", "selected"].includes(b.status)).map(b => b.price!).sort((a, b) => a - b)[0]).filter((x): x is number => x !== undefined);
    if (lows.length) capex.push({ source: `EPC quote${lows.length > 1 ? "s (lowest per package)" : ""}`, value: lows.reduce((a, b) => a + b, 0), currency: pk[0].currency ?? p.currency });
  }
  const out: Conflict[] = [];
  const check = (fact: string, vals: Conflict["values"], threshold: number) => {
    if (vals.length < 2) return;
    const curs = new Set(vals.map(v => v.currency ?? ""));
    const same = curs.size === 1;
    const xs = vals.map(v => v.value), lo = Math.min(...xs), hi = Math.max(...xs), spread = lo > 0 ? (hi - lo) / lo : 0;
    out.push({ fact, values: vals, spreadPct: Math.round(spread * 1000) / 10, material: same && spread > threshold, note: same ? (spread > threshold ? "MATERIAL DATA CONFLICT: sources disagree; confirm which is current and why" : "Sources agree within tolerance") : `Different currencies (${[...curs].join(", ")}): compare after conversion` });
  };
  check("CAPEX", capex, 0.1);
  const cap: Conflict["values"] = [];
  if (p.capacity && p.capacityUnit?.toUpperCase() === "MW") cap.push({ source: "Project record", value: p.capacity, currency: "MW" });
  if (m?.definition.generation?.capacityMw) cap.push({ source: `Financial model ${m.name} v${m.version}`, value: m.definition.generation.capacityMw, currency: "MW" });
  check("Capacity (MW)", cap, 0.02);
  return out;
}
