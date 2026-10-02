// Opportunity discovery for objective scans (extended specification §7): "Find matching opportunities" for an EPC,
// "find projects" for a capital mandate, "find funding" for an applicant. Candidates come from records the OS already
// collects (workspace projects, procurement packages, ingested funding calls, public interconnection queues); each is
// matched with lib/flow/matching.ts and stored as a scan result with its evidence, caveats and next action.
// Coverage is limited to these sources, and the run page says so: this is never "all opportunities".
import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { fundingOpportunities, procurementPackages, projects, queueProjects, scanResults } from "@/db/schema";
import { matchCandidate, techTokens, type CandidateFacts, type ObjectiveCriteria } from "@/lib/flow/matching";
import type { ScanConfig } from "./config";
import { expandGeography } from "./countries";

export type OppProvider = "network_projects" | "procurement" | "funding_calls" | "queue_projects";
const PAGE = 100;
const QUEUE_TECH: Record<string, string[]> = { solar: ["solar", "solar_bess"], storage: ["bess", "solar_bess"], wind: ["wind"], gas: ["gas"] };

export function criteriaOf(c: ScanConfig): ObjectiveCriteria {
  return { geography: c.geography, capabilities: c.capabilities, sizeMin: c.sizeMin, sizeMax: c.sizeMax, sizeUnit: c.sizeUnit, stages: c.stages, exclusions: c.excludeTerms };
}

/** One page of one source. Returns how many results were stored, whether the source is exhausted, and the counts. */
export async function opportunityPage(db: Db, run: { id: string; mandateId: string }, c: ScanConfig, provider: OppProvider, offset: number, today: string, retrievedAt: string) {
  const crit = criteriaOf(c);
  const out: { kind: CandidateFacts["kind"]; id: string; facts: CandidateFacts; url: string | null }[] = [];
  let rows = 0;
  if (provider === "network_projects") {
    const r = await db.select().from(projects).where(and(eq(projects.mandateId, run.mandateId), isNull(projects.archivedAt), ne(projects.status, "dropped"))).limit(PAGE).offset(offset);
    rows = r.length;
    for (const p of r) out.push({ kind: "project", id: p.id, url: null, facts: { kind: "project", name: p.name, country: p.country, region: p.subdivision, technologies: [p.technology, p.subsector, p.sector].filter(Boolean) as string[], size: p.capacity, sizeUnit: p.capacityUnit, stage: p.stage, deadline: null, open: null, text: p.description ?? "", buyer: null, source: "Workspace project" } });
  } else if (provider === "procurement") {
    const r = await db.select({ k: procurementPackages, p: projects }).from(procurementPackages).innerJoin(projects, eq(projects.id, procurementPackages.projectId))
      .where(and(eq(procurementPackages.mandateId, run.mandateId), inArray(procurementPackages.stage, ["need", "rfi", "rfp"]), or(isNull(procurementPackages.bidsDueAt), gte(procurementPackages.bidsDueAt, today)))).limit(PAGE).offset(offset);
    rows = r.length;
    for (const { k, p } of r) out.push({ kind: "procurement", id: k.id, url: null, facts: { kind: "procurement", name: `${k.name} · ${p.name}`, country: p.country, region: p.subdivision, technologies: [k.category, p.technology, k.scope].filter(Boolean) as string[], size: k.budget, sizeUnit: k.currency, stage: k.stage, deadline: k.bidsDueAt?.slice(0, 10) ?? null, open: true, text: k.scope, buyer: p.name, source: "Workspace procurement" } });
  } else if (provider === "funding_calls") {
    const r = await db.select().from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, run.mandateId), ne(fundingOpportunities.status, "closed"), or(isNull(fundingOpportunities.deadline), gte(fundingOpportunities.deadline, today)))).limit(PAGE).offset(offset);
    rows = r.length;
    for (const f of r) out.push({ kind: "funding_call", id: f.id, url: f.url, facts: { kind: "funding_call", name: f.title, country: f.countries?.[0] ?? null, technologies: f.sectors ?? [], size: f.amountMax ?? f.amountMin, sizeUnit: f.currency, stage: null, deadline: f.deadline, rolling: f.rolling, open: f.status !== "closed", text: `${f.description} ${f.programme ?? ""}`, buyer: f.funder, source: f.source } });
  } else {
    // Public US queues: only when the objective covers the United States (or has no geography), filtered in SQL by technology and size.
    const geo = expandGeography(c.geography);
    if (geo.length && !geo.includes("USA")) return { stored: 0, exhausted: true, rows: 0, skipped: "Objective geography does not include the United States" };
    const techs = [...techTokens(c.capabilities)].flatMap(t => QUEUE_TECH[t] ?? []);
    // Live requests only: not withdrawn, not already done or in commercial operation (status wording differs by ISO).
    const conds = [isNull(queueProjects.withdrawnDate), sql`lower(${queueProjects.status}) not like '%withdraw%'`, sql`lower(${queueProjects.status}) not in ('done')`, sql`lower(${queueProjects.status}) not like '%commercial operation%'`];
    if (techs.length) conds.push(inArray(queueProjects.technology, techs));
    if (c.sizeMin != null && (!c.sizeUnit || /mw/i.test(c.sizeUnit))) conds.push(gte(queueProjects.mw, c.sizeMin));
    if (c.sizeMax != null && (!c.sizeUnit || /mw/i.test(c.sizeUnit))) conds.push(sql`${queueProjects.mw} <= ${c.sizeMax}`);
    const r = await db.select().from(queueProjects).where(and(...conds)).orderBy(queueProjects.key).limit(PAGE).offset(offset);
    rows = r.length;
    for (const q of r) out.push({ kind: "queue_project", id: q.key, url: null, facts: { kind: "queue_project", name: `${q.iso} ${q.number} · ${q.county ? `${q.county}, ` : ""}${q.state}`, country: "USA", region: q.state, technologies: [q.technology, q.fuel], size: q.mw, sizeUnit: "MW", stage: q.studyPhase || q.status, deadline: null, open: null, text: `${q.poi} ${q.transmissionOwner}`, buyer: null, source: `${q.iso} public queue` } });
  }
  let stored = 0;
  const counts = { found: 0, matching: 0, partial: 0, excluded: 0, needsReview: 0 };
  for (const o of out) {
    const m = matchCandidate(crit, o.facts, today);
    if (m.match === "unknown" && provider === "queue_projects") continue; // thousands of queue rows: keep only those with some supported fit
    const res = await db.insert(scanResults).values({
      mandateId: run.mandateId, runId: run.id, entityType: o.kind === "funding_call" ? "funding_call" : o.kind, entityId: o.id, name: o.facts.name, outcome: "existing",
      match: m.match === "supported" ? "matches" : m.match, criteria: m.criteria, missing: [], exclusionReason: m.hardExclusion, provider, sourceUrl: o.url, retrievedAt,
      confidence: m.confidence, caveats: m.caveats, nextAction: `${m.opportunityType}: ${m.nextAction}`, review: m.match === "excluded" ? "rejected" : "needs_review",
    }).onConflictDoNothing().returning({ id: scanResults.id });
    if (!res.length) continue;
    stored++; counts.found++;
    if (m.match === "supported") counts.matching++; else if (m.match === "partial") counts.partial++; else if (m.match === "excluded") counts.excluded++;
    if (m.match !== "excluded") counts.needsReview++;
  }
  return { stored, exhausted: rows < PAGE, rows, counts, skipped: null as string | null };
}

/** Stores open-web opportunities (lib/scan/web.ts) through the same matcher. The entity id is the first cited URL, so a
 *  repeated scan finds the same item instead of duplicating it. Announcements are never presented as open bids. */
export async function storeWebOpportunities(db: Db, run: { id: string; mandateId: string }, c: ScanConfig, items: import("./web").WebOpportunity[], today: string, retrievedAt: string) {
  const crit = criteriaOf(c);
  const counts = { found: 0, matching: 0, partial: 0, excluded: 0, needsReview: 0 };
  const LABEL = { tender: "Open tender", rfp: "Request for proposals / qualifications", seeking_partner: "Sponsor seeking partners", announcement: "Project announcement (no procurement stated)" } as const;
  for (const i of items) {
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(i.deadline) ? i.deadline : null;
    const procurement = i.type === "tender" || i.type === "rfp";
    const facts: CandidateFacts = { kind: procurement ? "procurement" : "project", name: i.title, country: i.country || null, region: i.region || null, technologies: [i.scope], size: i.size, sizeUnit: i.sizeUnit || null, stage: null, deadline, open: procurement ? true : null, text: `${i.scope} ${i.evidence}`, buyer: i.buyer || null, source: "Open web" };
    const m = matchCandidate(crit, facts, today);
    const caveats = [...m.caveats.filter(x => !x.startsWith("A project in your network")), `${LABEL[i.type]}${i.buyer ? ` · ${i.buyer}` : ""}. Found on the open web; verify on the source before acting.`, ...(i.type === "announcement" ? ["An announcement is not an open bid: confirm whether and how the sponsor will procure."] : [])];
    const res = await db.insert(scanResults).values({
      mandateId: run.mandateId, runId: run.id, entityType: "candidate", entityId: i.sources[0].slice(0, 500), name: i.title, outcome: "new",
      match: m.match === "supported" ? "matches" : m.match, criteria: [...m.criteria, { key: "evidence", label: "Source says", result: "unknown", evidence: i.evidence, source: i.sources[0] }],
      missing: [], exclusionReason: m.hardExclusion, provider: "web", sourceUrl: i.sources[0], retrievedAt, confidence: m.confidence === "high" ? "medium" : "low", caveats,
      nextAction: `${LABEL[i.type]}: ${procurement ? "Review the notice and decide bid / no-bid" : "Identify the sponsor's procurement lead and request an introduction"}`, review: m.match === "excluded" ? "rejected" : "needs_review",
    }).onConflictDoNothing().returning({ id: scanResults.id });
    if (!res.length) continue;
    counts.found++;
    if (m.match === "supported") counts.matching++; else if (m.match === "partial") counts.partial++; else if (m.match === "excluded") counts.excluded++;
    if (m.match !== "excluded") counts.needsReview++;
  }
  return counts;
}
