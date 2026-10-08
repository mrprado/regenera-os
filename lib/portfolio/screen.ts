// Portfolio screening (phase 20 §2): one table for every project of a sponsor. Per project: location precision, the
// energy-yield check, capital programmes by lane, data-room folders filled, open document requests; for the sponsor:
// sanctions state and the latest registry snapshot. Readings and questions, never a composite score.
import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { Db } from "@/db";
import { organizations, placeFacts, projectParties, projects } from "@/db/schema";
import { matchProgrammes, type Lane } from "@/lib/capital/programmes";
import { dataRoom } from "@/lib/diligence/dataroom";
import { toGwh, yieldCheck, type YieldCheck } from "@/lib/diligence/yield";
import { openCount, openRequestsFor, requestProgress } from "@/lib/documents/requests";
import { valuesBySource } from "@/lib/ontology/conflicts";
import { latestSnapshot } from "@/lib/registry/companies-house";
import { gateState, latestCheck } from "@/lib/sanctions/engine";

export const PRECISION = { survey: "Surveyed site", reported_site: "Site reported by sponsor", town: "Town / locality (approximate)", region: "Region (approximate)", country: "Country only" } as const;

export type PortfolioRow = {
  id: string; name: string; country: string | null; stage: string; capacityMw: number | null; precision: string | null; located: boolean;
  energyGwh: number | null; yield: YieldCheck | null; lanes: Partial<Record<Lane, number>>; programmes: number; roomFilled: number; roomTotal: number; openItems: number;
};

/** Projects of a sponsor: linked as a party (sponsor / developer), or mentioning the sponsor's name. */
export async function sponsorProjects(db: Db, mandateIds: string[], org: { id: string; name: string }) {
  if (!mandateIds.length) return [];
  const linked = await db.select({ id: projectParties.projectId }).from(projectParties).where(and(inArray(projectParties.mandateId, mandateIds), eq(projectParties.orgId, org.id)));
  const short = org.name.replace(/\b(plc|ltd|limited|llc|inc|group|holdings?)\b\.?/gi, "").trim();
  return db.select().from(projects).where(and(inArray(projects.mandateId, mandateIds), isNull(projects.archivedAt),
    or(linked.length ? inArray(projects.id, linked.map(l => l.id).slice(0, 90)) : undefined, short.length >= 3 ? like(projects.description, `%${short}%`) : undefined, short.length >= 3 ? like(projects.name, `%${short}%`) : undefined)));
}

export async function screenPortfolio(db: Db, mandateIds: string[], orgId: string) {
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, orgId), inArray(organizations.mandateId, mandateIds.length ? mandateIds : ["-"])));
  if (!org) return null;
  const list = await sponsorProjects(db, mandateIds, org);
  const ids = list.map(p => p.id);
  const pv = ids.length ? await db.select({ projectId: placeFacts.projectId, key: placeFacts.key, numeric: placeFacts.numeric }).from(placeFacts).where(and(inArray(placeFacts.projectId, ids.slice(0, 90)), inArray(placeFacts.key, ["pv_specific_yield", "pv_specific_yield_tracking"]))) : [];
  const rows: PortfolioRow[] = [];
  for (const p of list) {
    const fields = await valuesBySource(db, mandateIds, "project", p.id);
    const e = fields.find(f => f.field === "annual_energy")?.canonical;
    const energyGwh = e ? toGwh(e.value, e.unit) : null;
    const capMw = p.capacity && /^mw/i.test(p.capacityUnit ?? "") ? p.capacity : null;
    const ref = (k: string) => pv.find(x => x.projectId === p.id && x.key === k)?.numeric ?? null;
    const progs = matchProgrammes(p);
    const lanes: Partial<Record<Lane, number>> = {};
    for (const m of progs) for (const l of m.programme.lanes) lanes[l] = (lanes[l] ?? 0) + 1;
    const room = await dataRoom(db, mandateIds, p.id);
    const reqs = await openRequestsFor(db, mandateIds, { projectId: p.id });
    const prog = await requestProgress(db, reqs.map(r => r.id));
    rows.push({
      id: p.id, name: p.name, country: p.country, stage: p.stage, capacityMw: capMw, precision: p.locationPrecision, located: p.lat !== null && p.lng !== null,
      energyGwh, yield: capMw && energyGwh ? yieldCheck(capMw, energyGwh, ref("pv_specific_yield"), ref("pv_specific_yield_tracking")) : null,
      lanes, programmes: progs.length, roomFilled: room.filter(f => f.state === "filled").length, roomTotal: room.length,
      openItems: reqs.reduce((s, r) => s + openCount(prog.get(r.id)), 0),
    });
  }
  const sanctions = gateState(await latestCheck(db, org.mandateId, "organization", org.id));
  const registry = await latestSnapshot(db, org.id);
  const sponsorReqs = await openRequestsFor(db, mandateIds, { orgId: org.id });
  const sponsorProg = await requestProgress(db, sponsorReqs.map(r => r.id));
  return { org, rows, sanctions, registry, sponsorOpenItems: sponsorReqs.reduce((s, r) => s + openCount(sponsorProg.get(r.id)), 0), countries: [...new Set(list.map(p => p.country).filter(Boolean) as string[])] };
}

export function portfolioCsv(rows: PortfolioRow[]) {
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["project", "country", "stage", "capacity_mw", "location_precision", "located", "stated_gwh", "stated_kwh_per_kw", "pvgis_fixed", "pvgis_tracking", "yield_reading", "programmes", "data_room_filled", "open_request_items"];
  return [head.join(","), ...rows.map(r => [r.name, r.country, r.stage, r.capacityMw, r.precision, r.located ? "yes" : "no", r.energyGwh, r.yield?.statedKwhPerKw, r.yield?.fixed && Math.round(r.yield.fixed), r.yield?.tracking && Math.round(r.yield.tracking), r.yield?.reading, r.programmes, `${r.roomFilled}/${r.roomTotal}`, r.openItems].map(esc).join(","))].join("\n");
}
