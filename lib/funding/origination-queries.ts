// Read models for funding origination screens and the Command funding section. Every query is workspace-scoped.
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray, sql } from "drizzle-orm";
import {
  applicationTasks, bidReviews, consortiumMembers, contacts, engagements, expansionOpportunities, fundingApplications, fundingAwards, fundingDates, fundingOpportunities, fundingProspects,
  fundingReadiness, messages, organizations, projects,
} from "@/db/schema";
import { appDb, mandateCondition, type Scope, type UserScope } from "@/lib/db/scoped";
import { addDays, capacityWarnings, funnel, mondayOf, originatedValue } from "./origination";
import { capacityData } from "./pipeline";

const today = () => new Date().toISOString().slice(0, 10);

export async function prospectsFor(scope: Scope, opportunityId: string) {
  return appDb().select({ p: fundingProspects, orgName: organizations.name, country: organizations.country, dm: contacts.fullName, dmTitle: contacts.title })
    .from(fundingProspects).innerJoin(organizations, eq(organizations.id, fundingProspects.orgId)).leftJoin(contacts, eq(contacts.id, fundingProspects.decisionMakerId))
    .where(and(eq(fundingProspects.opportunityId, opportunityId), mandateCondition(scope, fundingProspects.mandateId))).orderBy(asc(organizations.name));
}

export async function allProspects(scope: Scope, stage?: string) {
  return appDb().select({ p: fundingProspects, orgName: organizations.name, title: fundingOpportunities.title, deadline: fundingOpportunities.deadline, fee: engagements.fee, engStatus: engagements.status })
    .from(fundingProspects).innerJoin(organizations, eq(organizations.id, fundingProspects.orgId)).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingProspects.opportunityId))
    .leftJoin(engagements, eq(engagements.id, fundingProspects.engagementId))
    .where(and(mandateCondition(scope, fundingProspects.mandateId), stage ? eq(fundingProspects.stage, stage) : undefined)).orderBy(desc(fundingProspects.updatedAt)).limit(300);
}

export async function applicationsList(scope: Scope) {
  return appDb().select({ a: fundingApplications, title: fundingOpportunities.title, deadline: fundingOpportunities.deadline, funder: fundingOpportunities.funder, lead: organizations.name,
    open: sql<number>`(select count(*) from ${applicationTasks} t where t.application_id = ${fundingApplications.id} and t.status <> 'done')`,
    late: sql<number>`(select count(*) from ${applicationTasks} t where t.application_id = ${fundingApplications.id} and t.status <> 'done' and t.due < ${today()})`,
    hoursBudget: sql<number>`(select coalesce(sum(t.hours_budget), 0) from ${applicationTasks} t where t.application_id = ${fundingApplications.id})`,
    hoursActual: sql<number>`(select coalesce(sum(t.hours_actual), 0) from ${applicationTasks} t where t.application_id = ${fundingApplications.id})` })
    .from(fundingApplications).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingApplications.opportunityId)).leftJoin(organizations, eq(organizations.id, fundingApplications.leadOrgId))
    .where(mandateCondition(scope, fundingApplications.mandateId)).orderBy(asc(fundingOpportunities.deadline)).limit(200);
}

export async function loadApplication(scope: Scope, id: string) {
  const [row] = await appDb().select({ a: fundingApplications, o: fundingOpportunities }).from(fundingApplications).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingApplications.opportunityId))
    .where(and(eq(fundingApplications.id, id), mandateCondition(scope, fundingApplications.mandateId)));
  if (!row) return null;
  const [taskRows, members, award, review, lead, project, eng, dates] = await Promise.all([
    appDb().select().from(applicationTasks).where(eq(applicationTasks.applicationId, id)).orderBy(asc(applicationTasks.sortOrder)),
    appDb().select({ m: consortiumMembers, contact: contacts.fullName }).from(consortiumMembers).leftJoin(contacts, eq(contacts.id, consortiumMembers.contactId)).where(eq(consortiumMembers.applicationId, id)).orderBy(asc(consortiumMembers.createdAt)),
    appDb().select().from(fundingAwards).where(eq(fundingAwards.applicationId, id)).then(r => r[0] ?? null),
    row.a.bidReviewId ? appDb().select().from(bidReviews).where(eq(bidReviews.id, row.a.bidReviewId)).then(r => r[0] ?? null) : null,
    row.a.leadOrgId ? appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, row.a.leadOrgId)).then(r => r[0] ?? null) : null,
    row.a.projectId ? appDb().select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, row.a.projectId)).then(r => r[0] ?? null) : null,
    row.a.engagementId ? appDb().select().from(engagements).where(eq(engagements.id, row.a.engagementId)).then(r => r[0] ?? null) : null,
    appDb().select().from(fundingDates).where(eq(fundingDates.applicationId, id)).orderBy(asc(fundingDates.date)),
  ]);
  return { ...row, tasks: taskRows, members, award, review, lead, project, eng, dates };
}

export async function awardsList(scope: Scope) {
  return appDb().select({ w: fundingAwards, name: fundingApplications.name, title: fundingOpportunities.title, funder: fundingOpportunities.funder, appId: fundingApplications.id, projectId: fundingApplications.projectId })
    .from(fundingAwards).innerJoin(fundingApplications, eq(fundingApplications.id, fundingAwards.applicationId)).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingApplications.opportunityId))
    .where(mandateCondition(scope, fundingAwards.mandateId)).orderBy(desc(fundingAwards.createdAt));
}

export async function calendarEvents(scope: Scope, from = today(), to = addDays(today(), 365)) {
  const [dates, deadlines] = await Promise.all([
    appDb().select({ d: fundingDates, title: fundingOpportunities.title }).from(fundingDates).leftJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingDates.opportunityId))
      .where(and(mandateCondition(scope, fundingDates.mandateId), gte(fundingDates.date, from), lte(fundingDates.date, to))),
    appDb().select({ id: fundingOpportunities.id, title: fundingOpportunities.title, deadline: fundingOpportunities.deadline, openDate: fundingOpportunities.openDate, funder: fundingOpportunities.funder, decision: fundingOpportunities.decision })
      .from(fundingOpportunities).where(and(mandateCondition(scope, fundingOpportunities.mandateId), ne(fundingOpportunities.status, "closed"), ne(fundingOpportunities.decision, "dismissed"), sql`(${fundingOpportunities.deadline} between ${from} and ${to} or ${fundingOpportunities.openDate} between ${from} and ${to})`)).limit(500),
  ]);
  const ev: { date: string; kind: string; internal: boolean; label: string; href: string }[] = [];
  const covered = new Set(dates.filter(x => x.d.kind === "deadline").map(x => x.d.opportunityId));
  for (const x of dates) ev.push({ date: x.d.date, kind: x.d.kind, internal: x.d.internal, label: `${x.d.label || ""}${x.d.label && x.title ? " · " : ""}${x.title ?? ""}`, href: x.d.applicationId ? `/funding/applications/${x.d.applicationId}` : x.d.opportunityId ? `/funding/${x.d.opportunityId}` : "/funding" });
  for (const o of deadlines) {
    if (o.deadline && o.deadline >= from && o.deadline <= to && !covered.has(o.id)) ev.push({ date: o.deadline, kind: "deadline", internal: false, label: o.title, href: `/funding/${o.id}` });
    if (o.openDate && o.openDate >= from && o.openDate <= to) ev.push({ date: o.openDate, kind: "opening", internal: false, label: o.title, href: `/funding/${o.id}` });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}

/** §46–48, §74 Funnel, origination pipeline and funding-originated revenue. */
export async function originationDashboard(scope: Scope) {
  const mc = (col: Parameters<typeof mandateCondition>[1]) => mandateCondition(scope, col);
  const [scanned, relevant, pros, outreach, apps, awards, engs, orgs] = await Promise.all([
    appDb().select({ n: sql<number>`count(*)` }).from(fundingOpportunities).where(mc(fundingOpportunities.mandateId)),
    appDb().select({ n: sql<number>`count(*)` }).from(fundingOpportunities).where(and(mc(fundingOpportunities.mandateId), ne(fundingOpportunities.decision, "dismissed"), sql`coalesce(${fundingOpportunities.route}, '') <> 'signal'`, sql`(${fundingOpportunities.readAt} is not null or ${fundingOpportunities.decision} <> 'new')`)),
    appDb().select({ stage: fundingProspects.stage, n: sql<number>`count(*)` }).from(fundingProspects).where(mc(fundingProspects.mandateId)).groupBy(fundingProspects.stage),
    appDb().select({ n: sql<number>`count(*)` }).from(messages).where(and(mc(messages.mandateId), eq(messages.angleTag, "funding"), eq(messages.status, "sent"))),
    appDb().select({ state: fundingApplications.state, n: sql<number>`count(*)` }).from(fundingApplications).where(mc(fundingApplications.mandateId)).groupBy(fundingApplications.state),
    appDb().select({ n: sql<number>`count(*)`, post: sql<number>`sum(case when ${fundingAwards.postAwardEngagementId} is not null then 1 else 0 end)` }).from(fundingAwards).where(mc(fundingAwards.mandateId)),
    appDb().select().from(engagements).where(and(mc(engagements.mandateId), isNotNull(engagements.orgId))),
    appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mc(organizations.mandateId), inArray(organizations.id, appDb().select({ id: fundingProspects.orgId }).from(fundingProspects)))),
  ]);
  const st = Object.fromEntries(pros.map(p => [p.stage, p.n])) as Record<string, number>;
  const atLeast = (...stages: string[]) => stages.reduce((a, s) => a + (st[s] ?? 0), 0);
  const ap = Object.fromEntries(apps.map(p => [p.state, p.n])) as Record<string, number>;
  const orig = originatedValue(engs);
  const osConv = orig.filter(o => (o.lines.subscription ?? 0) + (o.lines.os ?? 0) > 0).length;
  const steps = funnel([
    { key: "scanned", label: "Funding opportunities scanned", n: scanned[0]?.n ?? 0 },
    { key: "relevant", label: "Relevant opportunities", n: relevant[0]?.n ?? 0 },
    { key: "prospects", label: "Applicant prospects", n: pros.reduce((a, p) => a + p.n, 0) },
    { key: "outreach", label: "Outreach (sent)", n: outreach[0]?.n ?? 0 },
    { key: "responses", label: "Responses", n: atLeast("responded", "discovery", "qualified", "diagnostic_proposed", "diagnostic_won", "engagement") },
    { key: "discoveries", label: "Discoveries", n: atLeast("discovery", "qualified", "diagnostic_proposed", "diagnostic_won", "engagement") },
    { key: "diagnostics", label: "Diagnostics sold", n: atLeast("diagnostic_won", "engagement") },
    { key: "bids", label: "Bids launched", n: apps.reduce((a, p) => a + p.n, 0) },
    { key: "submitted", label: "Applications submitted", n: (ap.submitted ?? 0) + (ap.awarded ?? 0) + (ap.unsuccessful ?? 0) },
    { key: "awards", label: "Awards", n: awards[0]?.n ?? 0 },
    { key: "post_award", label: "Post-award engagements", n: awards[0]?.post ?? 0 },
    { key: "os", label: "OS conversions", n: osConv },
  ]);
  const name = new Map(orgs.map(o => [o.id, o.name]));
  const orgNames = orig.length ? await appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orig.map(o => o.orgId).slice(0, 90))) : [];
  for (const o of orgNames) name.set(o.id, o.name);
  return { steps, originated: orig.map(o => ({ ...o, name: name.get(o.orgId) ?? "—" })), originatedTotal: orig.reduce((a, o) => a + o.total, 0) };
}

export async function expansionsFor(scope: Scope, orgId?: string) {
  return appDb().select({ x: expansionOpportunities, orgName: organizations.name }).from(expansionOpportunities).innerJoin(organizations, eq(organizations.id, expansionOpportunities.orgId))
    .where(and(mandateCondition(scope, expansionOpportunities.mandateId), orgId ? eq(expansionOpportunities.orgId, orgId) : undefined)).orderBy(desc(expansionOpportunities.createdAt)).limit(100);
}

export async function readinessFor(scope: Scope, opportunityId: string) {
  return appDb().select().from(fundingReadiness).where(and(eq(fundingReadiness.opportunityId, opportunityId), mandateCondition(scope, fundingReadiness.mandateId)));
}

export async function bidReviewsFor(scope: Scope, opportunityId: string) {
  return appDb().select().from(bidReviews).where(and(eq(bidReviews.opportunityId, opportunityId), mandateCondition(scope, bidReviews.mandateId))).orderBy(desc(bidReviews.updatedAt));
}

/** §45 Command funding section (internal). Counts link to the screen that explains them. */
export async function fundingCommand(scope: UserScope) {
  const t = today(), in30 = addDays(t, 30), in14 = addDays(t, 14), weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const mc = (col: Parameters<typeof mandateCondition>[1]) => mandateCondition(scope, col);
  const live = ["first_draft", "technical_review", "commercial_review", "compliance_review", "senior_review", "client_review", "final_qa", "approved"];
  const [fresh, deadlines, apps, diag, pending, post, pipeline] = await Promise.all([
    appDb().select({ n: sql<number>`count(*)` }).from(fundingOpportunities).where(and(mc(fundingOpportunities.mandateId), gte(fundingOpportunities.createdAt, weekAgo), ne(fundingOpportunities.decision, "dismissed"), inArray(fundingOpportunities.route, ["regenera_bid", "client_support", "consortium"]))),
    appDb().select({ n: sql<number>`count(*)` }).from(fundingOpportunities).where(and(mc(fundingOpportunities.mandateId), ne(fundingOpportunities.status, "closed"), inArray(fundingOpportunities.decision, ["watching", "bidding", "matched"]), gte(fundingOpportunities.deadline, t), lte(fundingOpportunities.deadline, in30))),
    appDb().select({ id: fundingApplications.id, name: fundingApplications.name, state: fundingApplications.state, deadline: fundingOpportunities.deadline,
      late: sql<number>`(select count(*) from ${applicationTasks} x where x.application_id = ${fundingApplications.id} and x.status <> 'done' and x.due < ${t})`,
      gaps: sql<number>`(select count(*) from ${consortiumMembers} m where m.application_id = ${fundingApplications.id} and m.status in ('prospective','contacted','documents_pending'))` })
      .from(fundingApplications).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingApplications.opportunityId)).where(and(mc(fundingApplications.mandateId), inArray(fundingApplications.state, live))),
    appDb().select({ n: sql<number>`count(*)` }).from(engagements).where(and(mc(engagements.mandateId), eq(engagements.fundingLine, "diagnostic"), inArray(engagements.status, ["contracting", "active", "waiting_on_client"]))),
    appDb().select({ n: sql<number>`count(*)` }).from(fundingApplications).where(and(mc(fundingApplications.mandateId), eq(fundingApplications.state, "submitted"))),
    appDb().select({ n: sql<number>`count(*)` }).from(fundingAwards).where(and(mc(fundingAwards.mandateId), isNotNull(fundingAwards.postAwardEngagementId))),
    appDb().select({ fee: engagements.fee, monthly: engagements.monthlyFee, months: engagements.months, status: engagements.status, p: engagements.probabilityPct, currency: engagements.currency })
      .from(engagements).where(and(mc(engagements.mandateId), eq(engagements.entryPoint, "funding"), notInArray(engagements.status, ["lost", "complete", "closed", "active", "waiting_on_client", "on_hold"]))),
  ]);
  const weeks = [mondayOf(t), mondayOf(addDays(t, 7))];
  const cap = await capacityData(appDb(), scope.mandateIds, weeks);
  const deadlineList = apps.filter(a => a.deadline).map(a => ({ date: a.deadline!, label: a.name }));
  const warnings = capacityWarnings(cap.members.map(m => ({ ...m, leave: m.leave })), cap.allocs, weeks, deadlineList);
  const atRisk = apps.filter(a => (a.deadline && a.deadline <= in14 && ["first_draft", "technical_review"].includes(a.state)) || a.late > 0);
  const { STAGE_PROBABILITY } = await import("@/lib/commercial/vocab");
  const weighted = pipeline.reduce((a, e) => a + (e.fee + e.monthly * e.months) * ((e.p ?? STAGE_PROBABILITY[e.status as keyof typeof STAGE_PROBABILITY] ?? 10) / 100), 0);
  return {
    fresh: fresh[0]?.n ?? 0, deadlines30: deadlines[0]?.n ?? 0, activeBids: apps.length, diagnostics: diag[0]?.n ?? 0, awardsPending: pending[0]?.n ?? 0, postAward: post[0]?.n ?? 0,
    atRisk: atRisk.map(a => ({ id: a.id, name: a.name, why: [a.late ? `${a.late} workplan item(s) late` : null, a.deadline && a.deadline <= in14 && ["first_draft", "technical_review"].includes(a.state) ? `deadline ${a.deadline}, still in ${a.state.replace(/_/g, " ")}` : null, a.gaps ? `${a.gaps} partner(s) unconfirmed` : null].filter(Boolean).join("; ") })),
    capacity: warnings, pipelineWeighted: Math.round(weighted), pipelineCount: pipeline.length, pipelineCurrency: pipeline[0]?.currency ?? "USD", teamConfigured: cap.members.length > 0,
  };
}
