// Definition-of-done checks (master build instruction §22 PROOF): each check is evaluated against records, so "done"
// means the evidence exists, not that someone (or a model) said so.
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import {
  capitalMatches, capitalOpportunities, capitalRequirements, constraints, contacts, contracts, deals, decisions, documentRequests, documents, esIssues,
  organizations, permits, placeFacts, projectMilestones, projectParties, projectReadiness, projects, requirements, revenueStreams, risks, studies,
} from "@/db/schema";
import type { CheckResult } from "@/db/playbooks";
import type { CheckSpec } from "./types";

type Source = { table: SQLiteTable; key: SQLiteColumn; cols: Record<string, SQLiteColumn> };
const P = (table: SQLiteTable & { projectId: SQLiteColumn }, cols: Record<string, SQLiteColumn> = {}): Source => ({ table, key: table.projectId, cols });

/** Record sources a check may count, keyed to the run's entity. */
export const SOURCES: Record<string, Source> = {
  constraints: P(constraints, { status: constraints.status, severity: constraints.severity }),
  risks: P(risks, { status: risks.status }),
  studies: P(studies, { type: studies.type, status: studies.status }),
  place_facts: P(placeFacts, { dimension: placeFacts.dimension }),
  capital_requirements: P(capitalRequirements, { status: capitalRequirements.status }),
  capital_opportunities: P(capitalOpportunities, { gateState: capitalOpportunities.gateState }),
  project_parties: P(projectParties, { role: projectParties.role, confirmed: projectParties.confirmed }),
  documents: P(documents, { category: documents.category, status: documents.status }),
  permits: P(permits, { status: permits.status }),
  requirements: P(requirements, { status: requirements.status, track: requirements.track }),
  es_issues: P(esIssues, { status: esIssues.status }),
  milestones: P(projectMilestones, { status: projectMilestones.status }),
  decisions: P(decisions, { status: decisions.status }),
  revenue_streams: P(revenueStreams, { status: revenueStreams.status }),
  contracts: { table: contracts, key: contracts.projectId, cols: { lifecycle: contracts.lifecycle, category: contracts.category } },
  document_requests: { table: documentRequests, key: documentRequests.projectId, cols: { status: documentRequests.status } },
  org_contacts: { table: contacts, key: contacts.orgId, cols: {} },
  org_deals: { table: deals, key: deals.orgId, cols: { stage: deals.stage } },
  deal_contracts: { table: contracts, key: contracts.dealId, cols: { lifecycle: contracts.lifecycle, category: contracts.category } },
  opportunity_matches: { table: capitalMatches, key: capitalMatches.opportunityId, cols: { status: capitalMatches.status, eligibility: capitalMatches.eligibility } },
};

const ENTITY_TABLES: Record<string, { table: SQLiteTable; id: SQLiteColumn }> = {
  project: { table: projects, id: projects.id },
  organization: { table: organizations, id: organizations.id },
  capital_opportunity: { table: capitalOpportunities, id: capitalOpportunities.id },
  deal: { table: deals, id: deals.id },
  document: { table: documents, id: documents.id },
};

function whereFor(src: Source, entityId: string, where?: Record<string, string | string[]>, negate = false): SQL {
  const conds: SQL[] = [eq(src.key, entityId)];
  for (const [k, v] of Object.entries(where ?? {})) {
    const col = src.cols[k];
    if (!col) throw new Error(`Unknown filter ${k}`);
    conds.push(Array.isArray(v) ? (negate ? sql`${col} not in ${v}` : inArray(col, v)) : negate ? ne(col, v) : eq(col, v));
  }
  return and(...conds)!;
}

async function count(db: Db, src: Source, w: SQL) {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(src.table).where(w);
  return Number(r?.n ?? 0);
}

export async function evaluateCheck(db: Db, spec: CheckSpec, entityType: string, entityId: string | null): Promise<{ pass: boolean | null; detail: string }> {
  if (spec.type === "manual") return { pass: null, detail: "Confirmed by a person" };
  if (!entityId) return { pass: false, detail: "No entity" };
  if (spec.type === "field_present") {
    const e = ENTITY_TABLES[entityType];
    if (!e) return { pass: false, detail: `Unknown entity ${entityType}` };
    const [row] = await db.select().from(e.table).where(eq(e.id, entityId)) as Record<string, unknown>[];
    const v = row?.[spec.field];
    const ok = v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
    return { pass: ok, detail: ok ? `${spec.field} recorded` : `${spec.field} missing` };
  }
  if (spec.type === "readiness_known") {
    const [r] = await db.select({ n: sql<number>`count(*)` }).from(projectReadiness).where(and(eq(projectReadiness.projectId, entityId), ne(projectReadiness.status, "unknown")));
    const n = Number(r?.n ?? 0);
    return { pass: n >= spec.min, detail: `${n} of 14 readiness dimensions recorded (need ${spec.min})` };
  }
  if (spec.type === "party_role") {
    const rows = await db.select({ confirmed: projectParties.confirmed }).from(projectParties).where(and(eq(projectParties.projectId, entityId), eq(projectParties.role, spec.role as never)));
    const ok = rows.some(r => !spec.confirmed || r.confirmed === "confirmed");
    return { pass: ok, detail: ok ? `${spec.role} recorded${spec.confirmed ? " and confirmed" : ""}` : `No ${spec.confirmed ? "confirmed " : ""}${spec.role}` };
  }
  const src = SOURCES[spec.source];
  if (!src) return { pass: false, detail: `Unknown source ${spec.source}` };
  if (spec.type === "count_at_least") {
    const n = await count(db, src, whereFor(src, entityId, spec.where));
    return { pass: n >= spec.min, detail: `${n} ${spec.source.replace(/_/g, " ")} (need ${spec.min})` };
  }
  const n = await count(db, src, whereFor(src, entityId, spec.where));
  return { pass: n === 0, detail: n === 0 ? `No open ${spec.source.replace(/_/g, " ")}` : `${n} still open` };
}

export async function evaluateProof(db: Db, proof: { id: string; text: string; check: CheckSpec }[], entityType: string, entityId: string | null, confirmed: Set<string> = new Set()): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const p of proof) {
    const r = await evaluateCheck(db, p.check, entityType, entityId);
    out.push({ id: p.id, text: p.text, pass: p.check.type === "manual" ? confirmed.has(p.id) : r.pass, detail: p.check.type === "manual" ? (confirmed.has(p.id) ? "Confirmed" : "Needs a person to confirm") : r.detail });
  }
  return out;
}
