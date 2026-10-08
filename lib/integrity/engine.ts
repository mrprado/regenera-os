// Origination & Integrity Engine (phase 23): gathers facts already in the OS, applies the current policy, persists an
// auditable decision (previous decisions kept, never rewritten), findings and an event. Deterministic throughout.
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  claims, communities, communityRights, consentRecords, events, fundingProjectMatches, integrityFindings, policyDecisions, projectParties, projects, sanctionsChecks, siteIntelRuns,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { constraintFeatures } from "@/lib/geo/osm";
import { projectReadinessScore } from "@/lib/origination/engine";
import { READING_LABEL } from "@/lib/origination/readiness";
import { projectSector } from "@/lib/site-intel/opportunity";
import { evaluateIntegrity, type IntegrityFacts } from "./evaluate";
import { currentPolicy, type DecisionState } from "./policy";

type Constraints = (db: Db, bbox: [number, number, number, number]) => Promise<{ layers: Record<string, FeatureCollection>; source: string }>;
const APPROX = new Set(["town", "region", "country"]);

function siteGeometry(p: typeof projects.$inferSelect): Feature<Polygon | MultiPolygon> | null {
  try { const j = p.geometry ? JSON.parse(p.geometry) : null; const g = j?.type === "Feature" ? j.geometry : j; return g?.type === "Polygon" || g?.type === "MultiPolygon" ? turf.feature(g) as Feature<Polygon | MultiPolygon> : null; } catch { return null; }
}

/** Pure: overlap and distance of a site (polygon or point) with constraint polygons. */
export function spatialChecks(site: Feature<Polygon | MultiPolygon> | null, point: [number, number] | null, layers: Record<string, FeatureCollection>) {
  const polys = (k: string) => (layers[k]?.features ?? []).filter(f => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")) as Feature<Polygon | MultiPolygon>[];
  const overlaps = (k: string) => polys(k).some(g => site ? turf.booleanIntersects(site, g) : point ? turf.booleanPointInPolygon(turf.point(point), g) : false);
  let nearest: number | null = null;
  const at = point ?? (site ? turf.centroid(site).geometry.coordinates as [number, number] : null);
  if (at) for (const g of polys("protected")) {
    try { const d = turf.booleanPointInPolygon(turf.point(at), g) ? 0 : Math.abs(turf.pointToPolygonDistance(turf.point(at), g, { units: "kilometers" })); nearest = nearest === null ? d : Math.min(nearest, d); } catch { /* malformed ring */ }
  }
  return { protectedOverlap: overlaps("protected"), protectedNearestKm: nearest, wetlandOverlap: overlaps("wetland"), forestOverlap: overlaps("forest"), settlementOverlap: overlaps("settlement") };
}

export async function gatherFacts(db: Db, projectId: string, opts: { constraints?: Constraints } = {}): Promise<IntegrityFacts> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const site = siteGeometry(p);
  const exactLocation = !!site || (p.lat != null && p.lng != null && !APPROX.has(p.locationPrecision ?? ""));
  const spatial: IntegrityFacts["spatial"] = { checked: false, protectedOverlap: null, protectedNearestKm: null, wetlandOverlap: null, forestOverlap: null, settlementOverlap: null, source: "" };
  if (exactLocation) {
    const point: [number, number] | null = p.lng != null && p.lat != null ? [p.lng, p.lat] : null;
    const bb = site ? turf.bbox(site) : [point![0] - 0.03, point![1] - 0.03, point![0] + 0.03, point![1] + 0.03];
    const pad = 0.012; const box: [number, number, number, number] = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
    try {
      const c = await (opts.constraints ?? ((d, b) => constraintFeatures(d, b)))(db, box);
      Object.assign(spatial, { checked: true, source: c.source || "OpenStreetMap via Overpass (community-mapped)" }, spatialChecks(site, point, c.layers));
    } catch (e) { spatial.error = (e as Error).message.slice(0, 120); }
  }
  const [run] = await db.select({ stages: siteIntelRuns.stages }).from(siteIntelRuns).where(eq(siteIntelRuns.projectId, projectId)).orderBy(desc(siteIntelRuns.createdAt)).limit(1);
  const facts = (run?.stages ?? []).flatMap(s => s.facts ?? []);
  const waterFact = facts.find(x => /baseline water stress|water stress/i.test(x.label));
  const lossFact = facts.find(x => /tree cover loss/i.test(x.label));
  const [cs, rights, consent] = await Promise.all([
    db.select({ id: communities.id }).from(communities).where(and(eq(communities.projectId, projectId), isNull(communities.deletedAt))),
    db.select({ materiality: communityRights.materiality, resolution: communityRights.resolution }).from(communityRights).where(and(eq(communityRights.projectId, projectId), isNull(communityRights.deletedAt))),
    db.select({ status: consentRecords.status }).from(consentRecords).where(and(eq(consentRecords.projectId, projectId), isNull(consentRecords.deletedAt))),
  ]);
  const partyOrgs = (await db.select({ orgId: projectParties.orgId }).from(projectParties).where(eq(projectParties.projectId, projectId))).map(x => x.orgId).filter((x): x is string => !!x);
  const checks = partyOrgs.length ? await db.select({ result: sanctionsChecks.result, review: sanctionsChecks.review }).from(sanctionsChecks).where(and(eq(sanctionsChecks.entityType, "organization"), inArray(sanctionsChecks.entityId, partyOrgs))) : [];
  const cl = await db.select({ field: claims.field, status: claims.status }).from(claims).where(and(eq(claims.entityType, "project"), eq(claims.entityId, projectId)));
  const readiness = await projectReadinessScore(db, projectId);
  const [{ n: eligibleFunding }] = await db.select({ n: sql<number>`count(*)` }).from(fundingProjectMatches).where(and(eq(fundingProjectMatches.projectId, projectId), eq(fundingProjectMatches.eligibility, "eligible")));
  const sectorKey = (p.sector as string | null) ?? projectSector(p);
  return {
    name: p.name, text: `${p.name} ${p.technology ?? ""} ${p.assetClass ?? ""} ${p.description}`, sectorKey, country: p.country, stage: p.stage, exactLocation, spatial,
    water: { stress: waterFact ? waterFact.value : null, source: waterFact?.source ?? "" },
    forestLoss: { value: lossFact?.value ?? null, source: lossFact?.source ?? "" },
    community: { recorded: cs.length, rightsOpen: rights.filter(r => r.resolution === "open" && r.materiality !== "low").length, consent: consent.map(c => c.status) },
    sanctions: { possible: checks.filter(c => c.result === "possible_match" && c.review !== "cleared" && c.review !== "confirmed").length, confirmed: checks.filter(c => c.review === "confirmed").length },
    evidenceFields: [...new Set(cl.filter(c => c.field && ["verified", "source_provided", "calculated"].includes(c.status)).map(c => c.field!))],
    claims: { verified: cl.filter(c => c.status === "verified").length, sourced: cl.filter(c => c.status === "source_provided").length, inferred: cl.filter(c => c.status === "ai_inferred" || c.status === "assumption").length, total: cl.length },
    siteScreen: { done: (run?.stages ?? []).filter(s => s.status === "done").length, failed: (run?.stages ?? []).filter(s => s.status === "failed").length },
    readiness: { reading: readiness.reading, label: READING_LABEL[readiness.reading], blocking: readiness.blocking, workPackages: readiness.workPackages },
    eligibleFunding, regeneraSector: !!sectorKey,
  };
}

/** Screens one project under the current policy; supersedes (never edits) the previous decision. */
export async function screenProject(db: Db, projectId: string, actor = "system:integrity", opts: { constraints?: Constraints; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const policy = await currentPolicy(db);
  const facts = await gatherFacts(db, projectId, opts);
  const r = evaluateIntegrity(policy.rules, facts);
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  await db.update(policyDecisions).set({ current: false }).where(and(eq(policyDecisions.projectId, projectId), eq(policyDecisions.current, true)));
  const days = policy.rules.reviewDays[r.state] ?? 90;
  const [d] = await db.insert(policyDecisions).values({
    mandateId: p.mandateId, projectId, policyVersion: policy.version, classification: r.classification, state: r.state, readings: r.readings, rules: r.rules,
    confidence: r.confidence, outstanding: r.outstanding, remediation: r.remediation, decidedBy: actor, nextReviewAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  }).returning();
  for (const f of r.findings) await db.insert(integrityFindings).values({ mandateId: p.mandateId, projectId, decisionId: d.id, kind: f.kind, domain: f.domain, text: f.text, source: f.source, provenance: f.provenance });
  await db.insert(events).values({ mandateId: p.mandateId, type: "INTEGRITY_SCREENED", entityType: "project", entityId: projectId, payload: { summary: `Integrity: ${r.state.replace(/_/g, " ")} (${r.classification.replace(/_/g, " ")}), policy v${policy.version}`, decisionId: d.id }, actor });
  return d;
}

export async function currentDecision(db: Db, projectId: string) {
  const [d] = await db.select().from(policyDecisions).where(and(eq(policyDecisions.projectId, projectId), eq(policyDecisions.current, true))).limit(1);
  return d ?? null;
}

/** Owner override with a reason; the original rule outcomes stay on the record. Exclusions need ≥ 20 characters of reason. */
export async function overrideDecision(db: Db, projectId: string, to: DecisionState, reason: string, by: string) {
  const d = await currentDecision(db, projectId);
  if (!d) throw new Error("No decision to override: screen the project first");
  if ((d.state === "excluded" || d.state === "human_review") && reason.trim().length < 20) throw new Error("Reversing an exclusion or human-review state needs a documented reason (20+ characters)");
  const overrides = [...d.overrides, { at: new Date().toISOString(), by, from: d.state, to, reason: reason.trim() }];
  await db.update(policyDecisions).set({ state: to, overrides, decidedBy: by }).where(eq(policyDecisions.id, d.id));
  await audit(db, { actor: by, action: "integrity.override", entity: "policy_decisions", entityId: d.id, before: { state: d.state }, after: { state: to, reason } });
  return { ...d, state: to, overrides };
}

/** Job: projects with no current decision, or due for review, screened a few at a time (constraint lookups are heavy). */
export async function screenDue(db: Db, limit = 6, now = new Date()) {
  const decided = new Map((await db.select({ projectId: policyDecisions.projectId, next: policyDecisions.nextReviewAt }).from(policyDecisions).where(eq(policyDecisions.current, true))).map(x => [x.projectId, x.next]));
  const ps = await db.select({ id: projects.id }).from(projects).where(isNull(projects.archivedAt)).limit(1000);
  const due = ps.filter(p => !decided.has(p.id) || (decided.get(p.id) ?? "9999") <= now.toISOString()).slice(0, limit);
  for (const p of due) await screenProject(db, p.id, "system:integrity", { now }).catch(() => undefined);
  return { screened: due.length };
}
