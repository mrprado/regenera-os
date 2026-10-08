// Origination engine (phase 22): one queue for capital-first, project-first and market-first, the project origination
// dossier, diagnostic proposals and market hypotheses. Deterministic: every figure comes from records; expected value is
// a service-band midpoint × evidence factor (a prioritization aid, never revenue). Nothing is sent; proposals and
// outreach drafts wait for a person.
import { and, desc, eq, gte, inArray, isNull, like, ne, notLike, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  claims, deals, engagements, events, fundingOpportunities, fundingProjectMatches, generatedDocuments, organizations, originationHypotheses, originationItems, policyDecisions,
  projectParties, projectReadiness, projects, services, siteIntelRuns, tasks, triggers,
} from "@/db/schema";
import { createEngagement } from "@/lib/commercial/engine";
import { LANES, PROGRAMMES, regionsOf, type Lane } from "@/lib/capital/programmes";
import { country as countryOf } from "@/lib/scan/countries";
import { SECTORS } from "@/lib/vocab";
import { CAPITAL_STAGES, ELIGIBILITY, capitalStageOf, type CapitalStage } from "./eligibility";
import { READING_LABEL, scoreReadiness, templateFor } from "./readiness";
import { assertProjectCleared } from "@/lib/integrity/gate";

export const ORIGINATION_STAGES = {
  discovered: "Discovered", verified: "Verified", qualified: "Qualified", outreach_proposed: "Outreach proposed", outreach_approved: "Outreach approved",
  contacted: "Contacted", responded: "Responded", discovery_meeting: "Discovery meeting", diagnostic_proposed: "Diagnostic proposed", diagnostic_engaged: "Diagnostic engaged",
  assessment_underway: "Assessment underway", readiness_proposed: "Readiness engagement proposed", readiness_engaged: "Readiness engaged", capital_strategy: "Capital strategy",
  capital_preparation: "Capital introduction / application preparation", due_diligence: "Due diligence", execution_support: "Execution support", won: "Won", lost: "Lost", deferred: "Deferred",
} as const;
export type OriginationStage = keyof typeof ORIGINATION_STAGES;

const MARKET = "Public pipeline:%";
const STAGE_LANES: Record<CapitalStage, Lane[]> = { development: ["prep", "equity"], construction: ["credit", "equity", "derisk"], long_term: ["credit", "acquisition"] };
const CLAIM_DIM: Record<string, string> = { capacity: "technical", annual_energy: "technical", storage: "technical", capex: "financial", financing: "capital", tariff: "commercial", offtake: "commercial", status: "permitting", board_approval: "capital", instrument: "capital" };

/** Readiness of one project against its sector template (rubric in lib/origination/readiness.ts). */
export async function projectReadinessScore(db: Db, projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const rows = await db.select({ dimension: projectReadiness.dimension, status: projectReadiness.status, evidence: projectReadiness.evidence }).from(projectReadiness).where(eq(projectReadiness.projectId, projectId));
  const cs = await db.select({ field: claims.field }).from(claims).where(and(eq(claims.entityType, "project"), eq(claims.entityId, projectId)));
  const claimCount = new Map<string, number>();
  for (const c of cs) { const d = c.field ? CLAIM_DIM[c.field] : undefined; if (d) claimCount.set(d, (claimCount.get(d) ?? 0) + 1); }
  const t = templateFor(p);
  return { project: p, ...scoreReadiness(t, rows.map(r => ({ ...r, claims: claimCount.get(r.dimension) ?? 0 }))) };
}

/** Pure: programmes split into viable / ineligible pathways for a capital stage, with reasons. */
export function capitalPathways(country: string | null, stage: CapitalStage) {
  const where = regionsOf(country);
  const wanted = STAGE_LANES[stage];
  return PROGRAMMES.map(pr => {
    const geo = !country ? null : pr.regions.some(r => where.includes(r) || r === country);
    const lanes = pr.lanes.filter(l => wanted.includes(l));
    const reasons = [geo === null ? "Project country not recorded" : geo ? `Covers ${country}` : `Does not list ${country}`, lanes.length ? `Lane fits ${stage.replace("_", "-")} capital: ${lanes.map(l => LANES[l].split(" (")[0]).join(", ")}` : `Lanes (${pr.lanes.join(", ")}) do not fit ${stage.replace("_", "-")} capital`];
    return { key: pr.key, name: pr.name, owner: pr.owner, url: pr.url, viable: geo === true && lanes.length > 0, unknown: geo === null, reasons, verify: pr.verify ?? null };
  });
}

const money = (n: number | null | undefined) => (n == null ? "not recorded" : `US$${(n / 1e6).toFixed(1)}m`);

/** Builds and saves (versioned, confidential) the Project Origination Dossier. */
export async function buildDossier(db: Db, projectId: string, actor: string) {
  const r = await projectReadinessScore(db, projectId);
  const p = r.project;
  const stage = capitalStageOf(p.stage);
  const parties = await db.select({ role: projectParties.role, name: organizations.name, confirmed: projectParties.confirmed, note: projectParties.note }).from(projectParties).innerJoin(organizations, eq(organizations.id, projectParties.orgId)).where(eq(projectParties.projectId, projectId));
  const matches = await db.select({ title: fundingOpportunities.title, url: fundingOpportunities.url, eligibility: fundingProjectMatches.eligibility, questions: fundingProjectMatches.questions, deadline: fundingOpportunities.deadline })
    .from(fundingProjectMatches).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingProjectMatches.opportunityId)).where(and(eq(fundingProjectMatches.projectId, projectId), ne(fundingProjectMatches.status, "dismissed"))).limit(10);
  const [run] = await db.select().from(siteIntelRuns).where(eq(siteIntelRuns.projectId, projectId)).orderBy(desc(siteIntelRuns.createdAt)).limit(1);
  const cs = await db.select({ statement: claims.statement, status: claims.status }).from(claims).where(and(eq(claims.entityType, "project"), eq(claims.entityId, projectId))).limit(20);
  const paths = capitalPathways(p.country, stage);
  const next = (["development", "construction", "long_term"] as CapitalStage[])[Math.min(2, ["development", "construction", "long_term"].indexOf(stage) + 1)];
  const body = [
    `# Project origination dossier: ${p.name}`, "",
    `${p.country ? countryOf(p.country)?.name ?? p.country : "Country not recorded"} · stage ${p.stage} · ${p.technology ?? "technology not recorded"} · CAPEX ${money(p.capex)} · origination: ${p.originationSource ?? "not recorded"}.`,
    "PRELIMINARY. Source-backed facts are marked with their status; anything inferred says so. Proximity to grid is not interconnection capacity; eligibility is on stated criteria only.", "",
    "## Evidence on record", ...(cs.length ? cs.map(c => `- ${c.statement} [${c.status}]`) : ["- No claims recorded yet."]), "",
    "## Counterparties (as recorded)", ...(parties.length ? parties.map(x => `- ${x.role}: ${x.name} (${x.confirmed}${x.note ? `; ${x.note}` : ""})`) : ["- None recorded: sponsor identity is a gap."]), "",
    `## Readiness (${r.templateLabel} rubric)`, `Reading: ${READING_LABEL[r.reading]}${r.score != null ? ` · ${r.score}/100` : ""} · coverage ${Math.round(r.coverage * 100)}% of template dimensions.`,
    ...r.dims.map(d => `- ${d.label}${d.critical ? " (critical)" : ""}: ${d.score === null ? "insufficient data" : `${d.score}/3`} · ${d.note} · expected evidence: ${d.evidenceExpected}`),
    ...(r.blocking.length ? ["", `Blocking: ${r.blocking.join(", ")}.`] : []), "",
    `## Financing thesis by capital stage`, `Now: ${CAPITAL_STAGES[stage]}. Next milestone: ${CAPITAL_STAGES[next]}.`,
    "Viable pathways now (geography and lane fit; confirm eligibility with each institution):", ...paths.filter(x => x.viable).slice(0, 10).map(x => `- ${x.name} (${x.owner}): ${x.reasons.join("; ")}${x.verify ? `; verify: ${x.verify}` : ""}`),
    "Not viable now (and why):", ...paths.filter(x => !x.viable && !x.unknown).slice(0, 8).map(x => `- ${x.name}: ${x.reasons.join("; ")}`), "",
    "## Funding calls matched", ...(matches.length ? matches.map(m => `- ${m.title} · ${m.eligibility ? ELIGIBILITY[m.eligibility] : "screened"} · deadline ${m.deadline ?? "not stated"}${m.questions?.length ? ` · ask: ${m.questions.join("; ")}` : ""}`) : ["- None yet."]), "",
    "## Site intelligence", run ? `Run ${run.id.slice(0, 8)} (${run.status}): ${run.stages.filter(s => s.status === "done").map(s => `${s.key}: ${s.summary ?? ""}`).join(" | ").slice(0, 1500)}` : "No site screen yet (Atlas → Screen a site).", "",
    "## Recommended work packages", ...(r.workPackages.length ? r.workPackages.map(w => `- ${w}`) : ["- None: verify in diligence."]), "",
    "## Next action", r.reading === "insufficient_evidence" ? "Collect sponsor documents (request list) and run a Project Diagnostic." : r.blocking.length ? `Resolve blocking dimensions (${r.blocking.join(", ")}) before approaching capital.` : "Prepare a readiness engagement proposal and shortlist capital pathways.",
  ].join("\n");
  const [prev] = await db.select({ id: generatedDocuments.id, version: generatedDocuments.version }).from(generatedDocuments).where(and(eq(generatedDocuments.entityId, projectId), eq(generatedDocuments.templateKey, "origination_dossier"))).orderBy(desc(generatedDocuments.createdAt)).limit(1);
  const [doc] = await db.insert(generatedDocuments).values({ mandateId: p.mandateId, templateKey: "origination_dossier", title: `Origination dossier · ${p.name}`, entityType: "project", entityId: projectId, values: { reading: r.reading }, body, version: (prev?.version ?? 0) + 1, previousId: prev?.id ?? null, legal: false, legalReviewStatus: "not_required", confidential: true, createdBy: actor }).returning({ id: generatedDocuments.id, version: generatedDocuments.version });
  await db.insert(events).values({ mandateId: p.mandateId, type: "DOSSIER_GENERATED", entityType: "project", entityId: projectId, payload: { summary: `Origination dossier v${doc.version}: ${READING_LABEL[r.reading]}`, documentId: doc.id }, actor });
  return { documentId: doc.id, version: doc.version, readiness: r };
}

/** Pure: which service fits a project given its readiness reading and matches. */
export function recommendForProject(reading: string, hasEligibleFunding: boolean) {
  if (hasEligibleFunding && (reading === "insufficient_evidence" || reading === "early")) return { key: "funding_diagnostic", why: "A matched funding call and thin evidence: eligibility and readiness diagnostic first." };
  if (reading === "insufficient_evidence" || reading === "early" || reading === "blocked") return { key: "project_diagnostic", why: `Readiness reads "${READING_LABEL[reading]}": a fixed-scope diagnostic establishes maturity and the readiness plan.` };
  if (reading === "advancing") return { key: "readiness_assessment", why: "Advancing project: a readiness assessment turns gaps into a work-package plan." };
  return { key: "capital_strategy", why: "Investment-ready candidate: capital strategy and preparation (legal gate for introductions)." };
}

/** Pure: which service fits an organization's need, from its recorded roles (commercial operations engine). */
export function recommendForOrg(roles: string[]) {
  if (roles.some(r => ["epc", "engineer"].includes(r))) return { key: "ai_systems_implementation", why: "EPC / engineering firm: an origination system plus a market-access retainer." };
  if (roles.includes("oem")) return { key: "technology_commercialization", why: "Technology provider: buyer research and deployment-partner discovery." };
  if (roles.some(r => ["investor", "lender", "dfi", "fund"].includes(r))) return { key: "capital_provider_screening", why: "Capital provider: mandate-matched project screening, then managed intelligence." };
  if (roles.some(r => ["developer", "sponsor"].includes(r))) return { key: "project_diagnostic", why: "Developer / sponsor: a project diagnostic is the entry point." };
  return null;
}

async function serviceBand(db: Db, mandateId: string, key: string) {
  const [s] = await db.select({ id: services.id, low: services.bandLow, high: services.bandHigh, perMonth: services.perMonth, name: services.name, listPrice: services.listPrice }).from(services).where(and(eq(services.mandateId, mandateId), eq(services.key, key)));
  return s ? { ...s, low: s.low ?? 0 } : null;
}

const FACTOR: Record<string, number> = { eligible: 1, potentially_eligible: 0.6, insufficient_evidence: 0.3 };

/** Rebuilds the origination queue from current records (idempotent by dedupe key; stage and owner are kept). */
export async function syncOriginationQueue(db: Db, mandateId: string, now = new Date()) {
  let upserts = 0;
  const upsert = async (x: Omit<typeof originationItems.$inferInsert, "mandateId">) => {
    const [ex] = await db.select({ id: originationItems.id }).from(originationItems).where(and(eq(originationItems.mandateId, mandateId), eq(originationItems.dedupeKey, x.dedupeKey)));
    if (ex) await db.update(originationItems).set({ title: x.title, recommendedService: x.recommendedService, serviceReason: x.serviceReason, expectedValueUsd: x.expectedValueUsd, valueBasis: x.valueBasis, priority: x.priority, nextAction: x.nextAction, updatedAt: now.toISOString() }).where(eq(originationItems.id, ex.id));
    else await db.insert(originationItems).values({ ...x, mandateId });
    upserts++;
  };
  // Integrity decisions (phase 23): blocked projects get no service, no value and say why. Fee potential never changes this.
  const decision = new Map((await db.select({ projectId: policyDecisions.projectId, state: policyDecisions.state, v: policyDecisions.policyVersion }).from(policyDecisions).where(and(eq(policyDecisions.mandateId, mandateId), eq(policyDecisions.current, true)))).map(d => [d.projectId, d]));
  const blockedNote = (projectId: string | null) => { const d = projectId ? decision.get(projectId) : undefined; return d && (d.state === "excluded" || d.state === "human_review") ? `Integrity: ${d.state.replace(/_/g, " ")} (policy v${d.v}). No advancement until an owner reviews it.` : null; };
  const integrityNote = (projectId: string | null) => { const d = projectId ? decision.get(projectId) : undefined; return d ? ` · integrity: ${d.state.replace(/_/g, " ")}` : " · integrity: not screened"; };
  // Capital-first: matched funding → project.
  const ms = await db.select({ id: fundingProjectMatches.id, projectId: fundingProjectMatches.projectId, opportunityId: fundingProjectMatches.opportunityId, eligibility: fundingProjectMatches.eligibility, title: fundingOpportunities.title, pname: projects.name })
    .from(fundingProjectMatches).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingProjectMatches.opportunityId)).innerJoin(projects, eq(projects.id, fundingProjectMatches.projectId))
    .where(and(eq(fundingProjectMatches.mandateId, mandateId), ne(fundingProjectMatches.status, "dismissed"))).limit(500);
  for (const m of ms) {
    const svc = await serviceBand(db, mandateId, "funding_diagnostic");
    const mid = svc ? (svc.low + (svc.high ?? svc.low)) / 2 : null;
    const f = FACTOR[m.eligibility ?? "insufficient_evidence"] ?? 0.3;
    const blockedM = blockedNote(m.projectId);
    if (blockedM) { await upsert({ entrance: "capital_first", strategy: "funding_match", title: `${m.pname} ← ${m.title.slice(0, 120)}`, projectId: m.projectId, opportunityId: m.opportunityId, matchId: m.id, recommendedService: null, serviceReason: null, expectedValueUsd: null, valueBasis: "Not valued: integrity decision blocks advancement", priority: -1, nextAction: blockedM, dedupeKey: `match:${m.id}` }); continue; }
    await upsert({ entrance: "capital_first", strategy: "funding_match", title: `${m.pname} ← ${m.title.slice(0, 120)}`, projectId: m.projectId, opportunityId: m.opportunityId, matchId: m.id,
      recommendedService: "funding_diagnostic", serviceReason: `Funding match (${ELIGIBILITY[(m.eligibility ?? "insufficient_evidence") as keyof typeof ELIGIBILITY]})`,
      expectedValueUsd: mid ? Math.round(mid * f) : null, valueBasis: mid ? `Funding diagnostic band midpoint US$${mid.toLocaleString("en-US")} × ${f} (${m.eligibility ?? "unassessed"})` : "Service not in catalogue",
      priority: mid ? Math.round((mid * f) / 1000) : 0, nextAction: m.eligibility === "eligible" ? "Verify the sponsor and generate the dossier" : "Answer the eligibility questions with the funder", dedupeKey: `match:${m.id}` });
  }
  // Project-first: existing projects (own, Market pipeline, extracted) and Atlas site screens.
  const ps = await db.select({ id: projects.id, name: projects.name, origin: projects.originationSource, stage: projects.stage }).from(projects).where(and(eq(projects.mandateId, mandateId), isNull(projects.archivedAt))).limit(600);
  for (const p of ps) {
    const blockedP = blockedNote(p.id);
    if (blockedP) { await upsert({ entrance: "project_first", strategy: (p.origin ?? "") === "Atlas site screen" ? "site_asset" : "existing_project", title: p.name, projectId: p.id, recommendedService: null, serviceReason: null, expectedValueUsd: null, valueBasis: "Not valued: integrity decision blocks advancement", priority: -1, nextAction: blockedP, dedupeKey: `project:${p.id}` }); continue; }
    const r = await projectReadinessScore(db, p.id);
    const hasFunding = ms.some(m => m.projectId === p.id && m.eligibility === "eligible");
    const rec = recommendForProject(r.reading, hasFunding);
    const svc = await serviceBand(db, mandateId, rec.key);
    const mid = svc ? (svc.low + (svc.high ?? svc.low)) / 2 : null;
    const market = (p.origin ?? "").startsWith("Public pipeline:");
    const f = market ? 0.2 : r.reading === "insufficient_evidence" ? 0.4 : 0.7; // public projects need a sponsor relationship first
    await upsert({ entrance: "project_first", strategy: (p.origin ?? "") === "Atlas site screen" ? "site_asset" : "existing_project", title: p.name, projectId: p.id,
      recommendedService: rec.key, serviceReason: rec.why + integrityNote(p.id), expectedValueUsd: mid ? Math.round(mid * f) : null,
      valueBasis: mid ? `${svc!.name} band midpoint US$${mid.toLocaleString("en-US")} × ${f}${market ? " (public project: sponsor not engaged)" : ""}` : "Service not in catalogue",
      priority: mid ? Math.round((mid * f) / 1000) : 0, nextAction: market ? "Identify the sponsor's credible contact channel" : r.blocking.length ? `Resolve: ${r.blocking.join(", ")}` : "Generate dossier and diagnostic proposal", dedupeKey: `project:${p.id}` });
  }
  // Market-first: hypotheses awaiting validation.
  for (const h of await db.select().from(originationHypotheses).where(and(eq(originationHypotheses.mandateId, mandateId), eq(originationHypotheses.status, "to_validate")))) {
    await upsert({ entrance: "market_first", strategy: "needs_based", title: `HYPOTHESIS · ${h.title}`, hypothesisId: h.id, recommendedService: "market_intel", serviceReason: "Validate the thesis before any outreach",
      expectedValueUsd: null, valueBasis: "Not valued until validated", priority: 1, nextAction: "Validate with the listed evidence; convert or dismiss", dedupeKey: `hyp:${h.id}` });
  }
  // Commercial operations: organizations in an active deal without an engagement → recommended service by role.
  const ds = await db.select({ orgId: deals.orgId, name: organizations.name, roles: organizations.roles }).from(deals).innerJoin(organizations, eq(organizations.id, deals.orgId))
    .where(and(eq(deals.mandateId, mandateId), notLike(deals.stage, "%lost%"))).limit(300);
  const engaged = new Set((await db.select({ orgId: engagements.orgId }).from(engagements).where(eq(engagements.mandateId, mandateId))).map(e => e.orgId));
  for (const d of ds) {
    if (!d.orgId || engaged.has(d.orgId)) continue;
    const rec = recommendForOrg(d.roles ?? []);
    if (!rec) continue;
    const svc = await serviceBand(db, mandateId, rec.key);
    const mid = svc ? (svc.low + (svc.high ?? svc.low)) / 2 : null;
    await upsert({ entrance: "project_first", strategy: "client_need", title: `${d.name} · client need`, orgId: d.orgId, recommendedService: rec.key, serviceReason: rec.why,
      expectedValueUsd: mid ? Math.round(mid * 0.5) : null, valueBasis: mid ? `${svc!.name} midpoint × 0.5 (open deal, not engaged)` : "Service not in catalogue", priority: mid ? Math.round(mid * 0.5 / 1000) : 0,
      nextAction: "Confirm the need in the next conversation", dedupeKey: `org:${d.orgId}` });
  }
  return { upserts };
}

/** Diagnostic proposal: dossier → recommended service → draft engagement + proposal document + outreach draft (for approval) + task. */
export async function proposeDiagnostic(db: Db, projectId: string, actor: string) {
  await assertProjectCleared(db, projectId, "A diagnostic proposal and outreach draft");
  const dossier = await buildDossier(db, projectId, actor);
  const p = dossier.readiness.project;
  const funding = await db.select({ e: fundingProjectMatches.eligibility }).from(fundingProjectMatches).where(and(eq(fundingProjectMatches.projectId, projectId), eq(fundingProjectMatches.eligibility, "eligible"))).limit(1);
  const rec = recommendForProject(dossier.readiness.reading, funding.length > 0);
  const svc = await serviceBand(db, p.mandateId, rec.key);
  const [sponsor] = await db.select({ orgId: projectParties.orgId, name: organizations.name }).from(projectParties).innerJoin(organizations, eq(organizations.id, projectParties.orgId)).where(and(eq(projectParties.projectId, projectId), inArray(projectParties.role, ["sponsor", "operator", "developer"]))).limit(1);
  const engagement = await createEngagement(db, { mandateId: p.mandateId, name: `${svc?.name ?? rec.key} · ${p.name}`, orgId: sponsor?.orgId ?? null, projectId, serviceIds: svc ? [svc.id] : [], source: "origination" }, actor);
  const body = [
    `# Proposal (DRAFT): ${svc?.name ?? rec.key} — ${p.name}`, "",
    `Why this service: ${rec.why}`, `Readiness reading: ${READING_LABEL[dossier.readiness.reading]}. Dossier v${dossier.version} attached.`, "",
    "## Scope", ...(dossier.readiness.workPackages.length ? dossier.readiness.workPackages.map(w => `- ${w}`) : ["- Diagnostic review of all template dimensions"]), "",
    "## Fee", svc ? `Internal default band US$${svc.low.toLocaleString("en-US")}–${(svc.high ?? svc.low).toLocaleString("en-US")}${svc.perMonth ? " per month" : ""} (a pricing hypothesis to confirm, not a market rate).` : "To be set.", "",
    "## Not included", "No promise of eligibility, financing or funder endorsement. Capital introductions are separately approved and legally reviewed.", "",
    "## Outreach draft (FOR APPROVAL — not sent)", `To: ${sponsor?.name ?? "[sponsor to be identified]"}`,
    `We reviewed publicly available information on ${p.name}. Our preliminary read suggests ${dossier.readiness.blocking.length ? `${dossier.readiness.blocking.join(" and ").toLowerCase()} need attention before capital engagement` : "the project could be prepared for capital engagement"}. We would propose a short, fixed-scope ${svc?.name ?? "diagnostic"} to confirm maturity and a readiness plan. Would a 30-minute call next week be useful?`,
  ].join("\n");
  const [doc] = await db.insert(generatedDocuments).values({ mandateId: p.mandateId, templateKey: "diagnostic_proposal", title: `Proposal draft · ${p.name}`, entityType: "project", entityId: projectId, values: { engagementId: engagement.id, service: rec.key }, body, version: 1, legal: false, legalReviewStatus: "not_required", confidential: true, createdBy: actor }).returning({ id: generatedDocuments.id });
  await db.insert(tasks).values({ mandateId: p.mandateId, projectId, orgId: sponsor?.orgId ?? null, type: "follow_up", title: `Approve proposal and outreach: ${p.name}`, body: `Proposal draft and outreach text saved (document ${doc.id.slice(0, 8)}). Nothing has been sent.`, dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() });
  const [item] = await db.select({ id: originationItems.id }).from(originationItems).where(and(eq(originationItems.mandateId, p.mandateId), eq(originationItems.dedupeKey, `project:${projectId}`)));
  if (item) await db.update(originationItems).set({ stage: "diagnostic_proposed", engagementId: engagement.id, dossierId: dossier.documentId, proposalId: doc.id, updatedAt: new Date().toISOString() }).where(eq(originationItems.id, item.id));
  await db.insert(events).values({ mandateId: p.mandateId, type: "PROPOSAL_DRAFTED", entityType: "project", entityId: projectId, payload: { summary: `Proposal draft: ${svc?.name ?? rec.key}`, engagementId: engagement.id, documentId: doc.id }, actor });
  return { engagementId: engagement.id, proposalId: doc.id, dossierId: dossier.documentId, service: rec.key };
}

/** Market-first: ≥3 relevant triggers in one country and sector within 60 days → a labelled hypothesis to validate. */
export async function generateHypotheses(db: Db, mandateId: string, now = new Date()) {
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const ts = await db.select({ id: triggers.id, country: triggers.country, type: triggers.type, summary: triggers.summary, url: triggers.sourceUrl, date: triggers.eventDate, sug: triggers.suggestedEngagement })
    .from(triggers).where(and(eq(triggers.mandateId, mandateId), gte(triggers.createdAt, since))).limit(2000);
  const groups = new Map<string, typeof ts>();
  for (const t of ts) {
    let sector: string | null = null;
    try { sector = (JSON.parse(t.sug ?? "{}") as { sectors?: string[] }).sectors?.[0] ?? null; } catch { sector = null; }
    if (!t.country || !sector) continue;
    const k = `${t.country}|${sector}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  let created = 0;
  for (const [k, list] of groups) {
    if (list.length < 3) continue;
    const [country, sector] = k.split("|");
    const key = `${k}|${now.toISOString().slice(0, 7)}`;
    const [ex] = await db.select({ id: originationHypotheses.id }).from(originationHypotheses).where(eq(originationHypotheses.dedupeKey, key));
    if (ex) continue;
    const c = countryOf(country);
    const orgs = await db.select({ id: organizations.id, name: organizations.name, roles: organizations.roles }).from(organizations).where(and(eq(organizations.mandateId, mandateId), or(eq(organizations.country, c?.iso3 ?? country), like(organizations.location, `%${c?.name ?? country}%`)), eq(organizations.sector, sector))).limit(8);
    await db.insert(originationHypotheses).values({
      mandateId, title: `${SECTORS[sector as keyof typeof SECTORS] ?? sector} activity in ${c?.name ?? country}`, country: c?.iso3 ?? country, sector, dedupeKey: key,
      thesis: `${list.length} signals in 60 days (${[...new Set(list.map(t => t.type))].join(", ")}) point to development activity. HYPOTHESIS: there may be projects or sponsors needing development, readiness or capital support. Not a project; validate before outreach.`,
      evidence: list.slice(0, 12).map(t => ({ kind: "trigger", id: t.id, label: t.summary, url: t.url, date: t.date })),
      counterparts: orgs.map(o => ({ orgId: o.id, name: o.name, why: (o.roles ?? []).join(", ") || "recorded in this country and sector" })),
      validation: ["Confirm the signals describe real projects or programmes", "Identify the sponsor / authority and its decision stage", "Check grid, land and permitting context in Atlas", "Decide: convert to project, pursue, or dismiss"],
    });
    created++;
  }
  return { groups: groups.size, created };
}

export async function originationCounts(db: Db, mandateIds: string[]) {
  const n = sql<number>`count(*)`;
  const [q] = await db.select({ n }).from(originationItems).where(and(inArray(originationItems.mandateId, mandateIds), notLike(originationItems.stage, "%won%")));
  const [h] = await db.select({ n }).from(originationHypotheses).where(and(inArray(originationHypotheses.mandateId, mandateIds), eq(originationHypotheses.status, "to_validate")));
  return { queue: q?.n ?? 0, hypotheses: h?.n ?? 0 };
}
export const MARKET_LIKE = MARKET;

/** Gap intelligence (phase 23): open funding in a country and sector where Regenera has no project → a thesis to validate.
 *  Always labelled HYPOTHESIS; open calls are evidence of available money for the sector, not of a project. */
export async function generateGapTheses(db: Db, mandateId: string, now = new Date()) {
  const opps = await db.select({ id: fundingOpportunities.id, title: fundingOpportunities.title, url: fundingOpportunities.url, deadline: fundingOpportunities.deadline, countries: fundingOpportunities.countries, sectors: fundingOpportunities.sectors })
    .from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, mandateId), ne(fundingOpportunities.status, "closed"), eq(fundingOpportunities.category, "opportunity"))).limit(3000);
  const own = await db.select({ country: projects.country, sector: projects.sector, technology: projects.technology, name: projects.name, assetClass: projects.assetClass }).from(projects)
    .where(and(eq(projects.mandateId, mandateId), isNull(projects.archivedAt), or(isNull(projects.originationSource), notLike(projects.originationSource, MARKET))));
  const { projectSector } = await import("@/lib/site-intel/opportunity");
  const covered = new Set(own.map(p => `${p.country}|${(p.sector as string | null) ?? projectSector(p) ?? ""}`));
  const groups = new Map<string, typeof opps>();
  for (const o of opps) for (const c of new Set((o.countries ?? []).map(x => countryOf(x)?.iso3).filter((x): x is string => !!x))) for (const s of o.sectors ?? []) {
    const k = `${c}|${s}`;
    if (!covered.has(k)) groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  let created = 0;
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const [iso3, sector] = k.split("|");
    const key = `gap:${k}|${now.toISOString().slice(0, 7)}`;
    const [ex] = await db.select({ id: originationHypotheses.id }).from(originationHypotheses).where(eq(originationHypotheses.dedupeKey, key));
    if (ex) continue;
    const c = countryOf(iso3);
    const orgs = await db.select({ id: organizations.id, name: organizations.name, roles: organizations.roles }).from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.country, iso3), eq(organizations.sector, sector))).limit(8);
    await db.insert(originationHypotheses).values({
      mandateId, title: `Funding without a pipeline: ${SECTORS[sector as keyof typeof SECTORS] ?? sector} in ${c?.name ?? iso3}`, country: iso3, sector, dedupeKey: key,
      thesis: `${list.length} open or forthcoming funding records list ${c?.name ?? iso3} for ${SECTORS[sector as keyof typeof SECTORS] ?? sector}, and Regenera has no project there in that sector. HYPOTHESIS: originate or partner on a project that fits these programmes. Not a project; eligibility is per call.`,
      evidence: list.slice(0, 10).map(o => ({ kind: "funding", id: o.id, label: o.title, url: o.url, date: o.deadline })),
      counterparts: orgs.map(o => ({ orgId: o.id, name: o.name, why: (o.roles ?? []).join(", ") || "recorded in this country and sector" })),
      validation: ["Read the calls: eligible applicants, ticket size, deadlines", "Identify developers or authorities with a fitting project", "Check sites in Atlas (Screen a site) before any approach", "Convert, pursue with a partner, or dismiss"],
    });
    created++;
  }
  return { groups: groups.size, created };
}
