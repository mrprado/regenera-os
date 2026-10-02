// Built Environment engine (database part). Run built-environment intelligence for a project (store the solution
// stack), find the projects a company matches, create a partnership opportunity (→ deal + outreach task), open an
// RFI from a recommendation (→ procurement package, invited suppliers), the capital graph, overview counts and the
// Command items. Everything is scoped by the caller's workspaces and audited.
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  beCompanyProfiles, beMatches, beMaterials, beOpportunities, beSignals, beSystems, beTechnologies, bids, deals, networkProfiles, organizations, procurementPackages, projects,
  projectScreeningFlags, siteIntelRuns, tasks,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { siteProfile, solutionStack, type Candidate } from "./fit";
import type { StackCategory } from "./vocab";

const CATEGORY_OF: Record<string, StackCategory> = { architecture: "design", construction: "construction", materials: "materials", contech: "digital", energy: "energy", water: "water", circularity: "water", property: "digital", resilience: "resilience" };

export async function candidates(db: Db, mandateIds: string[]): Promise<Candidate[]> {
  if (!mandateIds.length) return [];
  const [techs, mats, syss] = await Promise.all([
    db.select().from(beTechnologies).where(inArray(beTechnologies.mandateId, mandateIds)),
    db.select().from(beMaterials).where(inArray(beMaterials.mandateId, mandateIds)),
    db.select().from(beSystems).where(inArray(beSystems.mandateId, mandateIds)),
  ]);
  return [
    ...techs.map(t => ({ subjectType: "technology" as const, id: t.id, name: t.name, category: CATEGORY_OF[t.category] ?? "digital", maturity: t.maturity, climates: t.climates, hazards: t.hazards, buildingTypes: t.buildingTypes, stageFit: t.stageFit, effects: t.effects, providers: t.orgId ? [t.orgId] : [] })),
    ...mats.map(m => ({ subjectType: "material" as const, id: m.id, name: m.name, category: "materials" as const, maturity: "proven", climates: m.climates, hazards: m.hazards, buildingTypes: [], stageFit: [], effects: { embodied: m.tags.includes("low_carbon") ? "lower" : "unknown" }, providers: m.supplierOrgId ? [m.supplierOrgId] : [], local: m.tags.includes("local") })),
    ...syss.map(x => ({ subjectType: "system" as const, id: x.id, name: x.name, category: "construction" as const, maturity: "proven", climates: x.climates, hazards: x.hazards, buildingTypes: x.buildingTypes, stageFit: [], effects: { capex: x.costEffect, speed: x.speedEffect, embodied: x.carbonEffect }, providers: x.providerOrgIds })),
  ];
}

/** RUN BUILT ENVIRONMENT INTELLIGENCE: site profile + candidates → stored solution stack (shortlisted rows kept). */
export async function runBuiltIntelligence(db: Db, projectId: string, actor: string, now = new Date()) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const [run] = await db.select().from(siteIntelRuns).where(and(eq(siteIntelRuns.projectId, projectId), inArray(siteIntelRuns.status, ["complete", "partial"]))).orderBy(desc(siteIntelRuns.createdAt)).limit(1);
  const flags = (await db.select({ flag: projectScreeningFlags.flag }).from(projectScreeningFlags).where(and(eq(projectScreeningFlags.projectId, projectId), eq(projectScreeningFlags.status, "open")))).map(f => f.flag);
  const facts = run ? run.stages.flatMap(s => s.facts ?? []) : [];
  const site = siteProfile(p, facts, flags);
  const out = solutionStack(await candidates(db, [p.mandateId]), site);
  await db.delete(beMatches).where(and(eq(beMatches.projectId, projectId), eq(beMatches.status, "suggested")));
  const kept = await db.select({ subjectId: beMatches.subjectId, label: beMatches.label }).from(beMatches).where(eq(beMatches.projectId, projectId));
  let rank = 0;
  for (const g of out.stack) for (const r of g.items) {
    rank++;
    if (kept.some(k => (r.subjectId && k.subjectId === r.subjectId) || k.label === r.label)) continue;
    await db.insert(beMatches).values({ mandateId: p.mandateId, projectId, subjectType: r.subjectType, subjectId: r.subjectId, category: g.category, label: r.label, reason: r.reason, confidence: r.confidence, impacts: r.impacts, stageFit: r.stageFit, providerOrgIds: r.providers, rank, runAt: now.toISOString() });
  }
  await audit(db, { actor, action: "built_intelligence_run", entity: "projects", entityId: projectId, after: { categories: out.stack.map(g => g.category), items: rank } });
  return out;
}

export async function setMatchStatus(db: Db, id: string, status: "suggested" | "shortlisted" | "rejected", actor: string) {
  await db.update(beMatches).set({ status, updatedAt: new Date().toISOString() }).where(eq(beMatches.id, id));
  await audit(db, { actor, action: "built_match_status", entity: "be_matches", entityId: id, after: { status } });
}

/** Projects a company matches: through its technologies, materials or systems, or as a listed provider. */
export async function projectsForCompany(db: Db, orgId: string) {
  const rows = await db.select({ m: beMatches, name: projects.name, country: projects.country }).from(beMatches).innerJoin(projects, eq(projects.id, beMatches.projectId))
    .where(sql`exists (select 1 from json_each(${beMatches.providerOrgIds}) j where j.value = ${orgId})`).orderBy(desc(beMatches.updatedAt)).limit(50);
  const byProject = new Map<string, { projectId: string; name: string; country: string | null; items: string[] }>();
  for (const r of rows) { const x = byProject.get(r.m.projectId) ?? { projectId: r.m.projectId, name: r.name, country: r.country, items: [] }; x.items.push(r.m.label); byProject.set(r.m.projectId, x); }
  return [...byProject.values()];
}

/** §10, §26 Partnership opportunity → deal in Deals, an outreach task, audit. Fee compliance starts unknown. */
export async function createPartnership(db: Db, input: { mandateId: string; orgId: string; title: string; kinds: string[]; projectIds: string[]; feeModels: string[]; regeneraAssets: string; signalId?: string | null }, actor: string, now = new Date()) {
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, input.orgId));
  if (!org) throw new Error("Organization not found");
  const [deal] = await db.insert(deals).values({ mandateId: input.mandateId, orgId: input.orgId, name: `${input.title}`.slice(0, 200), path: "partner_network", stage: "lead", engagement: "diagnostic", source: "other", projectId: input.projectIds[0] ?? null,
    notes: `Built environment partnership. Engagement: ${input.kinds.join(", ")}. Fee models considered: ${input.feeModels.join(", ") || "not set"}. Success fees need legal review before they are offered.`, nextAction: "Outreach: confirm interest and fit", nextActionDate: new Date(now.getTime() + 3 * 86_400_000).toISOString().slice(0, 10) }).returning({ id: deals.id });
  const [opp] = await db.insert(beOpportunities).values({ mandateId: input.mandateId, orgId: input.orgId, title: input.title, kinds: input.kinds, projectIds: input.projectIds, feeModels: input.feeModels, feeCompliance: input.feeModels.includes("success") ? "review_required" : "unknown", regeneraAssets: input.regeneraAssets, dealId: deal.id, signalId: input.signalId ?? null, owner: actor, status: "identified" }).returning();
  await db.insert(tasks).values({ mandateId: input.mandateId, orgId: input.orgId, dealId: deal.id, type: "follow_up", title: `Outreach: ${org.name} · ${input.title}`.slice(0, 200), dueAt: new Date(now.getTime() + 3 * 86_400_000).toISOString() });
  await db.update(beCompanyProfiles).set({ relationshipStatus: "contacted", engagementStage: "partnership opportunity", updatedAt: now.toISOString() }).where(and(eq(beCompanyProfiles.orgId, input.orgId), eq(beCompanyProfiles.mandateId, input.mandateId), eq(beCompanyProfiles.relationshipStatus, "none")));
  await audit(db, { actor, action: "built_partnership_create", entity: "be_opportunities", entityId: opp.id, after: { dealId: deal.id, orgId: input.orgId } });
  return { opportunity: opp, dealId: deal.id };
}

/** §11 Open an RFI from a recommendation: a procurement package on the project with the providers invited. */
export async function rfiFromMatch(db: Db, matchId: string, actor: string, now = new Date()) {
  const [m] = await db.select().from(beMatches).where(eq(beMatches.id, matchId));
  if (!m) throw new Error("Recommendation not found");
  const category = m.category === "energy" ? "equipment" : m.category === "materials" ? "supply" : m.category === "digital" ? "services" : m.category === "design" ? "consultancy" : "civil";
  const [pkg] = await db.insert(procurementPackages).values({ projectId: m.projectId, mandateId: m.mandateId, name: `RFI · ${m.label}`.slice(0, 200), category: category as never, scope: `${m.label}. Why: ${m.reason}. Stage fit: ${m.stageFit}.`, stage: "rfi", bidsDueAt: new Date(now.getTime() + 21 * 86_400_000).toISOString().slice(0, 10), owner: actor }).returning();
  const provs = m.providerOrgIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, m.providerOrgIds.slice(0, 50))) : [];
  for (const o of provs) await db.insert(bids).values({ packageId: pkg.id, projectId: m.projectId, mandateId: m.mandateId, orgId: o.id, bidder: o.name, status: "invited" });
  await db.update(beMatches).set({ status: "shortlisted", updatedAt: now.toISOString() }).where(eq(beMatches.id, matchId));
  await audit(db, { actor, action: "built_rfi_create", entity: "procurement_packages", entityId: pkg.id, after: { matchId, invited: provs.length } });
  return pkg;
}

/** §14 Capital graph rows: company → investors, and investor → portfolio (from profiles). */
export async function capitalGraph(db: Db, mandateIds: string[]) {
  if (!mandateIds.length) return { edges: [], investors: [] };
  const profs = await db.select({ p: beCompanyProfiles, name: organizations.name }).from(beCompanyProfiles).innerJoin(organizations, eq(organizations.id, beCompanyProfiles.orgId)).where(inArray(beCompanyProfiles.mandateId, mandateIds));
  const invIds = [...new Set(profs.flatMap(x => x.p.investorOrgIds))];
  const inv = invIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, invIds.slice(0, 90))) : [];
  const invName = new Map(inv.map(i => [i.id, i.name]));
  const edges = profs.flatMap(x => [...x.p.investorOrgIds.map(i => ({ investorId: i as string | null, investor: invName.get(i) ?? "Investor", companyId: x.p.orgId, company: x.name, round: x.p.latestRound, stage: x.p.fundingStage })), ...x.p.investorNames.map(n => ({ investorId: null as string | null, investor: n, companyId: x.p.orgId, company: x.name, round: x.p.latestRound, stage: x.p.fundingStage }))]);
  const investors = [...new Set(edges.map(e => e.investor))].map(n => ({ name: n, id: edges.find(e => e.investor === n)?.investorId ?? null, portfolio: edges.filter(e => e.investor === n).map(e => ({ id: e.companyId, name: e.company })) }));
  return { edges, investors };
}

/** §17, §27 Overview counts and Command items. */
export async function builtOverview(db: Db, mandateIds: string[], today = new Date().toISOString().slice(0, 10)) {
  if (!mandateIds.length) return null;
  const inM = (c: Parameters<typeof inArray>[0]) => inArray(c, mandateIds);
  const since = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);
  const [[c], [t], [m], [pm], [op], [sg], rfps, supplierPending] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(beCompanyProfiles).where(inM(beCompanyProfiles.mandateId)),
    db.select({ n: sql<number>`count(*)` }).from(beTechnologies).where(inM(beTechnologies.mandateId)),
    db.select({ n: sql<number>`count(*)` }).from(beMaterials).where(inM(beMaterials.mandateId)),
    db.select({ n: sql<number>`count(distinct ${beMatches.projectId} || ':' || ${beMatches.label})` }).from(beMatches).where(and(inM(beMatches.mandateId), sql`${beMatches.status} <> 'rejected'`)),
    db.select({ n: sql<number>`count(*)`, active: sql<number>`sum(case when ${beOpportunities.status} not in ('closed_lost','agreement') then 1 else 0 end)`, capital: sql<number>`sum(case when ${beOpportunities.kinds} like '%capital%' or ${beOpportunities.kinds} like '%investor%' then 1 else 0 end)` }).from(beOpportunities).where(inM(beOpportunities.mandateId)),
    db.select({ n: sql<number>`count(*)` }).from(beSignals).where(and(inM(beSignals.mandateId), gte(beSignals.date, since))),
    db.select({ id: procurementPackages.id, name: procurementPackages.name, projectId: procurementPackages.projectId, due: procurementPackages.bidsDueAt, stage: procurementPackages.stage }).from(procurementPackages)
      .where(and(inM(procurementPackages.mandateId), inArray(procurementPackages.stage, ["rfi", "rfp", "bids", "clarification", "evaluation"]))).orderBy(procurementPackages.bidsDueAt),
    db.select({ n: sql<number>`count(*)` }).from(networkProfiles).where(and(inM(networkProfiles.mandateId), inArray(networkProfiles.approvedStatus, ["not_assessed", "in_review"]))),
  ]);
  return { companies: c?.n ?? 0, technologies: t?.n ?? 0, materials: m?.n ?? 0, matches: pm?.n ?? 0, partnerships: op?.active ?? 0, capitalOpps: op?.capital ?? 0, signals30: sg?.n ?? 0, rfps, activeRfps: rfps.filter(r => r.stage === "rfp" || r.stage === "rfi").length, suppliersToQualify: supplierPending[0]?.n ?? 0 };
}

export async function builtCommand(db: Db, mandateIds: string[], today = new Date().toISOString().slice(0, 10)) {
  if (!mandateIds.length) return [];
  const in30 = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10), weekAgo = new Date(Date.parse(today) - 14 * 86_400_000).toISOString().slice(0, 10);
  const [sigs, rfps, matches] = await Promise.all([
    db.select({ s: beSignals, org: organizations.name }).from(beSignals).leftJoin(organizations, eq(organizations.id, beSignals.orgId)).where(and(inArray(beSignals.mandateId, mandateIds), gte(beSignals.date, weekAgo), eq(beSignals.importance, "high"))).orderBy(desc(beSignals.date)).limit(6),
    db.select({ id: procurementPackages.id, name: procurementPackages.name, projectId: procurementPackages.projectId, due: procurementPackages.bidsDueAt, project: projects.name }).from(procurementPackages).innerJoin(projects, eq(projects.id, procurementPackages.projectId))
      .where(and(inArray(procurementPackages.mandateId, mandateIds), inArray(procurementPackages.stage, ["rfi", "rfp", "bids", "clarification"]), gte(procurementPackages.bidsDueAt, today), lte(procurementPackages.bidsDueAt, in30))).limit(6),
    db.select({ projectId: beMatches.projectId, project: projects.name, n: sql<number>`count(*)` }).from(beMatches).innerJoin(projects, eq(projects.id, beMatches.projectId)).where(and(inArray(beMatches.mandateId, mandateIds), gte(beMatches.runAt, `${weekAgo}T00:00:00Z`), isNull(projects.archivedAt))).groupBy(beMatches.projectId, projects.name).limit(6),
  ]);
  return [
    ...sigs.map(x => ({ key: `bes:${x.s.id}`, kind: "Signal", text: `${x.org ?? x.s.entity}: ${x.s.summary}`, why: x.s.why, href: "/intelligence/built?tab=signals" })),
    ...rfps.map(x => ({ key: `ber:${x.id}`, kind: "RFP", text: `${x.project}: ${x.name} closes ${x.due}`, why: "Supplier responses due", href: `/projects/${x.projectId}?tab=procurement&pkg=${x.id}` })),
    ...matches.map(x => ({ key: `bem:${x.projectId}`, kind: "Matches", text: `${x.project}: ${x.n} new solution recommendations`, why: "Built environment intelligence ran", href: `/projects/${x.projectId}?tab=built` })),
  ];
}
