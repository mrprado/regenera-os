// Sanctions screening (phase 19 part C). Four free public lists, refreshed weekly by a job, one list per job:
// OFAC SDN (+ aliases), UK Sanctions List (FCDO), EU consolidated financial sanctions, UN Security Council consolidated.
// Screening checks a record's name and its recorded name aliases. A possible match blocks introductions until a person
// reviews it; "cleared" and "confirmed" are human decisions, recorded with the reviewer.
import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@/db";
import { entityAliases, sanctionsChecks, sanctionsLists } from "@/db/schema";
import { assertIntegrationAllowed } from "@/lib/integrations/engine";
import { logCall, USER_AGENT } from "@/lib/sources/http";
import { indexEntries, matchName, type Indexed } from "./match";
import { CsvStream, EntrySet, euPick, HeaderCsv, ofacAliases, ofacPrimary, ukPick, unXml, type SanctionsEntry } from "./parse";

export const SANCTIONS_LISTS = {
  ofac: { label: "OFAC SDN (US Treasury)", provider: "ofac_sdn", page: "https://sanctionslist.ofac.treas.gov/", urls: ["https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV", "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV"] },
  // Treasury's legacy download paths: tried when the list service fails (it returned HTTP 525 to Workers on 2026-10-08).
  uk: { label: "UK Sanctions List (FCDO)", provider: "uk_sanctions", page: "https://www.gov.uk/government/publications/the-uk-sanctions-list", urls: ["https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv"] },
  eu: { label: "EU consolidated financial sanctions", provider: "eu_sanctions", page: "https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions", urls: ["https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"] },
  un: { label: "UN Security Council consolidated list", provider: "un_sanctions", page: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", urls: ["https://scsanctions.un.org/resources/xml/en/consolidated.xml"] },
} as const;
export type ListKey = keyof typeof SANCTIONS_LISTS;
export const LIST_KEYS = Object.keys(SANCTIONS_LISTS) as ListKey[];
const OFAC_MIRRORS: Record<string, string> = {
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV": "https://www.treasury.gov/ofac/downloads/sdn.csv",
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV": "https://www.treasury.gov/ofac/downloads/alt.csv",
};
const PART = 2500;
export const RESCREEN_DAYS = 90;

/** Streams a text body chunk by chunk (the UK file is ~50 MB) through the integration gate and the call ledger. */
async function streamText(db: Db, provider: string, url: string, onChunk: (s: string) => void, fetchImpl: typeof fetch = fetch) {
  if ((await import("cloudflare:workers")).env.ISOLATED_DEMO === "true") throw new Error("External sources are disabled in the isolated demo");
  await assertIntegrationAllowed(db, provider);
  let res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: "*/*" }, signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if ((!res || !res.ok) && OFAC_MIRRORS[url]) {
    await logCall(db, { provider, endpoint: "list", ok: false, httpStatus: res?.status, detail: `HTTP ${res?.status ?? "network error"}: trying the treasury.gov mirror` });
    res = await fetchImpl(OFAC_MIRRORS[url], { headers: { "user-agent": USER_AGENT, accept: "*/*" }, signal: AbortSignal.timeout(120_000) }).catch(() => null);
  }
  if (!res) { await logCall(db, { provider, endpoint: "list", ok: false, detail: "network error" }); throw new Error(`${provider}: network error`); }
  if (!res.ok || !res.body) { await logCall(db, { provider, endpoint: "list", ok: false, httpStatus: res.status, detail: `HTTP ${res.status}` }); throw new Error(`${provider}: HTTP ${res.status}`); }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; onChunk(value); }
  await logCall(db, { provider, endpoint: "list", ok: true, httpStatus: res.status });
}

export async function downloadList(db: Db, list: ListKey, fetchImpl?: typeof fetch): Promise<SanctionsEntry[]> {
  const src = SANCTIONS_LISTS[list];
  const set = new EntrySet();
  if (list === "ofac") {
    const meta = new Map<string, [string, string]>();
    const p = new CsvStream(",");
    await streamText(db, src.provider, src.urls[0], s => ofacPrimary(p.push(s), set, meta), fetchImpl); ofacPrimary(p.end(), set, meta);
    const a = new CsvStream(",");
    await streamText(db, src.provider, SANCTIONS_LISTS.ofac.urls[1], s => ofacAliases(a.push(s), set, meta), fetchImpl); ofacAliases(a.end(), set, meta);
  } else if (list === "uk" || list === "eu") {
    const p = new CsvStream(list === "eu" ? ";" : ",");
    const h = new HeaderCsv(list === "eu" ? "Entity_LogicalId" : "Unique ID", list === "eu" ? euPick : ukPick, set);
    await streamText(db, src.provider, src.urls[0], s => h.rows(p.push(s)), fetchImpl); h.rows(p.end());
  } else {
    let xml = "";
    await streamText(db, src.provider, src.urls[0], s => { xml += s; }, fetchImpl);
    unXml(xml, set);
  }
  return set.entries;
}

/** Replaces one list's stored parts. Refuses to replace a list with an implausibly small download. */
export async function storeList(db: Db, list: ListKey, entries: SanctionsEntry[], now = new Date()) {
  const prevTotal = (await db.select({ n: sanctionsLists.entryCount }).from(sanctionsLists).where(eq(sanctionsLists.list, list))).reduce((s, r) => s + r.n, 0);
  if (entries.length < 50 || (prevTotal && entries.length < prevTotal * 0.5)) throw new Error(`${list}: download has ${entries.length} names (was ${prevTotal}); kept the previous copy.`);
  const at = now.toISOString(); const parts: SanctionsEntry[][] = [];
  for (let i = 0; i < entries.length; i += PART) parts.push(entries.slice(i, i + PART));
  for (const [part, chunk] of parts.entries()) {
    await db.insert(sanctionsLists).values({ list, part, entries: chunk, entryCount: chunk.length, refreshedAt: at })
      .onConflictDoUpdate({ target: [sanctionsLists.list, sanctionsLists.part], set: { entries: chunk, entryCount: chunk.length, refreshedAt: at } });
  }
  await db.delete(sanctionsLists).where(and(eq(sanctionsLists.list, list), gte(sanctionsLists.part, parts.length)));
  indexCache.delete(list);
  return { list, entries: entries.length, parts: parts.length };
}

export async function refreshList(db: Db, list: ListKey, now = new Date(), fetchImpl?: typeof fetch) {
  return storeList(db, list, await downloadList(db, list, fetchImpl), now);
}

export async function listStatus(db: Db) {
  const rows = await db.select({ list: sanctionsLists.list, n: sanctionsLists.entryCount, at: sanctionsLists.refreshedAt }).from(sanctionsLists);
  return LIST_KEYS.map(k => { const r = rows.filter(x => x.list === k); return { list: k, label: SANCTIONS_LISTS[k].label, page: SANCTIONS_LISTS[k].page, entries: r.reduce((s, x) => s + x.n, 0), refreshedAt: r.map(x => x.at).sort().at(-1) ?? null }; });
}

const indexCache = new Map<string, { at: string; idx: Indexed[] }>();
async function loadIndex(db: Db) {
  const status = await listStatus(db);
  const out: Indexed[] = [];
  for (const s of status) {
    if (!s.entries || !s.refreshedAt) continue;
    let c = indexCache.get(s.list);
    if (!c || c.at !== s.refreshedAt) {
      const parts = await db.select({ entries: sanctionsLists.entries }).from(sanctionsLists).where(eq(sanctionsLists.list, s.list));
      c = { at: s.refreshedAt, idx: indexEntries(s.list, parts.flatMap(p => p.entries)) };
      indexCache.set(s.list, c);
    }
    out.push(...c.idx);
  }
  return { idx: out, status: status.filter(s => s.entries > 0).map(s => ({ list: s.list, entries: s.entries, refreshedAt: s.refreshedAt! })) };
}

/** Screens a record's name and its recorded name aliases against every loaded list. */
export async function screenEntity(db: Db, x: { mandateId: string; entityType: "organization" | "person"; entityId: string; name: string; actor: string }) {
  const { idx, status } = await loadIndex(db);
  if (!status.length) throw new Error("No sanctions list is loaded yet. Refresh the lists first (Network → Sanctions screening).");
  const aliases = await db.select({ value: entityAliases.value }).from(entityAliases).where(and(eq(entityAliases.mandateId, x.mandateId), eq(entityAliases.entityType, x.entityType), eq(entityAliases.entityId, x.entityId), eq(entityAliases.scheme, "name")));
  const names = [...new Set([x.name, ...aliases.map(a => a.value)])];
  const seen = new Set<string>();
  const matches = names.flatMap(n => matchName(n, idx)).filter(h => { const k = `${h.list}|${h.listId}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.score - a.score).slice(0, 15);
  const [row] = await db.insert(sanctionsChecks).values({
    mandateId: x.mandateId, entityType: x.entityType, entityId: x.entityId, name: names.join(" · "), result: matches.length ? "possible_match" : "clear",
    matches, listsChecked: status, review: matches.length ? "pending" : null, checkedBy: x.actor,
  }).returning();
  return row;
}

export async function latestCheck(db: Db, mandateId: string, entityType: string, entityId: string) {
  const [row] = await db.select().from(sanctionsChecks).where(and(eq(sanctionsChecks.mandateId, mandateId), eq(sanctionsChecks.entityType, entityType), eq(sanctionsChecks.entityId, entityId))).orderBy(desc(sanctionsChecks.createdAt)).limit(1);
  return row ?? null;
}

export type GateState = "not_screened" | "clear" | "pending" | "cleared" | "confirmed";
export function gateState(check: typeof sanctionsChecks.$inferSelect | null): GateState {
  if (!check) return "not_screened";
  if (check.result === "clear") return "clear";
  return check.review === "cleared" ? "cleared" : check.review === "confirmed" ? "confirmed" : "pending";
}
export const BLOCKING: GateState[] = ["pending", "confirmed"];

/** Before an introduction or contract: screens the party if it was never screened (or not in 90 days) and the lists are
 *  loaded, then says whether to proceed. Lists not loaded = proceed with a warning; never silently "clear". */
export async function screenBeforeAction(db: Db, x: { mandateId: string; entityType: "organization" | "person"; entityId: string; name: string; actor: string }, now = new Date()) {
  let check = await latestCheck(db, x.mandateId, x.entityType, x.entityId);
  const stale = !check || check.createdAt < new Date(now.getTime() - RESCREEN_DAYS * 86_400_000).toISOString();
  if (stale && !(check && check.review === "confirmed")) {
    try { check = await screenEntity(db, x); } catch (e) { return { proceed: true, state: gateState(check), warning: (e as Error).message }; }
  }
  const state = gateState(check);
  return { proceed: !BLOCKING.includes(state), state, warning: null as string | null, check };
}
