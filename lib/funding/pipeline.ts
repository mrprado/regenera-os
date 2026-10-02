// Funding origination engine, database part (docs/plans/phase-11-funding-origination.md). Opportunity → applicant
// prospect (a CRM organization, deduplicated) → client opportunity (an engagement with entry point "funding") →
// discovery → paid diagnostic → bid / no-bid → application (consortium, workplan, reviews, human-approved submission) →
// award → post-award program and the project's capital stack. Every step writes an audit row; nothing is sent or
// submitted without a person.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { currentCall } from "./queries";
import type { Db } from "@/db";
import {
  activities, allocations, applicationTasks, bidReviews, capitalStackLayers, capitalStructures, consortiumMembers, contacts, engagements, expansionOpportunities,
  fundingApplications, fundingAwards, fundingDates, fundingOpportunities, fundingPathways, fundingProspects, fundingReadiness, messages, orgRegistrations, organizations,
  projects, services, tasks, teamMembers,
} from "@/db/schema";
import type { ApplicantProfile, FundingDetails } from "@/db/funding";
import { audit } from "@/lib/audit";
import { createEngagement, ensureServices } from "@/lib/commercial/engine";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { validateMessage } from "@/lib/style/validate";
import { bidOnOpportunity } from "./engine";
import { addDays, blankReadiness, consortiumGaps, deliveryEconomics, inferredProfile, kindOf, layerForKind, pathwaySourceForKind, profileMatch, timingCell, type Cell, type CostLine } from "./origination";
import { APPLICATION_ORDER, PROSPECT_ORDER, promiseIssues, WORKPLAN_TEMPLATE, type ApplicationState, type BidDecision, type ProspectStage } from "./vocab";

type Opp = typeof fundingOpportunities.$inferSelect;
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
/** A human approver: an email, not a system / AI identity. */
export const isHuman = (actor: string) => /@/.test(actor) && !/^(ai|claude|system|mcp|job)[:@]/i.test(actor);

async function opp(db: Db, id: string): Promise<Opp> {
  const [o] = await db.select().from(fundingOpportunities).where(eq(fundingOpportunities.id, id));
  if (!o) throw new Error("Opportunity not found");
  return o;
}

// ---------- opportunity data, provenance, verification ----------
export type DetailPatch = Partial<Pick<Opp, "kind" | "opportunityCode" | "rolling" | "awardPeriod" | "programSize" | "expectedAward" | "numberAwards" | "matchRequirement" | "reimbursement" | "eligibleCosts" | "prohibitedCosts" | "owner" | "nextAction" | "nextActionDate" | "projectId" | "territory" | "openDate" | "amountMin" | "amountMax" | "currency" | "cofinancingPct">> & { details?: FundingDetails };

/** Parsed and manual fields. The original call text (description) is never overwritten here. */
export async function saveDetails(db: Db, id: string, patch: DetailPatch, actor: string, verify = false) {
  const o = await opp(db, id);
  const details = patch.details ? { ...o.details, ...patch.details } : o.details;
  await db.update(fundingOpportunities).set({ ...patch, details, ...(verify ? { verifiedBy: actor, verifiedAt: nowIso() } : {}), updatedAt: nowIso() }).where(eq(fundingOpportunities.id, id));
  await audit(db, { actor, action: verify ? "funding_verified" : "funding_details", entity: "funding_opportunities", entityId: id, after: patch });
}

/** §6 Ideal applicant profile. From call metadata (basis "inferred") unless an AI read of the call text is supplied. */
export async function buildProfile(db: Db, id: string, actor: string, fromCall?: Omit<ApplicantProfile, "basis" | "generatedBy" | "generatedAt">) {
  const o = await opp(db, id);
  const p: ApplicantProfile = fromCall ? { ...fromCall, basis: "call_text", generatedBy: actor, generatedAt: nowIso(), reviewedBy: null } : inferredProfile(o, actor);
  await db.update(fundingOpportunities).set({ applicantProfile: p, updatedAt: nowIso() }).where(eq(fundingOpportunities.id, id));
  await audit(db, { actor, action: "funding_profile", entity: "funding_opportunities", entityId: id, after: { basis: p.basis } });
  return p;
}

export async function reviewProfile(db: Db, id: string, actor: string) {
  const o = await opp(db, id);
  if (!o.applicantProfile) throw new Error("No profile to review");
  await db.update(fundingOpportunities).set({ applicantProfile: { ...o.applicantProfile, reviewedBy: actor }, updatedAt: nowIso() }).where(eq(fundingOpportunities.id, id));
}

// ---------- §7 find applicants (CRM) ----------
export async function applicantCandidates(db: Db, id: string, limit = 60) {
  const o = await opp(db, id);
  const profile = o.applicantProfile ?? inferredProfile(o, "system:preview");
  const orgs = await db.select({ id: organizations.id, name: organizations.name, country: organizations.country, location: organizations.location, sector: organizations.sector, industry: organizations.industry, description: organizations.description })
    .from(organizations).where(and(eq(organizations.mandateId, o.mandateId), isNull(organizations.archivedAt))).limit(3000);
  const existing = new Set((await db.select({ orgId: fundingProspects.orgId }).from(fundingProspects).where(eq(fundingProspects.opportunityId, id))).map(r => r.orgId));
  const scored = orgs.map(org => ({ org, m: profileMatch(profile, org) }))
    .filter(x => x.m.classMatch !== "mismatch" && x.m.geo !== "mismatch" && x.m.sector !== "mismatch" && (x.m.classMatch === "match" || x.m.geo === "match" || x.m.sector === "match"))
    .sort((a, b) => ["classMatch", "geo", "sector"].reduce((n, k) => n + (b.m[k as "geo"] === "match" ? 1 : 0) - (a.m[k as "geo"] === "match" ? 1 : 0), 0)).slice(0, limit);
  const ids = scored.map(s => s.org.id);
  const [last, dms, engs] = ids.length ? await Promise.all([
    db.select({ orgId: activities.orgId, at: sql<string>`max(${activities.occurredAt})` }).from(activities).where(inArray(activities.orgId, ids.slice(0, 90))).groupBy(activities.orgId),
    db.select({ id: contacts.id, orgId: contacts.orgId, name: contacts.fullName, title: contacts.title }).from(contacts).where(and(inArray(contacts.orgId, ids.slice(0, 90)), eq(contacts.suppressed, false))),
    db.select({ orgId: engagements.orgId, owner: engagements.owner, status: engagements.status }).from(engagements).where(inArray(engagements.orgId, ids.slice(0, 90))),
  ]) : [[], [], []];
  const titles = profile.decisionMakerTitles.map(t => t.toLowerCase().split(/[\s/]+/)[0]);
  return scored.map(({ org, m }) => {
    const people = dms.filter(d => d.orgId === org.id);
    const dm = people.find(p => p.title && titles.some(t => p.title!.toLowerCase().includes(t))) ?? null;
    const eng = engs.find(e => e.orgId === org.id);
    return {
      org, match: m, alreadyProspect: existing.has(org.id), lastInteraction: last.find(l => l.orgId === org.id)?.at ?? null,
      relationship: eng ? `Client (${eng.status})` : people.length ? "Known contacts" : "In CRM, no contact", owner: eng?.owner ?? null, decisionMaker: dm,
      rationale: [m.classMatch === "match" && `type fits (${m.orgClasses.join(", ")})`, m.geo === "match" && "in eligible geography", m.sector === "match" && "sector fits"].filter(Boolean).join("; "),
      missing: [...m.missing, dm ? null : "Decision-maker"].filter((x): x is string => !!x),
    };
  });
}

// ---------- §8 add as prospect (dedupe; creates or links the client opportunity) ----------
export async function findOrCreateOrg(db: Db, mandateId: string, input: { name: string; website?: string | null; country?: string | null }, actor: string) {
  const norm = normalizeOrgName(input.name);
  const domain = input.website ? input.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null;
  const [hit] = await db.select({ id: organizations.id }).from(organizations)
    .where(and(eq(organizations.mandateId, mandateId), domain ? sql`(${organizations.domain} = ${domain} or ${organizations.nameNormalized} = ${norm})` : eq(organizations.nameNormalized, norm))).limit(1);
  if (hit) return { id: hit.id, created: false };
  const [row] = await db.insert(organizations).values({ mandateId, name: input.name.trim(), nameNormalized: norm, domain, website: input.website ?? null, country: input.country ?? null, source: "procurement" }).returning({ id: organizations.id });
  await audit(db, { actor, action: "org_create", entity: "organizations", entityId: row.id, after: { name: input.name, via: "funding_prospect" } });
  return { id: row.id, created: true };
}

export async function addProspect(db: Db, input: { opportunityId: string; orgId: string; origin?: "crm" | "external"; mode?: "funding_first" | "client_first" | "stack_first"; eligibility?: string; eligibilityBasis?: string; rationale?: string; source?: string; sourceUrl?: string | null; decisionMakerId?: string | null; projectId?: string | null; missing?: string[] }, actor: string) {
  const o = await opp(db, input.opportunityId);
  const [existing] = await db.select().from(fundingProspects).where(and(eq(fundingProspects.opportunityId, o.id), eq(fundingProspects.orgId, input.orgId)));
  if (existing) return { prospect: existing, created: false };
  if (input.eligibility === "confirmed" && !input.eligibilityBasis?.trim()) throw new Error("Confirmed eligibility needs its basis (call clause or funder answer).");
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, input.orgId));
  // The client opportunity: reuse an open engagement for this org and call, else a Lead with entry point "funding".
  const [eng] = await db.select({ id: engagements.id }).from(engagements).where(and(eq(engagements.orgId, input.orgId), eq(engagements.originOpportunityId, o.id), ne(engagements.status, "lost")));
  const engagementId = eng?.id ?? (await (async () => {
    const e = await createEngagement(db, { mandateId: o.mandateId, name: `Funding pathway · ${org?.name ?? "Applicant"} · ${o.title.slice(0, 60)}`, orgId: input.orgId, projectId: input.projectId ?? null, serviceIds: [], fee: 0, source: "funding" }, actor);
    await db.update(engagements).set({ entryPoint: "funding", originOpportunityId: o.id, fundingLine: "diagnostic", engagementType: "diagnostic", revenueCategory: "diagnostic" }).where(eq(engagements.id, e.id));
    return e.id;
  })());
  const [p] = await db.insert(fundingProspects).values({
    mandateId: o.mandateId, opportunityId: o.id, orgId: input.orgId, origin: input.origin ?? "crm", mode: input.mode ?? "funding_first", eligibility: input.eligibility ?? "uncertain",
    eligibilityBasis: input.eligibilityBasis ?? "", rationale: input.rationale ?? "", source: input.source ?? (input.origin === "external" ? "manual research" : "CRM"), sourceUrl: input.sourceUrl ?? null,
    decisionMakerId: input.decisionMakerId ?? null, projectId: input.projectId ?? null, missing: input.missing ?? [], owner: actor, engagementId,
  }).returning();
  await db.insert(activities).values({ mandateId: o.mandateId, orgId: input.orgId, type: "note", detail: `Added as a funding prospect for "${o.title.slice(0, 120)}"`, source: "manual", actor });
  if (o.decision === "new") await db.update(fundingOpportunities).set({ decision: "matched", updatedAt: nowIso() }).where(eq(fundingOpportunities.id, o.id));
  await audit(db, { actor, action: "funding_prospect_add", entity: "funding_prospects", entityId: p.id, after: { orgId: input.orgId, opportunityId: o.id, engagementId } });
  return { prospect: p, created: true };
}

const ENGAGEMENT_FOR_STAGE: Partial<Record<ProspectStage, string>> = { discovery: "discovery", qualified: "qualified", diagnostic_proposed: "proposal", diagnostic_won: "contracting", engagement: "active", lost: "lost" };

export async function setProspectStage(db: Db, id: string, stage: ProspectStage, actor: string, opts: { lostReason?: string; followUpDate?: string | null } = {}) {
  if (!PROSPECT_ORDER.includes(stage)) throw new Error("Unknown stage");
  const [p] = await db.select().from(fundingProspects).where(eq(fundingProspects.id, id));
  if (!p) throw new Error("Prospect not found");
  if (stage === "lost" && !opts.lostReason?.trim()) throw new Error("Say why it was lost.");
  await db.update(fundingProspects).set({ stage, lostReason: opts.lostReason ?? p.lostReason, followUpDate: opts.followUpDate !== undefined ? opts.followUpDate : p.followUpDate, updatedAt: nowIso() }).where(eq(fundingProspects.id, id));
  const es = ENGAGEMENT_FOR_STAGE[stage];
  if (es && p.engagementId) await db.update(engagements).set({ status: es as never, lostReason: stage === "lost" ? opts.lostReason ?? null : undefined, updatedAt: nowIso() }).where(eq(engagements.id, p.engagementId));
  await db.insert(activities).values({ mandateId: p.mandateId, orgId: p.orgId, type: "stage_change", detail: `Funding prospect: ${p.stage} → ${stage}${opts.lostReason ? ` (${opts.lostReason})` : ""}`, source: "manual", actor });
  await audit(db, { actor, action: "funding_prospect_stage", entity: "funding_prospects", entityId: id, before: { stage: p.stage }, after: { stage } });
}

export async function updateProspect(db: Db, id: string, patch: Partial<Pick<typeof fundingProspects.$inferSelect, "eligibility" | "eligibilityBasis" | "decisionMakerId" | "rationale" | "followUpDate" | "projectId" | "researchBrief" | "owner">>, actor: string) {
  if (patch.eligibility === "confirmed" && !patch.eligibilityBasis?.trim()) throw new Error("Confirmed eligibility needs its basis.");
  await db.update(fundingProspects).set({ ...patch, updatedAt: nowIso() }).where(eq(fundingProspects.id, id));
  await audit(db, { actor, action: "funding_prospect_update", entity: "funding_prospects", entityId: id, after: patch });
}

/** §9 Research brief assembled from records (no invented facts): what is known, what is missing. */
export async function researchBrief(db: Db, id: string, actor: string) {
  const [p] = await db.select().from(fundingProspects).where(eq(fundingProspects.id, id));
  if (!p) throw new Error("Prospect not found");
  const o = await opp(db, p.opportunityId);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, p.orgId));
  const people = await db.select({ name: contacts.fullName, title: contacts.title }).from(contacts).where(and(eq(contacts.orgId, p.orgId), eq(contacts.suppressed, false))).limit(8);
  const acts = await db.select({ at: activities.occurredAt, detail: activities.detail }).from(activities).where(eq(activities.orgId, p.orgId)).orderBy(desc(activities.occurredAt)).limit(5);
  const profile = o.applicantProfile ?? inferredProfile(o, actor);
  const m = profileMatch(profile, org);
  const lines = [
    `# ${org.name}: research brief for "${o.title}"`,
    `Funder: ${o.funder ?? "not stated"} · deadline ${o.deadline ?? "not stated"} · ${o.url}`,
    `## What the records say`, `- Location: ${[org.location, org.country].filter(Boolean).join(", ") || "not recorded"}`, `- Sector: ${org.sector ?? "not recorded"}; industry: ${org.industry ?? "not recorded"}`,
    `- Description: ${org.description?.slice(0, 400) || "none recorded"}`, `- People on record: ${people.map(x => `${x.name}${x.title ? ` (${x.title})` : ""}`).join("; ") || "none"}`,
    `- Recent interactions: ${acts.map(a => `${a.at.slice(0, 10)} ${a.detail.slice(0, 80)}`).join(" | ") || "none"}`,
    `## Against the ideal applicant profile (${profile.basis === "call_text" ? "from the call text" : "inferred from metadata"})`,
    `- Organization type: ${m.classMatch}${m.orgClasses.length ? ` (${m.orgClasses.join(", ")})` : ""}`, `- Geography: ${m.geo}`, `- Sector: ${m.sector}`,
    `- Eligibility on record: ${p.eligibility}${p.eligibilityBasis ? ` (basis: ${p.eligibilityBasis})` : " (no basis recorded)"}`,
    `## Missing before contact`, ...[...m.missing, p.decisionMakerId ? null : "Decision-maker", "Current programs or projects that fit the call", "Match / co-finance capacity"].filter(Boolean).map(x => `- ${x}`),
    `## Suggested titles to reach`, `- ${profile.decisionMakerTitles.join(", ") || "Not inferred"}`,
  ].join("\n");
  await db.update(fundingProspects).set({ researchBrief: lines, stage: p.stage === "target" ? "researched" : p.stage, updatedAt: nowIso() }).where(eq(fundingProspects.id, id));
  await audit(db, { actor, action: "funding_prospect_brief", entity: "funding_prospects", entityId: id });
  return lines;
}

/** §9–10 Personalized outreach into the approval queue. Positioning: pathway, eligibility, readiness, strategy. */
export function outreachText(input: { first: string; orgName: string; title: string; funder: string | null; deadline: string | null }) {
  const subject = `${input.funder ?? "A funding program"} and ${input.orgName}`;
  const body = `${input.first}, we identified a funding pathway that appears aligned with ${input.orgName}'s current work: "${input.title.slice(0, 140)}"${input.funder ? ` from ${input.funder}` : ""}${input.deadline ? `, closing ${input.deadline}` : ""}. Regenera can assess eligibility, project readiness and application strategy, and how this program would sit alongside your other capital. Would a short call to test fit be useful?`;
  return { subject, body };
}

export async function draftOutreach(db: Db, id: string, actor: string) {
  const [p] = await db.select().from(fundingProspects).where(eq(fundingProspects.id, id));
  if (!p) throw new Error("Prospect not found");
  const o = await opp(db, p.opportunityId);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId));
  const cs = await db.select().from(contacts).where(and(eq(contacts.orgId, p.orgId), eq(contacts.suppressed, false))).limit(20);
  const c = cs.find(x => x.id === p.decisionMakerId && x.emailLower) ?? cs.find(x => x.emailLower);
  if (!c) return { ok: false as const, text: `${org?.name ?? "This organization"} has no contact with an email address. Add the decision-maker first.` };
  const { subject, body } = outreachText({ first: c.firstName || c.fullName.split(" ")[0], orgName: org?.name ?? "your organization", title: o.title, funder: o.funder, deadline: o.deadline });
  const issues = [...validateMessage({ subject, body }, { firstTouch: true, advisory: true }), ...promiseIssues(`${subject} ${body}`).map(detail => ({ rule: "promise", detail }))];
  await db.insert(messages).values({
    mandateId: p.mandateId, contactId: c.id, channel: "email", direction: "out", mailboxRole: "primary", toEmail: c.emailLower!, subject, body,
    status: issues.length ? "style_failed" : "pending_approval", tier: "targeted", angleTag: "funding", scheduledAt: nowIso(), styleIssues: issues.length ? issues as never : null,
  });
  await db.update(fundingProspects).set({ decisionMakerId: p.decisionMakerId ?? c.id, stage: PROSPECT_ORDER.indexOf(p.stage as ProspectStage) < PROSPECT_ORDER.indexOf("contact_ready") ? "contact_ready" : p.stage, updatedAt: nowIso() }).where(eq(fundingProspects.id, id));
  await audit(db, { actor, action: "funding_outreach_draft", entity: "funding_prospects", entityId: id, after: { contactId: c.id } });
  return { ok: true as const, text: `Draft to ${c.fullName} is in the approval queue. Nothing is sent until you approve it.` };
}

/** Logged outreach / follow-up / discovery meeting (a task; calendar invites stay manual). */
export async function logTouch(db: Db, id: string, kind: "outreach" | "follow_up" | "discovery", actor: string, input: { note?: string; date?: string | null }) {
  const [p] = await db.select().from(fundingProspects).where(eq(fundingProspects.id, id));
  if (!p) throw new Error("Prospect not found");
  const o = await opp(db, p.opportunityId);
  if (kind === "outreach") {
    await db.insert(activities).values({ mandateId: p.mandateId, orgId: p.orgId, contactId: p.decisionMakerId, type: "email", detail: `Funding outreach logged: ${input.note ?? o.title.slice(0, 100)}`, source: "manual", actor });
    if (PROSPECT_ORDER.indexOf(p.stage as ProspectStage) < PROSPECT_ORDER.indexOf("contacted")) await setProspectStage(db, id, "contacted", actor);
  } else {
    const due = input.date ?? addDays(today(), kind === "discovery" ? 5 : 7);
    await db.insert(tasks).values({ mandateId: p.mandateId, orgId: p.orgId, contactId: p.decisionMakerId, type: kind === "discovery" ? "meeting_notes" : "follow_up", title: kind === "discovery" ? `Discovery meeting: ${o.title.slice(0, 80)}` : `Follow up: ${o.title.slice(0, 80)}`, body: input.note ?? "", dueAt: `${due}T15:00:00.000Z` });
    await db.update(fundingProspects).set({ followUpDate: due, updatedAt: nowIso() }).where(eq(fundingProspects.id, id));
    if (kind === "discovery") await setProspectStage(db, id, "discovery", actor);
  }
}

/** §13 Diagnostic proposal: the engagement gets the Funding readiness diagnostic service at its planning price. */
export async function proposeDiagnostic(db: Db, id: string, actor: string, fee?: number) {
  const [p] = await db.select().from(fundingProspects).where(eq(fundingProspects.id, id));
  if (!p?.engagementId) throw new Error("Prospect has no client opportunity");
  await ensureServices(db, p.mandateId);
  const [svc] = await db.select().from(services).where(and(eq(services.mandateId, p.mandateId), eq(services.key, "funding_diagnostic")));
  const price = fee ?? svc?.listPrice ?? 7500;
  await db.update(engagements).set({
    fee: price, workstreams: svc ? [svc.key] : [], fundingLine: "diagnostic", feeBasis: "fixed", revenueCategory: "diagnostic", expectedHours: svc?.expectedHours ?? 30,
    scope: svc ? `${svc.name}: ${svc.deliverables.join(", ")}` : "Funding readiness diagnostic", deliverables: (svc?.deliverables ?? []).map(label => ({ id: crypto.randomUUID().slice(0, 8), label, status: "not_started", due: null, serviceKey: "funding_diagnostic" })),
    paymentSchedule: [{ id: crypto.randomUUID().slice(0, 8), label: "Diagnostic fee", amount: price, due: null }], updatedAt: nowIso(),
  }).where(eq(engagements.id, p.engagementId));
  await setProspectStage(db, id, "diagnostic_proposed", actor);
  return p.engagementId;
}

// ---------- §11 readiness ----------
export async function saveReadiness(db: Db, input: { opportunityId: string; orgId?: string | null; projectId?: string | null; prospectId?: string | null; cells: Record<string, Cell> }, actor: string) {
  const o = await opp(db, input.opportunityId);
  const cells = { ...blankReadiness(), ...input.cells };
  if (cells.timing.status === "unknown") cells.timing = timingCell(o.deadline, today());
  const [existing] = await db.select({ id: fundingReadiness.id }).from(fundingReadiness)
    .where(and(eq(fundingReadiness.opportunityId, o.id), input.prospectId ? eq(fundingReadiness.prospectId, input.prospectId) : isNull(fundingReadiness.prospectId)));
  if (existing) await db.update(fundingReadiness).set({ cells, assessedBy: actor, updatedAt: nowIso() }).where(eq(fundingReadiness.id, existing.id));
  else await db.insert(fundingReadiness).values({ mandateId: o.mandateId, opportunityId: o.id, orgId: input.orgId ?? null, projectId: input.projectId ?? null, prospectId: input.prospectId ?? null, cells, assessedBy: actor });
  await audit(db, { actor, action: "funding_readiness", entity: "funding_readiness", entityId: existing?.id ?? o.id });
}

// ---------- §12 bid / no-bid ----------
export const SENIOR_APPROVAL_FEE = 25_000;

export async function saveBidReview(db: Db, input: { id?: string; opportunityId: string; prospectId?: string | null; applicantOrgId?: string | null; strategicFit: string; eligibility: string; readinessSummary: string; hours: number; specialists: string[]; fee: number; feeBasis: string; costLines: CostLine[]; otherCost: number; relationshipValue: string; crossSell: string; risks: string; opportunityCost: string; currency?: string }, actor: string) {
  const o = await opp(db, input.opportunityId);
  const econ = deliveryEconomics({ fee: input.fee, lines: input.costLines, otherCost: input.otherCost });
  const values = {
    mandateId: o.mandateId, opportunityId: o.id, prospectId: input.prospectId ?? null, applicantOrgId: input.applicantOrgId ?? null, strategicFit: input.strategicFit, eligibility: input.eligibility,
    readinessSummary: input.readinessSummary, deadline: o.deadline, hours: input.hours || econ.hours, specialists: input.specialists, fee: input.fee, feeBasis: input.feeBasis, deliveryCost: econ.cost,
    costLines: input.costLines, relationshipValue: input.relationshipValue, crossSell: input.crossSell, risks: input.risks, opportunityCost: input.opportunityCost, currency: input.currency ?? "USD",
    seniorApprovalRequired: input.fee >= SENIOR_APPROVAL_FEE, updatedAt: nowIso(),
  };
  const id = input.id ?? (await db.insert(bidReviews).values(values).returning({ id: bidReviews.id }))[0].id;
  if (input.id) await db.update(bidReviews).set(values).where(eq(bidReviews.id, input.id));
  await audit(db, { actor, action: "bid_review_save", entity: "bid_reviews", entityId: id, after: { fee: input.fee, cost: econ.cost, margin: econ.grossMarginPct } });
  return id;
}

export async function decideBid(db: Db, id: string, decision: BidDecision, actor: string, conditions = "") {
  const [b] = await db.select().from(bidReviews).where(eq(bidReviews.id, id));
  if (!b) throw new Error("Review not found");
  if (!isHuman(actor)) throw new Error("A person decides bid / no-bid.");
  if (decision === "bid_conditions" && !conditions.trim()) throw new Error("State the conditions.");
  if ((decision === "bid" || decision === "bid_conditions") && b.seniorApprovalRequired && !b.approvedBy) throw new Error(`Engagements from ${SENIOR_APPROVAL_FEE.toLocaleString("en-US")} need senior approval before Bid.`);
  await db.update(bidReviews).set({ decision, conditions, decidedBy: actor, decidedAt: nowIso(), updatedAt: nowIso() }).where(eq(bidReviews.id, id));
  const d = decision === "no_bid" ? "dismissed" : decision === "watch" ? "watching" : "bidding";
  await db.update(fundingOpportunities).set({ decision: d, dismissReason: decision === "no_bid" ? `No bid: ${b.risks || conditions || "see review"}`.slice(0, 300) : null, updatedAt: nowIso() }).where(eq(fundingOpportunities.id, b.opportunityId));
  await audit(db, { actor, action: "bid_decision", entity: "bid_reviews", entityId: id, after: { decision, conditions } });
}

export async function seniorApprove(db: Db, id: string, actor: string) {
  const [b] = await db.select().from(bidReviews).where(eq(bidReviews.id, id));
  if (!b) throw new Error("Review not found");
  if (!isHuman(actor)) throw new Error("A person approves.");
  await db.update(bidReviews).set({ approvedBy: actor, updatedAt: nowIso() }).where(eq(bidReviews.id, id));
  await audit(db, { actor, action: "bid_senior_approve", entity: "bid_reviews", entityId: id });
}

// ---------- §20–25 applications ----------
export async function createApplication(db: Db, input: { opportunityId: string; leadOrgId?: string | null; projectId?: string | null; engagementId?: string | null; bidReviewId?: string | null; owner?: string | null }, actor: string, now = new Date()) {
  const o = await opp(db, input.opportunityId);
  if (input.bidReviewId) {
    const [b] = await db.select({ decision: bidReviews.decision }).from(bidReviews).where(eq(bidReviews.id, input.bidReviewId));
    if (!b || !["bid", "bid_conditions"].includes(b.decision ?? "")) throw new Error("The bid / no-bid review has not decided Bid.");
  }
  if (!o.dealId) await bidOnOpportunity(db, o.id, actor, now);
  const [fresh] = await db.select({ dealId: fundingOpportunities.dealId }).from(fundingOpportunities).where(eq(fundingOpportunities.id, o.id));
  const [lead] = input.leadOrgId ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, input.leadOrgId)) : [];
  const deadline = o.deadline ?? addDays(now.toISOString().slice(0, 10), 45);
  const [a] = await db.insert(fundingApplications).values({
    mandateId: o.mandateId, opportunityId: o.id, name: `${lead?.name ?? "Regenera"} · ${o.title.slice(0, 80)}`, leadOrgId: input.leadOrgId ?? null, projectId: input.projectId ?? o.projectId ?? null,
    engagementId: input.engagementId ?? null, dealId: fresh?.dealId ?? null, bidReviewId: input.bidReviewId ?? null, owner: input.owner ?? actor, currency: o.currency ?? "USD",
    scoring: (o.details.objectives?.scoring ?? []).map(c => ({ criterion: c, weight: "", response: "", evidence: "" })),
    compliance: [...(o.details.application?.compliance ?? []), ...(o.details.application?.forms ?? []), ...(o.details.eligibility?.registrations ?? [])].map(item => ({ item, status: "open", note: "" })),
    internalDeadline: addDays(deadline, -2),
  }).returning();
  const floor = addDays(now.toISOString().slice(0, 10), 1);
  const ids: string[] = [];
  for (const [i, t] of WORKPLAN_TEMPLATE.entries()) {
    const due = addDays(deadline, -Math.round(t.offsetDays * Math.min(1, Math.max(0.25, (Date.parse(deadline) - now.getTime()) / (40 * 86_400_000)))));
    const [row] = await db.insert(applicationTasks).values({ mandateId: o.mandateId, applicationId: a.id, tab: t.tab, title: t.title, role: t.role, due: due < floor ? floor : due, dependsOn: t.dependsOn !== undefined ? ids[t.dependsOn] : null, hoursBudget: t.hours, sortOrder: i }).returning({ id: applicationTasks.id });
    ids.push(row.id);
  }
  for (const [kind, date] of [["draft", addDays(deadline, -10)], ["review", addDays(deadline, -5)], ["deadline", deadline]] as const)
    await db.insert(fundingDates).values({ mandateId: o.mandateId, opportunityId: o.id, applicationId: a.id, kind, date, internal: kind !== "deadline", label: kind === "deadline" ? "Funder deadline" : "" });
  if (input.leadOrgId) await db.insert(consortiumMembers).values({ mandateId: o.mandateId, applicationId: a.id, orgId: input.leadOrgId, name: lead?.name ?? "Lead applicant", role: "lead", status: "confirmed" });
  await audit(db, { actor, action: "funding_application_create", entity: "funding_applications", entityId: a.id, after: { opportunityId: o.id } });
  return a;
}

export async function addMember(db: Db, applicationId: string, input: { orgId?: string | null; name: string; role: string; capability?: string; contribution?: string; budget?: number | null; documents?: string[]; contactId?: string | null; owner?: string | null; eligibility?: string }, actor: string) {
  const [a] = await db.select({ mandateId: fundingApplications.mandateId }).from(fundingApplications).where(eq(fundingApplications.id, applicationId));
  if (!a) throw new Error("Application not found");
  const [m] = await db.insert(consortiumMembers).values({ mandateId: a.mandateId, applicationId, orgId: input.orgId ?? null, name: input.name, role: input.role, capability: input.capability ?? "", contribution: input.contribution ?? "", budget: input.budget ?? null, documents: input.documents ?? [], contactId: input.contactId ?? null, owner: input.owner ?? actor, eligibility: input.eligibility ?? "uncertain" }).returning();
  await audit(db, { actor, action: "consortium_add", entity: "consortium_members", entityId: m.id, after: { name: input.name, role: input.role } });
  return m;
}

export async function applicationGaps(db: Db, applicationId: string) {
  const [a] = await db.select().from(fundingApplications).where(eq(fundingApplications.id, applicationId));
  const o = await opp(db, a.opportunityId);
  const members = await db.select().from(consortiumMembers).where(eq(consortiumMembers.applicationId, applicationId));
  const required = o.details.requiredPartners?.length ? o.details.requiredPartners : o.applicantProfile?.requiredPartners ?? [];
  return consortiumGaps(["Eligible lead applicant", ...required], members.map(m => ({ role: m.role, name: m.name, status: m.status, capability: m.capability })).map(m => (m.role === "lead" ? { ...m, capability: `${m.capability} eligible lead applicant` } : m)));
}

/** §24 Review states move forward one step at a time (or back to First draft). Approval is a human; submission is recorded by a human. */
export async function advanceApplication(db: Db, id: string, to: ApplicationState, actor: string, note = "", submission?: Record<string, string>) {
  const [a] = await db.select().from(fundingApplications).where(eq(fundingApplications.id, id));
  if (!a) throw new Error("Application not found");
  const from = APPLICATION_ORDER.indexOf(a.state as ApplicationState), target = APPLICATION_ORDER.indexOf(to);
  const terminal = ["unsuccessful", "withdrawn"].includes(to);
  if (!terminal && to !== "first_draft" && target !== from + 1) throw new Error("Move one review step at a time.");
  if (to === "approved") {
    if (!isHuman(actor)) throw new Error("Approval for submission is a person's decision.");
    const openTasks = await db.select({ n: sql<number>`count(*)` }).from(applicationTasks).where(and(eq(applicationTasks.applicationId, id), ne(applicationTasks.status, "done"), ne(applicationTasks.title, "Submission")));
    if ((openTasks[0]?.n ?? 0) > 0) throw new Error("Finish the workplan (except submission) before approving.");
  }
  if (to === "submitted") {
    if (a.state !== "approved" || !a.approvedBy) throw new Error("Only an application approved for submission can be recorded as submitted.");
    if (!isHuman(actor)) throw new Error("Submission is recorded by the person who submitted.");
    if (!submission?.confirmationId?.trim() && !submission?.portal?.trim()) throw new Error("Record the portal and confirmation ID.");
  }
  await db.update(fundingApplications).set({
    state: to, reviewLog: [...a.reviewLog, { state: to, by: actor, at: nowIso(), note }],
    ...(to === "approved" ? { approvedBy: actor, approvedAt: nowIso() } : {}),
    ...(to === "submitted" ? { submission: { ...a.submission, ...submission, at: submission?.at || nowIso(), submittedBy: actor } } : {}), updatedAt: nowIso(),
  }).where(eq(fundingApplications.id, id));
  if (to === "submitted") await db.update(applicationTasks).set({ status: "done", updatedAt: nowIso() }).where(and(eq(applicationTasks.applicationId, id), eq(applicationTasks.title, "Submission")));
  await audit(db, { actor, action: "funding_application_state", entity: "funding_applications", entityId: id, before: { state: a.state }, after: { state: to, note } });
}

// ---------- §26–28 award, post-award, capital stack ----------
export async function recordAward(db: Db, applicationId: string, input: { amount: number; currency?: string; agreementRef?: string; periodStart?: string | null; periodEnd?: string | null; reporting?: { label: string; due: string | null }[]; milestones?: { label: string; due: string | null }[]; conditions?: string; cofinance?: string; postAward?: boolean; monthlyFee?: number }, actor: string) {
  const [a] = await db.select().from(fundingApplications).where(eq(fundingApplications.id, applicationId));
  if (!a) throw new Error("Application not found");
  if (a.state !== "submitted") throw new Error("Record the submission before the award.");
  if (!isHuman(actor)) throw new Error("A person records the award.");
  const o = await opp(db, a.opportunityId);
  const [award] = await db.insert(fundingAwards).values({
    mandateId: a.mandateId, applicationId, amount: input.amount, currency: input.currency ?? a.currency, agreementRef: input.agreementRef ?? "", periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null,
    reporting: (input.reporting ?? []).map(r => ({ ...r, done: false })), milestones: (input.milestones ?? []).map(r => ({ ...r, done: false })), conditions: input.conditions ?? "", cofinance: input.cofinance ?? "",
  }).returning();
  for (const r of input.reporting ?? []) if (r.due) await db.insert(fundingDates).values({ mandateId: a.mandateId, opportunityId: o.id, applicationId, awardId: award.id, kind: "reporting", date: r.due, label: r.label });
  await db.update(fundingApplications).set({ state: "awarded", reviewLog: [...a.reviewLog, { state: "awarded", by: actor, at: nowIso(), note: `Award ${input.amount} ${input.currency ?? a.currency}` }], updatedAt: nowIso() }).where(eq(fundingApplications.id, applicationId));
  // Capital stack: the award becomes an approved funding pathway on the project (added to a structure separately, once).
  let pathwayId: string | null = null;
  if (a.projectId) {
    const { kind } = kindOf(o);
    const [pw] = await db.insert(fundingPathways).values({ projectId: a.projectId, mandateId: a.mandateId, name: o.title.slice(0, 120), sourceType: pathwaySourceForKind(kind) as never, provider: o.funder ?? "", fundingOpportunityId: o.id, amount: input.amount, currency: input.currency ?? a.currency, status: "approved", eligibility: "confirmed", eligibilitySource: `Award ${input.agreementRef ?? ""}`.trim(), owner: actor }).returning({ id: fundingPathways.id });
    pathwayId = pw.id;
  }
  let engagementId: string | null = null;
  if (input.postAward && a.leadOrgId) {
    await ensureServices(db, a.mandateId);
    const [svc] = await db.select({ id: services.id }).from(services).where(and(eq(services.mandateId, a.mandateId), eq(services.key, "post_award_support")));
    const e = await createEngagement(db, { mandateId: a.mandateId, name: `Post-award program · ${a.name.slice(0, 80)}`, orgId: a.leadOrgId, projectId: a.projectId, serviceIds: svc ? [svc.id] : [], monthlyFee: input.monthlyFee ?? null, source: "funding award" }, actor);
    await db.update(engagements).set({ fundingLine: "post_award", revenueCategory: "retainer", originOpportunityId: o.id, feeBasis: "retainer", deliverables: [...(input.milestones ?? []).map(m => ({ id: crypto.randomUUID().slice(0, 8), label: m.label, status: "not_started", due: m.due })), ...(input.reporting ?? []).map(m => ({ id: crypto.randomUUID().slice(0, 8), label: `Report: ${m.label}`, status: "not_started", due: m.due }))] }).where(eq(engagements.id, e.id));
    engagementId = e.id;
  }
  await db.update(fundingAwards).set({ pathwayId, postAwardEngagementId: engagementId }).where(eq(fundingAwards.id, award.id));
  await audit(db, { actor, action: "funding_award", entity: "funding_awards", entityId: award.id, after: { amount: input.amount, pathwayId, engagementId } });
  return { award, pathwayId, engagementId };
}

/** §28 Add a pathway to a capital structure once. Returns the layer id; a second call is a no-op. */
export async function pathwayToStack(db: Db, pathwayId: string, structureId: string, actor: string) {
  const [p] = await db.select().from(fundingPathways).where(eq(fundingPathways.id, pathwayId));
  if (!p) throw new Error("Pathway not found");
  if (p.structureLayerId) {
    const [l] = await db.select({ id: capitalStackLayers.id }).from(capitalStackLayers).where(eq(capitalStackLayers.id, p.structureLayerId));
    if (l) return { layerId: l.id, added: false };
  }
  const [s] = await db.select().from(capitalStructures).where(eq(capitalStructures.id, structureId));
  if (!s || s.projectId !== p.projectId) throw new Error("Structure is not for this project");
  const o = p.fundingOpportunityId ? await opp(db, p.fundingOpportunityId).catch(() => null) : null;
  const layer = o ? layerForKind(kindOf(o).kind) : ({ grant: "grant", dfi: "dfi_capital", concessional: "blended_finance", blended: "blended_finance", tax_incentive: "grant", foundation: "grant", government: "grant", eca: "eca_finance", green_bond: "green_bond" } as Record<string, string>)[p.sourceType] ?? "grant";
  const [row] = await db.insert(capitalStackLayers).values({ structureId, mandateId: p.mandateId, layer: layer as never, provider: p.provider, currency: p.currency, amount: p.amount, status: p.status === "approved" ? "committed" : "assumption", source: `Funding pathway: ${p.name}`, assumptionStatus: p.status === "approved" ? "confirmed" : "assumption", sortOrder: 50 }).returning({ id: capitalStackLayers.id });
  await db.update(fundingPathways).set({ structureLayerId: row.id, updatedAt: nowIso() }).where(eq(fundingPathways.id, pathwayId));
  await audit(db, { actor, action: "pathway_to_stack", entity: "capital_stack_layers", entityId: row.id, after: { pathwayId, structureId } });
  return { layerId: row.id, added: true };
}

/** A prospective call becomes a project funding pathway (client-first / stack-first). */
export async function opportunityToPathway(db: Db, opportunityId: string, projectId: string, actor: string) {
  const o = await opp(db, opportunityId);
  const [p] = await db.select({ id: projects.id, mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  if (!p || p.mandateId !== o.mandateId) throw new Error("Project not found");
  const [dup] = await db.select({ id: fundingPathways.id }).from(fundingPathways).where(and(eq(fundingPathways.projectId, projectId), eq(fundingPathways.fundingOpportunityId, o.id)));
  if (dup) return { id: dup.id, created: false };
  const [row] = await db.insert(fundingPathways).values({ projectId, mandateId: o.mandateId, name: o.title.slice(0, 120), sourceType: pathwaySourceForKind(kindOf(o).kind) as never, provider: o.funder ?? "", fundingOpportunityId: o.id, amount: o.expectedAward ?? o.amountMax ?? null, currency: o.currency ?? "USD", status: "identified", eligibility: "unknown", deadline: o.deadline, owner: actor }).returning({ id: fundingPathways.id });
  await audit(db, { actor, action: "opportunity_to_pathway", entity: "funding_pathways", entityId: row.id, after: { opportunityId, projectId } });
  return { id: row.id, created: true };
}

// ---------- §56–57 client-first and project funding match ----------
export async function fundingForOrg(db: Db, orgId: string, limit = 25) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return [];
  const today = new Date().toISOString().slice(0, 10);
  const opps = await db.select().from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, org.mandateId), currentCall(today), ne(fundingOpportunities.decision, "dismissed"))).orderBy(asc(fundingOpportunities.deadline)).limit(400);
  const pros = await db.select().from(fundingProspects).where(eq(fundingProspects.orgId, orgId));
  return opps.map(o => {
    const m = profileMatch(o.applicantProfile ?? inferredProfile(o, "system:preview"), org);
    const p = pros.find(x => x.opportunityId === o.id);
    const label: "confirmed" | "potential" | "review" = p?.eligibility === "confirmed" ? "confirmed" : m.classMatch === "match" && m.geo !== "mismatch" ? "potential" : "review";
    return { o, m, p, label };
  // A suggestion needs no mismatch AND confirmed geography AND a second confirmed fit (sector or applicant type):
  // one keyword-level overlap was surfacing loosely related calls.
  }).filter(x => x.p || (x.m.classMatch !== "mismatch" && x.m.geo !== "mismatch" && x.m.sector !== "mismatch" && x.m.geo === "match" && (x.m.sector === "match" || x.m.classMatch === "match"))).slice(0, limit);
}

export async function fundingForProject(db: Db, projectId: string, limit = 25) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return [];
  const today = new Date().toISOString().slice(0, 10);
  const opps = await db.select().from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, p.mandateId), currentCall(today), ne(fundingOpportunities.decision, "dismissed"))).orderBy(asc(fundingOpportunities.deadline)).limit(400);
  const place = `${p.country ?? ""} ${p.subdivision ?? ""}`.toLowerCase();
  const sector = p.sector;
  return opps.filter(o => {
    const c = o.countries ?? [];
    const specificGeo = c.some(x => (place && place.includes(x.toLowerCase())) || (p.country && x.toLowerCase().includes(p.country.toLowerCase())));
    const geo = !c.length || specificGeo || c.some(x => /global|worldwide/i.test(x));
    const specificSector = !!sector && (o.sectors ?? []).includes(sector);
    const sec = !sector || !(o.sectors ?? []).length || specificSector;
    // At least one specific confirmation (the project's country or sector named by the call); "global" alone is not a fit.
    return geo && sec && (specificGeo || specificSector);
  }).slice(0, limit).map(o => ({ o, kind: kindOf(o) }));
}

// ---------- §29 expansion ----------
export async function addExpansion(db: Db, input: { mandateId: string; orgId: string; kind: string; relevance: string; engagementId?: string | null; applicationId?: string | null; estimatedValue?: number | null }, actor: string) {
  if (input.relevance.trim().length < 12) throw new Error("Say why it is relevant to this client (evidence, not a pitch).");
  const [row] = await db.insert(expansionOpportunities).values({ ...input, owner: actor }).returning({ id: expansionOpportunities.id });
  await audit(db, { actor, action: "expansion_add", entity: "expansion_opportunities", entityId: row.id, after: { kind: input.kind } });
  return row.id;
}

// ---------- §17 registrations ----------
export async function setRegistration(db: Db, input: { mandateId: string; orgId: string; kind: string; status: "unknown" | "missing" | "in_progress" | "active" | "expired"; reference?: string; expires?: string | null; evidence?: string }, actor: string) {
  await db.insert(orgRegistrations).values({ ...input, reference: input.reference ?? "", evidence: input.evidence ?? "" })
    .onConflictDoUpdate({ target: [orgRegistrations.orgId, orgRegistrations.kind], set: { status: input.status, reference: input.reference ?? "", expires: input.expires ?? null, evidence: input.evidence ?? "", updatedAt: nowIso() } });
  await audit(db, { actor, action: "registration_set", entity: "org_registrations", entityId: input.orgId, after: { kind: input.kind, status: input.status } });
}

// ---------- §40 capacity data ----------
export async function capacityData(db: Db, mandateIds: string[], weeks: string[]) {
  if (!mandateIds.length) return { members: [], allocs: [] };
  const members = await db.select().from(teamMembers).where(and(inArray(teamMembers.mandateId, mandateIds), eq(teamMembers.active, true))).orderBy(asc(teamMembers.name));
  const allocs = weeks.length ? await db.select().from(allocations).where(and(inArray(allocations.mandateId, mandateIds), inArray(allocations.weekStart, weeks))) : [];
  return { members, allocs };
}
