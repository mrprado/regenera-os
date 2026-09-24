// Public list diffs (docs/plans/phase-3.md item 3). Only lists published as open files or public tables whose
// robots.txt allows fetching (checked Sep 24, 2026):
//   SBTi companies file (xlsx) and the TNFD adopters list (public table with a CSV button).
// Dropped: PRI directory (loads through Salesforce's page API, no file), ImpactAssets 50 (login),
// CDP A List (not published as a file), B Corp and GIIN (no open file).
// The first run records a baseline. Later runs mark entries not seen before as new, and in-scope new entries
// become organizations (which then get the usual free identity enrichment and geocoding).
import { Unzip, UnzipInflate } from "fflate";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { listEntries, listSources } from "@/db/schema";
import { upsertOrganization } from "@/lib/crm/entities";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { USER_AGENT } from "@/lib/sources/http";

export type ListEntry = { key: string; name: string; country: string | null; sector: string | null; inScope: boolean; leadSource: "mandate_match" | "compliance"; detail: Record<string, unknown> };

export const LIST_SOURCES = [
  { key: "sbti", name: "SBTi companies taking action", url: "https://files.sciencebasedtargets.org/production/files/companies-excel.xlsx", leadSource: "compliance" },
  { key: "tnfd", name: "TNFD adopters", url: "https://tnfd.global/engage/tnfd-adopters-list/", leadSource: "compliance" },
] as const;

export async function ensureListSources(db: Db) {
  for (const s of LIST_SOURCES) await db.insert(listSources).values({ key: s.key, name: s.name, url: s.url, leadSource: s.leadSource }).onConflictDoNothing();
}

// ---------- scope filters (Regenera's sectors: land, energy, water, waste, food and agriculture, real assets, capital) ----------
const SBTI_SECTORS = new Set([
  "Electric Utilities and Independent Power Producers and Energy Traders (including Fossil, Alternative and Nuclear Energy)",
  "Solid Waste Management Utilities", "Water Utilities", "Gas Utilities", "Mining - Iron, Aluminum, Other Metals", "Mining - Other (Rare Minerals, Precious Metals and Gems)", "Mining - Coal",
  "Food Production - Agricultural Production", "Food Production - Animal Source Food Production", "Food and Beverage Processing", "Food and Staples Retailing",
  "Forest and Paper Products - Forestry, Timber, Pulp and Paper, Rubber", "Real Estate", "Construction and Engineering", "Construction Materials", "Homebuilding",
  "Banks, Diverse Financials, Insurance", "Specialized Financial Services, Consumer Finance, Insurance Brokerage Firms", "Public Agencies",
  "Ground Transportation - Highways and Railtracks", "Water Transportation - Ports and Services", "Air Transportation - Airport Services",
]);
const SBTI_FINANCIAL = new Set(["Banks, Diverse Financials, Insurance", "Specialized Financial Services, Consumer Finance, Insurance Brokerage Firms"]);

const TNFD_CAPITAL_TYPES = new Set(["Financial Institution or Services", "Development Bank or Multilateral Finance Institution", "Asset Owner"]);
const TNFD_SECTORS = new Set([
  "Real Estate", "Real Estate Services", "Engineering & Construction Services", "Electric Utilities & Power Generators", "Metals & Mining", "Food Retailers & Distributors",
  "Pulp & Paper Products", "Agricultural Products", "Processed Foods", "Construction Materials", "Water Utilities & Services", "Solar Technology & Project Developers",
  "Forestry Management", "Homebuilders", "Meat & Poultry & Dairy", "Wind Technology & Project Developers", "Gas Utilities & Distributors", "Fisheries", "Livestock",
  "Hydro Power", "Biofuels", "Aquaculture",
]);

// ---------- TNFD: public HTML table ----------
const decode = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function cell(row: string, label: string): string {
  const i = row.indexOf(`data-label="${label}"`);
  if (i < 0) return "";
  const start = row.indexOf(">", i) + 1;
  return row.slice(start, row.indexOf("</td>", start));
}

export function parseTnfd(html: string): ListEntry[] {
  const out: ListEntry[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const first = cell(row, "Organisation and HQ Country or Area");
    if (!first) continue;
    const nameMatch = first.match(/<div[^>]*class="[^"]*bold[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const name = decode(nameMatch?.[1] ?? "");
    if (!name) continue;
    const country = decode(first.replace(nameMatch?.[0] ?? "", "")) || null;
    const sector = decode(cell(row, "Sector Classification (SASB)")) || null;
    const type = decode(cell(row, "Type of Institution"));
    const capital = TNFD_CAPITAL_TYPES.has(type);
    out.push({
      key: normalizeOrgName(name), name, country, sector,
      inScope: capital || (type === "Corporate" && !!sector && TNFD_SECTORS.has(sector)),
      leadSource: capital ? "mandate_match" : "compliance",
      detail: { type, disclosure: decode(cell(row, "TNFD-aligned disclosure(s) by financial year")), listed: decode(cell(row, "Publicly listed company")) },
    });
  }
  return out;
}

// ---------- SBTi: xlsx, streamed (the sheet is ~15 MB of XML; never held whole in memory) ----------
const COLS = { A: "sbti_id", B: "company_name", C: "isin", D: "lei", E: "organization_type", F: "location", H: "sector", I: "near_term_status", O: "net_zero_status", P: "net_zero_year", V: "date_updated" } as const;
type Col = keyof typeof COLS;
type RawCell = { s: number } | { v: string };

function parseRow(xml: string): Partial<Record<Col, RawCell>> {
  const out: Partial<Record<Col, RawCell>> = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const col = m[1] as Col;
    if (!(col in COLS)) continue;
    const inner = m[3] ?? "";
    const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (v !== undefined) out[col] = /t="s"/.test(m[2]) ? { s: Number(v) } : { v };
    else { const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]; if (t !== undefined) out[col] = { v: decode(t) }; }
  }
  return out;
}

/** Excel serial date (days since 1899-12-30) to YYYY-MM-DD. */
export function excelDate(serial: string | undefined): string | null {
  const n = Number(serial);
  if (!serial || !Number.isFinite(n) || n < 20000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86_400_000)).toISOString().slice(0, 10);
}

/** Streams the xlsx: buffers compact rows, then resolves only the shared strings they reference. */
export async function parseSbtiXlsx(chunks: AsyncIterable<Uint8Array>): Promise<ListEntry[]> {
  const rows: Partial<Record<Col, RawCell>>[] = [];
  const strings = new Map<number, string>();
  const state: { needed: Set<number> | null } = { needed: null };
  const pendingStrings: string[] = [];
  let sheetBuf = "", strBuf = "", strIndex = 0;
  const sheetDec = new TextDecoder(), strDec = new TextDecoder();

  const takeStrings = () => {
    let i: number;
    while ((i = strBuf.indexOf("</si>")) >= 0) {
      const si = strBuf.slice(0, i);
      strBuf = strBuf.slice(i + 5);
      const idx = strIndex++;
      if (!state.needed || state.needed.has(idx)) pendingStrings[idx] = si;
    }
  };
  const uz = new Unzip(file => {
    if (file.name === "xl/worksheets/sheet1.xml") {
      file.ondata = (err, data, final) => {
        if (err) throw err;
        sheetBuf += sheetDec.decode(data, { stream: !final });
        let i: number;
        while ((i = sheetBuf.indexOf("</row>")) >= 0) {
          const start = sheetBuf.lastIndexOf("<row", i);
          rows.push(parseRow(sheetBuf.slice(start, i)));
          sheetBuf = sheetBuf.slice(i + 6);
        }
        if (final) {
          const needed = new Set<number>();
          for (const r of rows) for (const c of Object.values(r)) if (c && "s" in c) needed.add(c.s);
          state.needed = needed;
        }
      };
      file.start();
    } else if (file.name === "xl/sharedStrings.xml") {
      file.ondata = (err, data, final) => {
        if (err) throw err;
        strBuf += strDec.decode(data, { stream: !final });
        const open = strBuf.indexOf("<si>");
        if (strIndex === 0 && open > 0) strBuf = strBuf.slice(open);
        takeStrings();
      };
      file.start();
    }
  });
  uz.register(UnzipInflate);
  for await (const chunk of chunks) uz.push(chunk);
  uz.push(new Uint8Array(0), true);

  for (const [i, raw] of pendingStrings.entries()) if (raw !== undefined && (!state.needed || state.needed.has(i))) strings.set(i, decode(raw));
  const val = (c: RawCell | undefined) => (c ? ("s" in c ? strings.get(c.s) ?? "" : c.v) : "");
  const out: ListEntry[] = [];
  for (const r of rows.slice(1)) {
    const id = val(r.A), name = val(r.B);
    if (!id || !name || name === "company_name") continue;
    const type = val(r.E), sector = val(r.H) || null;
    out.push({
      key: String(Math.round(Number(id)) || id), name, country: val(r.F) || null, sector,
      inScope: (type === "Corporate" || type === "Financial Institution") && !!sector && SBTI_SECTORS.has(sector),
      leadSource: type === "Financial Institution" || (sector && SBTI_FINANCIAL.has(sector)) ? "mandate_match" : "compliance",
      detail: { type, isin: val(r.C) || null, lei: val(r.D) || null, near_term: val(r.I) || null, net_zero: val(r.O) || null, net_zero_year: val(r.P).replace(/\.0$/, "") || null, updated: excelDate(val(r.V)) },
    });
  }
  return out;
}

async function* bodyChunks(res: Response): AsyncIterable<Uint8Array> {
  const reader = res.body!.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; }
}

// ---------- runner ----------
export type ListRunResult = { count: number; newEntries: number; orgsCreated: number; baseline: boolean };

/** Diff-and-store. `entries` come from a parser; exported for tests. */
export async function applyListEntries(db: Db, sourceKey: string, entries: ListEntry[], mandateId: string, now = new Date(), opts: { baselineRecentDays?: number; maxOrgs?: number } = {}): Promise<ListRunResult> {
  const [src] = await db.select().from(listSources).where(eq(listSources.key, sourceKey));
  const baseline = !src?.baselineAt;
  const all = [...new Map(entries.map(e => [e.key, e])).values()];
  // Only in-scope entries are tracked: the diff exists to find new prospects, not to mirror the whole list.
  const unique = all.filter(e => e.inScope);
  const seen = new Set<string>();
  // D1 allows at most 100 bound parameters per statement.
  for (let i = 0; i < unique.length; i += 90) {
    const keys = unique.slice(i, i + 90).map(e => e.key);
    for (const r of await db.select({ k: listEntries.entryKey }).from(listEntries).where(and(eq(listEntries.sourceKey, sourceKey), inArray(listEntries.entryKey, keys)))) seen.add(r.k);
  }
  const fresh = unique.filter(e => !seen.has(e.key));
  // On the baseline run, only entries updated within the recent window count as new (current-data policy).
  const recentSince = new Date(now.getTime() - (opts.baselineRecentDays ?? 60) * 86_400_000).toISOString().slice(0, 10);
  const isNew = (e: ListEntry) => !baseline || (typeof e.detail.updated === "string" && e.detail.updated >= recentSince);
  let orgsCreated = 0, newEntries = 0;
  const maxOrgs = opts.maxOrgs ?? 150;
  // Multi-row inserts, 10 rows x 9 columns per statement (under D1's 100-parameter limit).
  for (let i = 0; i < fresh.length; i += 10) {
    const batch = fresh.slice(i, i + 10);
    await db.insert(listEntries).values(batch.map(e => ({
      sourceKey, entryKey: e.key, name: e.name.slice(0, 300), country: e.country, sector: e.sector, detail: e.detail, isNew: isNew(e), firstSeenAt: now.toISOString(),
    }))).onConflictDoNothing();
  }
  for (const e of fresh) {
    if (!isNew(e)) continue;
    newEntries++;
    if (orgsCreated >= maxOrgs) continue;
    const lei = typeof e.detail.lei === "string" && /^[A-Z0-9]{20}$/.test(e.detail.lei) ? e.detail.lei : null;
    const o = await upsertOrganization(db, mandateId, { name: e.name, country: e.country, industry: e.sector, lei }, e.leadSource, { source: sourceKey });
    await db.update(listEntries).set({ orgId: o.row.id }).where(and(eq(listEntries.sourceKey, sourceKey), eq(listEntries.entryKey, e.key)));
    if (o.created) orgsCreated++;
  }
  await db.update(listSources).set({
    baselineAt: src?.baselineAt ?? now.toISOString(), lastRunAt: now.toISOString(), lastCount: all.length, lastNew: newEntries, lastError: null,
  }).where(eq(listSources.key, sourceKey));
  return { count: all.length, newEntries, orgsCreated, baseline };
}

export async function runListSource(db: Db, sourceKey: string, mandateId: string, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ListRunResult> {
  const [src] = await db.select().from(listSources).where(eq(listSources.key, sourceKey));
  if (!src || !src.enabled) throw new Error(`List source ${sourceKey} is not enabled`);
  try {
    const res = await fetchImpl(src.url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok || !res.body) throw new Error(`${src.name} returned ${res.status}`);
    const entries = sourceKey === "sbti" ? await parseSbtiXlsx(bodyChunks(res)) : parseTnfd(await res.text());
    if (entries.length < 50) throw new Error(`${src.name}: only ${entries.length} entries parsed; the format may have changed`);
    return await applyListEntries(db, sourceKey, entries, mandateId, now);
  } catch (error) {
    await db.update(listSources).set({ lastRunAt: now.toISOString(), lastError: (error as Error).message.slice(0, 300) }).where(eq(listSources.key, sourceKey));
    throw error;
  }
}
