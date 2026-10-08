// The autonomous loop, first vertical (phase 21 §6): World Bank infrastructure projects → OS records, no manual entry.
// discover (Projects API) → dedupe (origination key) → create/update project → claims with source evidence →
// organizations with dated typed roles (World Bank = lender, borrower, implementing agency = government) → approximate
// placement → screening run (capital, partners, finance, saved assessment + review task) → events → monitoring: a
// changed commitment or status adds a new claim (old one kept) and re-runs the assessment.
// Kept in the "Market pipeline" view of Projects (originationSource prefix), never mixed with Regenera's own projects.
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { claimEvidence, claims, events, projectParties, projects } from "@/db/schema";
import { upsertOrganization } from "@/lib/crm/entities";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { createProject } from "@/lib/projects/engine";
import type { PARTY_ROLES } from "@/lib/projects/vocab";
import { country as countryOf } from "@/lib/scan/countries";
import { startRun } from "@/lib/site-intel/engine";
import { geocode } from "@/lib/sources/geocode";
import { fetchJson } from "@/lib/sources/http";
import { getState, setState } from "@/lib/state";

export const MARKET_PREFIX = "Public pipeline: World Bank ";
export const WB_QUERIES = ["solar", "wind power", "battery storage", "transmission", "hydropower", "geothermal", "waste management", "water supply", "irrigation", "landscape restoration", "climate resilience", "renewable energy"];
const MIN_USD = 20_000_000;

const zProject = z.object({
  id: z.string(), project_name: z.string().optional(), countryshortname: z.string().optional(), countrycode: z.union([z.array(z.string()), z.string()]).optional(),
  totalamt: z.string().optional(), curr_total_commitment: z.string().optional(), boardapprovaldate: z.string().optional(), status: z.string().optional(),
  impagency: z.string().optional(), borrower: z.string().optional(), url: z.string().optional(), lendinginstr: z.string().optional(),
  sector1: z.object({ Name: z.string().optional() }).passthrough().optional(),
  project_abstract: z.object({ "cdata!": z.string().optional() }).passthrough().optional(),
}).passthrough();
const zResponse = z.object({ projects: z.record(zProject).optional(), total: z.union([z.string(), z.number()]).optional() }).passthrough();
export type WbProject = z.infer<typeof zProject>;

/** Pure: normalized fields of one World Bank project, or null when out of scope (dropped, too small, no country). */
export function normalizeWb(p: WbProject) {
  const usd = Number(String(p.totalamt ?? "0").replace(/,/g, "")) || (Number(p.curr_total_commitment ?? 0) * 1e6);
  const code = Array.isArray(p.countrycode) ? p.countrycode[0] : p.countrycode;
  const c = code ? countryOf(code) : null;
  if (!p.project_name || !c || usd < MIN_USD || /dropped|closed/i.test(p.status ?? "")) return null;
  return {
    wbId: p.id, name: p.project_name.slice(0, 190), iso3: c.iso3, countryName: c.name, usd, approved: p.boardapprovaldate?.slice(0, 10) ?? null,
    status: p.status ?? "unknown", sector: p.sector1?.Name ?? null, instrument: p.lendinginstr ?? null, borrower: p.borrower?.trim() || null,
    agency: p.impagency?.trim() || null, url: p.url ?? `https://projects.worldbank.org/en/projects-operations/project-detail/${p.id}`,
    abstract: (p.project_abstract?.["cdata!"] ?? "").slice(0, 1500),
  };
}

export async function fetchWbProjects(db: Db, query: string, rows = 20, fetchImpl?: typeof fetch) {
  const url = `https://search.worldbank.org/api/v2/projects?format=json&rows=${rows}&os=0&qterm=${encodeURIComponent(query)}&status_exact=Active^Pipeline&fl=id,project_name,countryshortname,countrycode,totalamt,curr_total_commitment,boardapprovaldate,status,impagency,borrower,url,sector1,lendinginstr,project_abstract`;
  const r = await fetchJson(db, { provider: "worldbank", endpoint: "projects", url, schema: zResponse, cacheKey: `projects:${query}:${rows}`, cacheTtlMs: 12 * 3_600_000, fetchImpl });
  return Object.values(r.projects ?? {});
}

async function claim(db: Db, projectId: string, x: { field: string; label: string; value: string; unit?: string; url: string; wbId: string }) {
  const [c] = await db.insert(claims).values({ mandateId: REGENERA_MANDATE_ID, entityType: "project", entityId: projectId, statement: `${x.label} (World Bank ${x.wbId}): ${x.value}${x.unit ? ` ${x.unit}` : ""}`, claimType: x.field === "status" ? "fact" : "metric", field: x.field, value: x.value, unit: x.unit ?? null, status: "source_provided", createdBy: "system:wb-loop" }).returning({ id: claims.id });
  await db.insert(claimEvidence).values({ claimId: c.id, provider: "World Bank Projects API", sourceId: x.wbId, sourceUrl: x.url, excerpt: `${x.label}: ${x.value}`, retrievedAt: new Date().toISOString(), method: "api", confidence: "high", license: "CC BY 4.0", addedBy: "system:wb-loop" });
}

/** One project through the loop. Returns what happened (for the run log and tests). */
export async function processWbProject(db: Db, raw: WbProject, now = new Date(), fetchImpl?: typeof fetch): Promise<"created" | "updated" | "unchanged" | "skipped"> {
  const n = normalizeWb(raw);
  if (!n) return "skipped";
  const key = `${MARKET_PREFIX}${n.wbId}`;
  const [existing] = await db.select().from(projects).where(and(eq(projects.mandateId, REGENERA_MANDATE_ID), eq(projects.originationSource, key)));
  const amount = String(Math.round(n.usd));
  if (existing) {
    // Monitoring: only material changes (commitment or status) add claims and re-run the assessment; old claims stay.
    const changed = (existing.capex ?? 0) !== n.usd || !existing.description.includes(`Status: ${n.status}.`);
    if (!changed) return "unchanged";
    await db.update(projects).set({ capex: n.usd, description: describe(n), updatedAt: now.toISOString() }).where(eq(projects.id, existing.id));
    await claim(db, existing.id, { field: "capex", label: "World Bank commitment", value: amount, unit: "USD", url: n.url, wbId: n.wbId });
    await claim(db, existing.id, { field: "status", label: "World Bank status", value: n.status, url: n.url, wbId: n.wbId });
    await db.insert(events).values({ mandateId: REGENERA_MANDATE_ID, type: "SOURCE_RECORD_UPDATED", entityType: "project", entityId: existing.id, payload: { summary: `World Bank ${n.wbId} changed: commitment or status`, source: "worldbank" }, actor: "system:wb-loop" });
    if (existing.lat != null) await startRun(db, existing.id, "system:wb-loop", ["capital", "partners", "finance", "assessment"]).catch(() => undefined);
    return "updated";
  }
  const g = await geocode(db, n.countryName, fetchImpl).catch(() => null);
  const point = g && g !== "busy" ? g : null;
  const p = await createProject(db, {
    mandateId: REGENERA_MANDATE_ID, name: n.name, description: describe(n), technology: n.sector, capex: n.usd, currency: "USD", country: n.iso3,
    originationSource: key, lat: point?.lat ?? null, lng: point?.lng ?? null, locationPrecision: point ? "country" : null,
    locationSource: point ? `Country only · OpenStreetMap: ${point.label} · World Bank lists ${n.countryName}; no site coordinates published` : null,
  }, "system:wb-loop");
  await claim(db, p.id, { field: "capex", label: "World Bank commitment", value: amount, unit: "USD", url: n.url, wbId: n.wbId });
  await claim(db, p.id, { field: "status", label: "World Bank status", value: n.status, url: n.url, wbId: n.wbId });
  if (n.approved) await claim(db, p.id, { field: "board_approval", label: "Board approval date", value: n.approved, url: n.url, wbId: n.wbId });
  if (n.instrument) await claim(db, p.id, { field: "instrument", label: "Lending instrument", value: n.instrument, url: n.url, wbId: n.wbId });
  // Organizations with typed roles, as the source names them. Nothing inferred about their needs or contacts.
  const parties: [string | null, keyof typeof PARTY_ROLES, string][] = [["World Bank", "lender", "Financier per World Bank project record"], [n.borrower, "government", "Borrower per World Bank project record"], [n.agency, "government", "Implementing agency per World Bank project record"]];
  for (const [name, role, note] of parties) {
    if (!name) continue;
    const org = await upsertOrganization(db, REGENERA_MANDATE_ID, { name: name.slice(0, 200), country: name === "World Bank" ? "USA" : n.iso3, location: name === "World Bank" ? "Washington, DC" : n.countryName }, "procurement", { source: "World Bank Projects API", url: n.url, confidence: "high" });
    const [has] = await db.select({ id: projectParties.id }).from(projectParties).where(and(eq(projectParties.projectId, p.id), eq(projectParties.orgId, org.row.id), eq(projectParties.role, role)));
    if (!has) await db.insert(projectParties).values({ mandateId: REGENERA_MANDATE_ID, projectId: p.id, orgId: org.row.id, role, confirmed: "proposed", note: `${note} (${n.approved ?? "date not stated"})` });
  }
  await db.insert(events).values({ mandateId: REGENERA_MANDATE_ID, type: "PROJECT_CREATED", entityType: "project", entityId: p.id, payload: { summary: `Public pipeline: ${n.name} (${n.countryName}, World Bank ${n.wbId})`, source: "worldbank" }, actor: "system:wb-loop" });
  // Country-level location: only the stages that do not depend on a site point.
  if (point) await startRun(db, p.id, "system:wb-loop", ["capital", "partners", "finance", "assessment"]).catch(() => undefined);
  return "created";
}

function describe(n: NonNullable<ReturnType<typeof normalizeWb>>) {
  return `World Bank ${n.wbId} · ${n.sector ?? "sector not stated"} · ${n.countryName}. Status: ${n.status}. Commitment US$${(n.usd / 1e6).toFixed(1)}m${n.instrument ? ` (${n.instrument})` : ""}${n.approved ? `, approved ${n.approved}` : ""}. Source-provided figures from the World Bank Projects API (CC BY 4.0); a public project is not a Regenera mandate and its financing is not available to third parties.\n\n${n.abstract}`;
}

/** Job: next query in rotation, up to `maxNew` new projects per run. */
export async function runWbLoop(db: Db, now = new Date(), maxNew = 8, fetchImpl?: typeof fetch) {
  const cursor = Number(await getState(db, "wb_loop_cursor") ?? 0) % WB_QUERIES.length;
  const q = WB_QUERIES[cursor];
  const items = await fetchWbProjects(db, q, 25, fetchImpl);
  const tally = { query: q, created: 0, updated: 0, unchanged: 0, skipped: 0 };
  for (const raw of items) {
    if (tally.created >= maxNew) break;
    tally[await processWbProject(db, raw, now, fetchImpl)]++;
  }
  await setState(db, "wb_loop_cursor", String(cursor + 1));
  await setState(db, "wb_loop_last", JSON.stringify({ at: now.toISOString(), ...tally }));
  return tally;
}

export async function marketCount(db: Db) {
  return (await db.select({ id: projects.id }).from(projects).where(like(projects.originationSource, `${MARKET_PREFIX}%`))).length;
}
