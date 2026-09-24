// Free identity enrichment for an organization (SPEC section 12b, "waterfall"): Wikidata, GLEIF, SEC.
// A candidate is accepted only when it is unambiguous: same registrable domain, or an exact
// normalized-name match. Anything else is left for a human, never guessed.
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { organizations } from "@/db/schema";
import { normalizeOrgName, registrableDomain } from "@/lib/dedupe/normalize";
import { fetchJson } from "@/lib/sources/http";
import { gleifParent, gleifSearch, wikidataFindOrg, wikidataOrg } from "@/lib/sources/identity";
import { upsertOrganization } from "./entities";

export type EnrichReport = { wikidata?: string; lei?: string; parent?: string; cik?: string; conflicts: string[]; skipped: string[] };

const zTickers = z.record(z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }));

async function secCikByName(db: Db, name: string): Promise<string | null> {
  const all = await fetchJson(db, {
    provider: "edgar", endpoint: "company_tickers", url: "https://www.sec.gov/files/company_tickers.json",
    schema: zTickers, cacheKey: "company_tickers", cacheTtlMs: 7 * 86_400_000,
  });
  const target = normalizeOrgName(name);
  const hit = Object.values(all).find(c => normalizeOrgName(c.title) === target);
  return hit ? String(hit.cik_str) : null;
}

export async function enrichOrganizationIdentity(db: Db, orgId: string): Promise<EnrichReport> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new Error("Organization not found");
  const report: EnrichReport = { conflicts: [], skipped: [] };
  const norm = normalizeOrgName(org.name);
  const now = new Date().toISOString();

  // Wikidata: identity, website, HQ coordinates, LEI (P1278)
  if (!org.wikidataId) {
    const candidates = await wikidataFindOrg(db, org.name);
    for (const c of candidates.slice(0, 3)) {
      const wd = await wikidataOrg(db, c.qid);
      if (!wd) continue;
      const wdDomain = registrableDomain(wd.website);
      const sameDomain = !!org.domain && !!wdDomain && wdDomain === org.domain;
      const sameName = !!wd.label && normalizeOrgName(wd.label) === norm;
      if (!sameDomain && !(sameName && (!org.domain || !wdDomain))) continue;
      const r = await upsertOrganization(db, org.mandateId, {
        name: org.name, domain: org.domain ?? wdDomain, website: wd.website, wikidataId: wd.qid, lei: wd.lei,
        description: wd.description,
      }, org.source, { source: "wikidata", confidence: sameDomain ? "high" : "medium", url: `https://www.wikidata.org/wiki/${wd.qid}` });
      report.wikidata = wd.qid;
      report.conflicts.push(...r.conflicts);
      break;
    }
    if (!report.wikidata) report.skipped.push("wikidata: no unambiguous match");
  }

  // GLEIF: legal entity and ownership chain
  const [fresh] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!fresh.lei) {
    const entities = await gleifSearch(db, org.name);
    const exact = entities.filter(e => normalizeOrgName(e.legalName) === norm);
    if (exact.length === 1) {
      const e = exact[0];
      await db.update(organizations).set({
        lei: e.lei, updatedAt: now,
        fieldSources: { ...fresh.fieldSources, lei: { source: "gleif", at: now, confidence: "high", url: `https://search.gleif.org/#/record/${e.lei}` } },
      }).where(eq(organizations.id, orgId));
      report.lei = e.lei;
    } else {
      report.skipped.push(exact.length > 1 ? "gleif: several exact matches, left for review" : "gleif: no exact legal-name match");
    }
  } else {
    report.lei = fresh.lei;
  }
  if (report.lei) {
    const parent = await gleifParent(db, report.lei, "ultimate");
    if (parent && parent.lei !== report.lei) report.parent = `${parent.legalName} (${parent.lei})`;
  }

  // SEC: CIK for US-listed companies (exact name)
  if (!fresh.secCik) {
    const cik = await secCikByName(db, org.name).catch(() => null);
    if (cik) {
      const [cur] = await db.select().from(organizations).where(eq(organizations.id, orgId));
      await db.update(organizations).set({ secCik: cik, updatedAt: now, fieldSources: { ...cur.fieldSources, secCik: { source: "sec", at: now, confidence: "high" } } }).where(eq(organizations.id, orgId));
      report.cik = cik;
    }
  }
  return report;
}
