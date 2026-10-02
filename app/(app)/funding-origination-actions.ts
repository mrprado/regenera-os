"use server";

// Funding origination actions (phase 11). Every action re-loads its record through the user's workspace scope; rule
// violations (eligibility without a basis, AI approvals, out-of-order reviews) come back as a notice, not a crash.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  allocations, applicationTasks, bidLibrary, bidReviews, capitalStructures, consortiumMembers, fundingApplications, fundingDates, fundingOpportunities, fundingPathways, fundingProspects, funders,
  organizations, practiceScenarios, projects, specialists, teamMembers,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import {
  addExpansion, addMember, addProspect, advanceApplication, buildProfile, createApplication, decideBid, draftOutreach, findOrCreateOrg, logTouch, opportunityToPathway, pathwayToStack,
  proposeDiagnostic, recordAward, researchBrief, reviewProfile, saveBidReview, saveDetails, saveReadiness, seniorApprove, setProspectStage, setRegistration, updateProspect,
} from "@/lib/funding/pipeline";
import { mondayOf, SCENARIO_FIELDS, SCENARIO_TEMPLATES } from "@/lib/funding/origination";
import {
  APPLICANT_ELIGIBILITY, APPLICATION_STATES, BID_DECISIONS, CALENDAR_KINDS, CONSORTIUM_ROLES, CONSORTIUM_STATUSES, EMPLOYMENT, EXPANSION_KINDS, FEE_BASES, FUNDER_TYPES, FUNDING_KINDS,
  PROSPECT_STAGES, READINESS_DIMENSIONS, READINESS_STATES, REGISTRATIONS, SPECIALIST_BENCH, SPECIALIST_SOURCES, TASK_STATUSES, TEAM_ROLES, NDA_STATES, CONFLICT_STATES,
} from "@/lib/funding/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = Number(String(f.get(k) ?? "").replace(/[, ]/g, "")); return String(f.get(k) ?? "").trim() && Number.isFinite(v) ? v : null; };
const opt = (f: FormData, k: string) => zId.safeParse(f.get(k)).data ?? null;
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const list = (f: FormData, k: string) => str(f, k, 2000).split(/[,;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 40);
const back = (f: FormData, fallback: string) => z.string().startsWith("/").catch(fallback).parse(f.get("back") || fallback);
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const errText = (e: unknown) => (e instanceof z.ZodError ? "Check the form: a required field is missing or invalid." : e instanceof Error ? e.message : "Something went wrong.");
type Scope = Parameters<typeof mandateCondition>[0];

async function oppFor(scope: Scope, id: string) {
  const [o] = await appDb().select().from(fundingOpportunities).where(and(eq(fundingOpportunities.id, id), mandateCondition(scope, fundingOpportunities.mandateId)));
  if (!o) throw new Error("Opportunity not found");
  return o;
}
async function prospectFor(scope: Scope, id: string) {
  const [p] = await appDb().select().from(fundingProspects).where(and(eq(fundingProspects.id, id), mandateCondition(scope, fundingProspects.mandateId)));
  if (!p) throw new Error("Prospect not found");
  return p;
}
async function appFor(scope: Scope, id: string) {
  const [a] = await appDb().select().from(fundingApplications).where(and(eq(fundingApplications.id, id), mandateCondition(scope, fundingApplications.mandateId)));
  if (!a) throw new Error("Application not found");
  return a;
}
async function orgIn(scope: Scope, id: string | null) {
  if (!id) return null;
  const [o] = await appDb().select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, id), mandateCondition(scope, organizations.mandateId)));
  if (!o) throw new Error("Organization not found");
  return o.id;
}
async function projectIn(scope: Scope, id: string | null) {
  if (!id) return null;
  const [p] = await appDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p.id;
}

// ---------- opportunity ----------
export async function saveFundingDetailsAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Saved.";
  try {
    await withOsUser(async user => {
      await oppFor(user.scope, id);
      await saveDetails(appDb(), id, {
        kind: z.enum(keys(FUNDING_KINDS)).nullable().catch(null).parse(formData.get("kind") || null), opportunityCode: str(formData, "opportunityCode", 120) || null, rolling: formData.get("rolling") === "on",
        awardPeriod: str(formData, "awardPeriod", 120) || null, programSize: num(formData, "programSize"), expectedAward: num(formData, "expectedAward"), numberAwards: num(formData, "numberAwards"),
        matchRequirement: str(formData, "matchRequirement", 300) || null, reimbursement: str(formData, "reimbursement", 300) || null, eligibleCosts: str(formData, "eligibleCosts", 1000) || null,
        prohibitedCosts: str(formData, "prohibitedCosts", 1000) || null, owner: str(formData, "owner", 200) || null, nextAction: str(formData, "nextAction", 300) || null, nextActionDate: date(formData, "nextActionDate"),
        projectId: await projectIn(user.scope, opt(formData, "projectId")), territory: str(formData, "territory", 200) || null,
        details: {
          eligibility: { orgTypes: list(formData, "orgTypes"), maturity: str(formData, "maturity", 200) || undefined, registrations: list(formData, "registrations"), certifications: list(formData, "certifications"), notes: str(formData, "eligibilityNotes", 1000) || undefined },
          objectives: { priorities: list(formData, "priorities"), scoring: list(formData, "scoring"), outcomes: list(formData, "outcomes"), kpis: list(formData, "kpis"), targetPopulation: str(formData, "targetPopulation", 300) || undefined },
          application: { format: str(formData, "format", 200) || undefined, pageLimits: str(formData, "pageLimits", 200) || undefined, attachments: list(formData, "attachments"), forms: list(formData, "forms"), letters: list(formData, "letters"), compliance: list(formData, "compliance") },
          requiredPartners: list(formData, "requiredPartners"),
        },
      }, user.email, formData.get("verify") === "on");
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, `/funding/${id}?tab=eligibility`), msg));
}

export async function buildProfileAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Ideal applicant profile built from the call metadata. Review it against the call text.";
  try { await withOsUser(async user => { await oppFor(user.scope, id); await buildProfile(appDb(), id, user.email); }); } catch (e) { msg = errText(e); }
  redirect(note(`/funding/${id}?tab=profile`, msg));
}

export async function reviewProfileAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Profile marked reviewed.";
  try { await withOsUser(async user => { await oppFor(user.scope, id); await reviewProfile(appDb(), id, user.email); }); } catch (e) { msg = errText(e); }
  redirect(note(`/funding/${id}?tab=profile`, msg));
}

// ---------- prospects ----------
export async function addProspectAction(formData: FormData) {
  const opportunityId = zId.parse(formData.get("opportunityId"));
  let msg = "Added as a prospect. A client opportunity (Lead) was created in Engagements.";
  try {
    await withOsUser(async user => {
      await oppFor(user.scope, opportunityId);
      const orgId = (await orgIn(user.scope, zId.parse(formData.get("orgId"))))!;
      const r = await addProspect(appDb(), { opportunityId, orgId, origin: "crm", mode: z.enum(["funding_first", "client_first", "stack_first"]).catch("funding_first").parse(formData.get("mode")), eligibility: z.enum(keys(APPLICANT_ELIGIBILITY)).catch("uncertain").parse(formData.get("eligibility")), eligibilityBasis: str(formData, "eligibilityBasis", 500), rationale: str(formData, "rationale", 1000), decisionMakerId: opt(formData, "decisionMakerId"), projectId: await projectIn(user.scope, opt(formData, "projectId")), missing: list(formData, "missing") }, user.email);
      if (!r.created) msg = "Already a prospect for this call.";
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, `/funding/${opportunityId}?tab=applicants`), msg));
}

export async function addExternalProspectAction(formData: FormData) {
  const opportunityId = zId.parse(formData.get("opportunityId"));
  let msg = "Added. The organization was matched against the CRM first, so nothing is duplicated.";
  try {
    await withOsUser(async user => {
      const o = await oppFor(user.scope, opportunityId);
      const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
      const website = z.string().url().max(300).nullable().catch(null).parse(formData.get("website") || null);
      const org = await findOrCreateOrg(appDb(), o.mandateId, { name, website, country: str(formData, "country", 80) || null }, user.email);
      await addProspect(appDb(), { opportunityId, orgId: org.id, origin: "external", eligibility: z.enum(keys(APPLICANT_ELIGIBILITY)).catch("uncertain").parse(formData.get("eligibility")), eligibilityBasis: str(formData, "eligibilityBasis", 500), rationale: str(formData, "rationale", 1000), source: str(formData, "source", 200) || "public source", sourceUrl: z.string().url().max(1000).nullable().catch(null).parse(formData.get("sourceUrl") || null) }, user.email);
      if (!org.created) msg = "That organization was already in the CRM: linked, not duplicated.";
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/${opportunityId}?tab=applicants`, msg));
}

export async function prospectStageAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Stage updated.";
  try { await withOsUser(async user => { await prospectFor(user.scope, id); await setProspectStage(appDb(), id, z.enum(keys(PROSPECT_STAGES)).parse(formData.get("stage")), user.email, { lostReason: str(formData, "lostReason", 300) || undefined }); }); } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/funding?tab=applicants"), msg));
}

export async function prospectUpdateAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Saved.";
  try {
    await withOsUser(async user => {
      await prospectFor(user.scope, id);
      await updateProspect(appDb(), id, { eligibility: z.enum(keys(APPLICANT_ELIGIBILITY)).parse(formData.get("eligibility")), eligibilityBasis: str(formData, "eligibilityBasis", 500), decisionMakerId: opt(formData, "decisionMakerId"), followUpDate: date(formData, "followUpDate") }, user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/funding?tab=applicants"), msg));
}

export async function researchBriefAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Research brief assembled from the records. Gaps are listed, not filled in.";
  try { await withOsUser(async user => { await prospectFor(user.scope, id); await researchBrief(appDb(), id, user.email); }); } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/funding?tab=applicants"), msg));
}

export async function draftOutreachAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "";
  try { await withOsUser(async user => { await prospectFor(user.scope, id); msg = (await draftOutreach(appDb(), id, user.email)).text; }); } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/funding?tab=applicants"), msg));
}

export async function logTouchAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const kind = z.enum(["outreach", "follow_up", "discovery"]).parse(formData.get("kind"));
  let msg = kind === "outreach" ? "Outreach logged." : kind === "discovery" ? "Discovery meeting added to Tasks. Send the calendar invite yourself." : "Follow-up added to Tasks.";
  try { await withOsUser(async user => { await prospectFor(user.scope, id); await logTouch(appDb(), id, kind, user.email, { note: str(formData, "note", 500) || undefined, date: date(formData, "date") }); }); } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/funding?tab=applicants"), msg));
}

export async function proposeDiagnosticAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let engagementId = "", msg = "";
  try { await withOsUser(async user => { await prospectFor(user.scope, id); engagementId = await proposeDiagnostic(appDb(), id, user.email, num(formData, "fee") ?? undefined); }); } catch (e) { msg = errText(e); }
  redirect(engagementId ? note(`/commercial/engagements/${engagementId}`, "Funding readiness diagnostic proposed. Review scope and fee (planning price, editable) before sending the proposal.") : note(back(formData, "/funding?tab=applicants"), msg));
}

// ---------- readiness, bid / no-bid ----------
export async function saveFundingReadinessAction(formData: FormData) {
  const opportunityId = zId.parse(formData.get("opportunityId"));
  let msg = "Readiness saved.";
  try {
    await withOsUser(async user => {
      await oppFor(user.scope, opportunityId);
      const cells = Object.fromEntries(Object.keys(READINESS_DIMENSIONS).map(d => [d, { status: z.enum(keys(READINESS_STATES)).catch("unknown").parse(formData.get(`${d}_status`)), note: str(formData, `${d}_note`, 500), source: str(formData, `${d}_source`, 300) }]));
      const prospectId = opt(formData, "prospectId");
      const p = prospectId ? await prospectFor(user.scope, prospectId) : null;
      await saveReadiness(appDb(), { opportunityId, prospectId, orgId: p?.orgId ?? null, projectId: p?.projectId ?? null, cells }, user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, `/funding/${opportunityId}?tab=eligibility`), msg));
}

export async function saveBidReviewAction(formData: FormData) {
  const opportunityId = zId.parse(formData.get("opportunityId"));
  let msg = "Bid / no-bid review saved. The economics are shown before anyone decides.";
  try {
    await withOsUser(async user => {
      await oppFor(user.scope, opportunityId);
      const id = opt(formData, "id");
      if (id) { const [b] = await appDb().select({ id: bidReviews.id }).from(bidReviews).where(and(eq(bidReviews.id, id), mandateCondition(user.scope, bidReviews.mandateId))); if (!b) throw new Error("Review not found"); }
      const costLines = [0, 1, 2, 3, 4, 5, 6].map(i => ({ role: str(formData, `role_${i}`, 60), person: str(formData, `person_${i}`, 120) || undefined, hours: num(formData, `hours_${i}`) ?? 0, rate: num(formData, `rate_${i}`) ?? 0 })).filter(l => l.role && l.hours > 0);
      const prospectId = opt(formData, "prospectId");
      const p = prospectId ? await prospectFor(user.scope, prospectId) : null;
      await saveBidReview(appDb(), {
        id: id ?? undefined, opportunityId, prospectId, applicantOrgId: p?.orgId ?? null, strategicFit: str(formData, "strategicFit", 1000), eligibility: z.enum(keys(APPLICANT_ELIGIBILITY)).catch("uncertain").parse(formData.get("eligibility")),
        readinessSummary: str(formData, "readinessSummary", 500), hours: num(formData, "hours") ?? 0, specialists: list(formData, "specialists"), fee: num(formData, "fee") ?? 0,
        feeBasis: z.enum(keys(FEE_BASES)).catch("fixed").parse(formData.get("feeBasis")), costLines, otherCost: num(formData, "otherCost") ?? 0, relationshipValue: str(formData, "relationshipValue", 1000),
        crossSell: str(formData, "crossSell", 1000), risks: str(formData, "risks", 1000), opportunityCost: str(formData, "opportunityCost", 1000), currency: str(formData, "currency", 3) || "USD",
      }, user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/${opportunityId}?tab=application`, msg));
}

export async function decideBidAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let opp = "", msg = "Decision recorded.";
  try {
    await withOsUser(async user => {
      const [b] = await appDb().select().from(bidReviews).where(and(eq(bidReviews.id, id), mandateCondition(user.scope, bidReviews.mandateId)));
      if (!b) throw new Error("Review not found");
      opp = b.opportunityId;
      if (formData.get("senior") === "1") { await seniorApprove(appDb(), id, user.email); msg = "Senior approval recorded."; return; }
      await decideBid(appDb(), id, z.enum(keys(BID_DECISIONS)).parse(formData.get("decision")), user.email, str(formData, "conditions", 1000));
    });
  } catch (e) { msg = errText(e); }
  redirect(note(opp ? `/funding/${opp}?tab=application` : "/funding?tab=bids", msg));
}

// ---------- applications ----------
export async function createApplicationAction(formData: FormData) {
  const opportunityId = zId.parse(formData.get("opportunityId"));
  let id = "", msg = "";
  try {
    await withOsUser(async user => {
      await oppFor(user.scope, opportunityId);
      const engagementId = opt(formData, "engagementId");
      const a = await createApplication(appDb(), { opportunityId, leadOrgId: await orgIn(user.scope, opt(formData, "leadOrgId")), projectId: await projectIn(user.scope, opt(formData, "projectId")), engagementId, bidReviewId: opt(formData, "bidReviewId"), owner: str(formData, "owner", 200) || null }, user.email);
      id = a.id;
    });
  } catch (e) { msg = errText(e); }
  redirect(id ? note(`/funding/applications/${id}`, "Application workspace opened with a workplan planned back from the deadline. Assign owners.") : note(`/funding/${opportunityId}?tab=application`, msg));
}

export async function saveApplicationAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const tab = str(formData, "tab", 30) || "overview";
  let msg = "Saved.";
  try {
    await withOsUser(async user => {
      const a = await appFor(user.scope, id);
      const team = Object.keys(TEAM_ROLES).map(role => ({ role, person: str(formData, `team_${role}`, 200) })).filter(t => t.person);
      const scoring = a.scoring.map((s, i) => ({ ...s, response: formData.has(`score_${i}`) ? str(formData, `score_${i}`, 2000) : s.response, evidence: formData.has(`scoreEv_${i}`) ? str(formData, `scoreEv_${i}`, 500) : s.evidence }));
      const compliance = a.compliance.map((c, i) => ({ ...c, status: formData.has(`comp_${i}`) ? str(formData, `comp_${i}`, 20) || c.status : c.status }));
      const newItem = str(formData, "complianceNew", 200);
      const newCriterion = str(formData, "criterionNew", 300);
      await appDb().update(fundingApplications).set({
        ...(formData.has("owner") ? { owner: str(formData, "owner", 200) || null, team, requestedAmount: num(formData, "requestedAmount"), matchAmount: num(formData, "matchAmount"), internalDeadline: date(formData, "internalDeadline") } : {}),
        scoring: newCriterion ? [...scoring, { criterion: newCriterion, weight: str(formData, "weightNew", 40), response: "", evidence: "" }] : scoring,
        compliance: newItem ? [...compliance, { item: newItem, status: "open", note: "" }] : compliance, updatedAt: new Date().toISOString(),
      }).where(eq(fundingApplications.id, id));
      await audit(appDb(), { actor: user.email, action: "funding_application_update", entity: "funding_applications", entityId: id });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/applications/${id}?tab=${tab}`, msg));
}

export async function applicationTaskAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let appId = "", msg = "Workplan updated.";
  try {
    await withOsUser(async user => {
      const [t] = await appDb().select().from(applicationTasks).where(and(eq(applicationTasks.id, id), mandateCondition(user.scope, applicationTasks.mandateId)));
      if (!t) throw new Error("Task not found");
      appId = t.applicationId;
      await appDb().update(applicationTasks).set({ status: z.enum(keys(TASK_STATUSES)).catch(t.status as "todo").parse(formData.get("status")), owner: formData.has("owner") ? str(formData, "owner", 200) || null : t.owner, reviewer: formData.has("reviewer") ? str(formData, "reviewer", 200) || null : t.reviewer, due: date(formData, "due") ?? t.due, hoursActual: num(formData, "hoursActual") ?? t.hoursActual, hoursBudget: num(formData, "hoursBudget") ?? t.hoursBudget, updatedAt: new Date().toISOString() }).where(eq(applicationTasks.id, id));
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/applications/${appId}?tab=workplan`, msg));
}

export async function addMemberAction(formData: FormData) {
  const id = zId.parse(formData.get("applicationId"));
  let msg = "Added to the consortium.";
  try {
    await withOsUser(async user => {
      await appFor(user.scope, id);
      const orgId = await orgIn(user.scope, opt(formData, "orgId"));
      const [org] = orgId ? await appDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)) : [];
      await addMember(appDb(), id, { orgId, name: org?.name ?? z.string().trim().min(2).max(200).parse(formData.get("name")), role: z.enum(keys(CONSORTIUM_ROLES)).parse(formData.get("role")), capability: str(formData, "capability", 500), contribution: str(formData, "contribution", 500), budget: num(formData, "budget"), documents: list(formData, "documents"), owner: str(formData, "owner", 200) || null, eligibility: z.enum(keys(APPLICANT_ELIGIBILITY)).catch("uncertain").parse(formData.get("eligibility")) }, user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/applications/${id}?tab=consortium`, msg));
}

export async function memberStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let appId = "", msg = "Updated.";
  try {
    await withOsUser(async user => {
      const [m] = await appDb().select().from(consortiumMembers).where(and(eq(consortiumMembers.id, id), mandateCondition(user.scope, consortiumMembers.mandateId)));
      if (!m) throw new Error("Member not found");
      appId = m.applicationId;
      await appDb().update(consortiumMembers).set({ status: z.enum(keys(CONSORTIUM_STATUSES)).parse(formData.get("status")), updatedAt: new Date().toISOString() }).where(eq(consortiumMembers.id, id));
      await audit(appDb(), { actor: user.email, action: "consortium_status", entity: "consortium_members", entityId: id, after: { status: formData.get("status") } });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/applications/${appId}?tab=consortium`, msg));
}

export async function advanceApplicationAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Review state updated.";
  try {
    await withOsUser(async user => {
      await appFor(user.scope, id);
      await advanceApplication(appDb(), id, z.enum(keys(APPLICATION_STATES)).parse(formData.get("to")), user.email, str(formData, "note", 500),
        { portal: str(formData, "portal", 120), confirmationId: str(formData, "confirmationId", 120), finalVersion: str(formData, "finalVersion", 300), acknowledgment: str(formData, "acknowledgment", 300), expectedAwardDate: str(formData, "expectedAwardDate", 10), at: str(formData, "at", 30) });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/applications/${id}?tab=${formData.get("to") === "submitted" ? "submission" : "reviews"}`, msg));
}

export async function recordAwardAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Award recorded. It is now an approved funding pathway on the project; add it to a capital structure from there.";
  try {
    await withOsUser(async user => {
      await appFor(user.scope, id);
      const pairs = (k: string) => str(formData, k, 2000).split("\n").map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/); return m ? { label: m[2], due: m[1] } : { label: l, due: null }; });
      await recordAward(appDb(), id, { amount: z.number().positive().parse(num(formData, "amount")), currency: str(formData, "currency", 3) || undefined, agreementRef: str(formData, "agreementRef", 120), periodStart: date(formData, "periodStart"), periodEnd: date(formData, "periodEnd"), reporting: pairs("reporting"), milestones: pairs("milestones"), conditions: str(formData, "conditions", 2000), cofinance: str(formData, "cofinance", 500), postAward: formData.get("postAward") === "on", monthlyFee: num(formData, "monthlyFee") ?? undefined }, user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/applications/${id}?tab=submission`, msg));
}

export async function markUnsuccessfulAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Recorded.";
  try { await withOsUser(async user => { await appFor(user.scope, id); await advanceApplication(appDb(), id, z.enum(["unsuccessful", "withdrawn"]).parse(formData.get("to")), user.email, str(formData, "note", 500)); }); } catch (e) { msg = errText(e); }
  redirect(note(`/funding/applications/${id}?tab=submission`, msg));
}

// ---------- capital stack, pathways, expansion, registrations ----------
export async function pathwayToStackAction(formData: FormData) {
  const pathwayId = zId.parse(formData.get("pathwayId"));
  let projectId = "", msg = "";
  try {
    await withOsUser(async user => {
      const [p] = await appDb().select().from(fundingPathways).where(and(eq(fundingPathways.id, pathwayId), mandateCondition(user.scope, fundingPathways.mandateId)));
      if (!p) throw new Error("Pathway not found");
      projectId = p.projectId;
      const structureId = zId.parse(formData.get("structureId"));
      const [s] = await appDb().select({ id: capitalStructures.id }).from(capitalStructures).where(and(eq(capitalStructures.id, structureId), mandateCondition(user.scope, capitalStructures.mandateId)));
      if (!s) throw new Error("Structure not found");
      msg = (await pathwayToStack(appDb(), pathwayId, structureId, user.email)).added ? "Added to the capital structure as one layer." : "Already in the structure: not counted twice.";
    });
  } catch (e) { msg = errText(e); }
  redirect(note(projectId ? `/projects/${projectId}?tab=stack` : "/capital/funding-pathways", msg));
}

export async function opportunityToPathwayAction(formData: FormData) {
  const opportunityId = zId.parse(formData.get("opportunityId"));
  let projectId = "", msg = "";
  try {
    await withOsUser(async user => {
      await oppFor(user.scope, opportunityId);
      projectId = (await projectIn(user.scope, zId.parse(formData.get("projectId"))))!;
      msg = (await opportunityToPathway(appDb(), opportunityId, projectId, user.email)).created ? "Funding pathway started on the project. Eligibility is Not assessed until checked." : "This call is already a pathway on the project.";
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, projectId ? `/projects/${projectId}?tab=pathways` : `/funding/${opportunityId}`), msg));
}

export async function addExpansionAction(formData: FormData) {
  let msg = "Expansion opportunity recorded against the client.";
  const b = back(formData, "/funding?tab=origination");
  try {
    await withOsUser(async user => {
      const orgId = (await orgIn(user.scope, zId.parse(formData.get("orgId"))))!;
      const [org] = await appDb().select({ m: organizations.mandateId }).from(organizations).where(eq(organizations.id, orgId));
      await addExpansion(appDb(), { mandateId: org.m, orgId, kind: z.enum(keys(EXPANSION_KINDS)).parse(formData.get("kind")), relevance: str(formData, "relevance", 1000), engagementId: opt(formData, "engagementId"), applicationId: opt(formData, "applicationId"), estimatedValue: num(formData, "estimatedValue") }, user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(b, msg));
}

export async function setRegistrationAction(formData: FormData) {
  let msg = "Registration recorded.";
  const b = back(formData, "/funding");
  try {
    await withOsUser(async user => {
      const orgId = (await orgIn(user.scope, zId.parse(formData.get("orgId"))))!;
      const [org] = await appDb().select({ m: organizations.mandateId }).from(organizations).where(eq(organizations.id, orgId));
      await setRegistration(appDb(), { mandateId: org.m, orgId, kind: z.enum(keys(REGISTRATIONS)).parse(formData.get("kind")), status: z.enum(["unknown", "missing", "in_progress", "active", "expired"]).parse(formData.get("status")), reference: str(formData, "reference", 120), expires: date(formData, "expires"), evidence: str(formData, "evidence", 300) }, user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(b, msg));
}

// ---------- funders, calendar, library ----------
export async function saveFunderAction(formData: FormData) {
  let msg = "Funder saved.";
  try {
    await withOsUser(async user => {
      const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
      const v = { type: z.enum(keys(FUNDER_TYPES)).catch("other").parse(formData.get("type")), programs: list(formData, "programs"), sectors: list(formData, "sectors"), geography: list(formData, "geography"), applicantTypes: list(formData, "applicantTypes"), typicalAward: str(formData, "typicalAward", 200), history: str(formData, "history", 2000), notes: str(formData, "notes", 2000), updatedAt: new Date().toISOString() };
      await appDb().insert(funders).values({ mandateId: user.scope.mandateIds[0], name, ...v }).onConflictDoUpdate({ target: [funders.mandateId, funders.name], set: v });
      await audit(appDb(), { actor: user.email, action: "funder_save", entity: "funders", entityId: name });
    });
  } catch (e) { msg = errText(e); }
  redirect(note("/funding?tab=funders", msg));
}

export async function addFundingDateAction(formData: FormData) {
  let msg = "Date added to the calendar.";
  try {
    await withOsUser(async user => {
      const opportunityId = opt(formData, "opportunityId"), applicationId = opt(formData, "applicationId");
      const o = opportunityId ? await oppFor(user.scope, opportunityId) : null;
      const a = applicationId ? await appFor(user.scope, applicationId) : null;
      if (!o && !a) throw new Error("Pick an opportunity or application");
      const kind = z.enum(keys(CALENDAR_KINDS)).parse(formData.get("kind"));
      await appDb().insert(fundingDates).values({ mandateId: (o ?? a)!.mandateId, opportunityId: o?.id ?? a?.opportunityId ?? null, applicationId: a?.id ?? null, kind, date: zDate.parse(formData.get("date")), label: str(formData, "label", 200), internal: CALENDAR_KINDS[kind].internal });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/funding?tab=calendar"), msg));
}

export async function tagLibraryAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Library block updated.";
  try {
    await withOsUser(async user => {
      const [b] = await appDb().select().from(bidLibrary).where(and(eq(bidLibrary.id, id), mandateCondition(user.scope, bidLibrary.mandateId)));
      if (!b) throw new Error("Block not found");
      const approved = formData.get("approved") === "on";
      await appDb().update(bidLibrary).set({ sectors: list(formData, "sectors"), funder: str(formData, "funder", 200) || null, program: str(formData, "program", 200) || null, geography: str(formData, "geography", 200) || null, clientOrgId: await orgIn(user.scope, opt(formData, "clientOrgId")), approved, approvedBy: approved ? (b.approved ? b.approvedBy : user.email) : null, owner: str(formData, "owner", 200) || b.owner, updatedAt: new Date().toISOString() }).where(eq(bidLibrary.id, id));
    });
  } catch (e) { msg = errText(e); }
  redirect(note("/funding?tab=library", msg));
}

// ---------- team, capacity, specialists, scenarios (Regenera internal) ----------
export async function saveTeamMemberAction(formData: FormData) {
  let msg = "Saved.";
  try {
    await withOsUser(async user => {
      const id = opt(formData, "id");
      const v = { name: z.string().trim().min(2).max(120).parse(formData.get("name")), email: str(formData, "email", 200) || null, role: z.enum(keys(TEAM_ROLES)).parse(formData.get("role")), employment: z.enum(keys(EMPLOYMENT)).parse(formData.get("employment")), costRate: num(formData, "costRate"), salary: num(formData, "salary"), weeklyHours: num(formData, "weeklyHours") ?? 40, utilizationTarget: num(formData, "utilizationTarget") ?? 75, currency: str(formData, "currency", 3) || "USD", active: formData.get("active") !== "off", updatedAt: new Date().toISOString() };
      if (id) {
        const [m] = await appDb().select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.id, id), mandateCondition(user.scope, teamMembers.mandateId)));
        if (!m) throw new Error("Not found");
        await appDb().update(teamMembers).set(v).where(eq(teamMembers.id, id));
      } else await appDb().insert(teamMembers).values({ mandateId: user.scope.mandateIds[0], ...v });
      const leaveFrom = date(formData, "leaveFrom"), leaveTo = date(formData, "leaveTo");
      if (id && leaveFrom && leaveTo) { const [m] = await appDb().select({ leave: teamMembers.leave }).from(teamMembers).where(eq(teamMembers.id, id)); await appDb().update(teamMembers).set({ leave: [...m.leave, { from: leaveFrom, to: leaveTo, note: str(formData, "leaveNote", 120) }] }).where(eq(teamMembers.id, id)); }
      await audit(appDb(), { actor: user.email, action: "team_member_save", entity: "team_members", entityId: id ?? v.name });
    }, { internal: true });
  } catch (e) { msg = errText(e); }
  redirect(note("/capacity?tab=team", msg));
}

export async function saveAllocationAction(formData: FormData) {
  let msg = "Allocation saved.";
  try {
    await withOsUser(async user => {
      const memberId = zId.parse(formData.get("memberId"));
      const [m] = await appDb().select({ mandateId: teamMembers.mandateId }).from(teamMembers).where(and(eq(teamMembers.id, memberId), mandateCondition(user.scope, teamMembers.mandateId)));
      if (!m) throw new Error("Person not found");
      const weekStart = mondayOf(zDate.parse(formData.get("week")));
      const weeks = Math.min(26, Math.max(1, num(formData, "weeks") ?? 1));
      const appId = opt(formData, "applicationId");
      if (appId) await appFor(user.scope, appId);
      for (let i = 0; i < weeks; i++) await appDb().insert(allocations).values({ mandateId: m.mandateId, memberId, weekStart: new Date(Date.parse(`${weekStart}T12:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10), hours: z.number().min(0).max(80).parse(num(formData, "hours")), kind: z.enum(["client", "internal", "leave"]).parse(formData.get("kind")), engagementId: opt(formData, "engagementId"), applicationId: appId, note: str(formData, "note", 200) });
    }, { internal: true });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/capacity"), msg));
}

export async function deleteAllocationAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await appDb().delete(allocations).where(and(eq(allocations.id, id), mandateCondition(user.scope, allocations.mandateId))); }, { internal: true });
  redirect(note(back(formData, "/capacity"), "Allocation removed."));
}

export async function saveSpecialistAction(formData: FormData) {
  let id = opt(formData, "id"), msg = "Specialist saved. Ratings and notes stay internal.";
  try {
    await withOsUser(async user => {
      const v = {
        name: z.string().trim().min(2).max(160).parse(formData.get("name")), orgId: await orgIn(user.scope, opt(formData, "orgId")), expertise: formData.getAll("expertise").map(String).filter(k => k in SPECIALIST_BENCH),
        sectors: list(formData, "sectors"), subSectors: list(formData, "subSectors"), geographies: list(formData, "geographies"), countries: list(formData, "countries"), languages: list(formData, "languages"),
        credentials: str(formData, "credentials", 1000), hourlyRate: num(formData, "hourlyRate"), dayRate: num(formData, "dayRate"), currency: str(formData, "currency", 3) || "USD", availability: str(formData, "availability", 300),
        ndaStatus: z.enum(keys(NDA_STATES)).catch("none").parse(formData.get("ndaStatus")), conflictStatus: z.enum(keys(CONFLICT_STATES)).catch("unchecked").parse(formData.get("conflictStatus")),
        priorEngagements: list(formData, "priorEngagements"), performanceNotes: str(formData, "performanceNotes", 2000), rating: z.number().int().min(1).max(5).nullable().catch(null).parse(num(formData, "rating")),
        engagementModel: str(formData, "engagementModel", 200), source: z.enum(keys(SPECIALIST_SOURCES)).catch("other").parse(formData.get("source")), sourceNote: str(formData, "sourceNote", 300), updatedAt: new Date().toISOString(),
      };
      if (id) {
        const [s] = await appDb().select({ id: specialists.id }).from(specialists).where(and(eq(specialists.id, id), mandateCondition(user.scope, specialists.mandateId)));
        if (!s) throw new Error("Not found");
        await appDb().update(specialists).set(v).where(eq(specialists.id, id));
      } else id = (await appDb().insert(specialists).values({ mandateId: user.scope.mandateIds[0], ...v }).returning({ id: specialists.id }))[0].id;
      await audit(appDb(), { actor: user.email, action: "specialist_save", entity: "specialists", entityId: id! });
    }, { internal: true });
  } catch (e) { msg = errText(e); }
  redirect(note(id ? `/specialists?open=${id}` : "/specialists", msg));
}

export async function saveScenarioAction(formData: FormData) {
  let id = opt(formData, "id"), msg = "Scenario saved. It stays ILLUSTRATIVE unless you designate it a forecast.";
  try {
    await withOsUser(async user => {
      const tier = z.enum(["lean", "base", "scale", "custom"]).catch("custom").parse(formData.get("tier"));
      const inputs = formData.get("fromTemplate") === "1" && tier !== "custom" ? SCENARIO_TEMPLATES[tier] : Object.fromEntries(SCENARIO_FIELDS.map(f => [f.key, num(formData, f.key) ?? 0]));
      const forecast = formData.get("forecast") === "on";
      const v = { name: str(formData, "name", 120) || `${tier[0].toUpperCase()}${tier.slice(1)} scenario`, tier, inputs, illustrative: !forecast, designatedBy: forecast ? user.email : null, notes: str(formData, "notes", 1000), updatedAt: new Date().toISOString() };
      if (id) {
        const [s] = await appDb().select({ id: practiceScenarios.id }).from(practiceScenarios).where(and(eq(practiceScenarios.id, id), mandateCondition(user.scope, practiceScenarios.mandateId)));
        if (!s) throw new Error("Not found");
        await appDb().update(practiceScenarios).set(v).where(eq(practiceScenarios.id, id));
      } else id = (await appDb().insert(practiceScenarios).values({ mandateId: user.scope.mandateIds[0], ...v }).returning({ id: practiceScenarios.id }))[0].id;
      await audit(appDb(), { actor: user.email, action: "scenario_save", entity: "practice_scenarios", entityId: id!, after: { forecast } });
    }, { internal: true });
  } catch (e) { msg = errText(e); }
  redirect(note(`/funding/economics${id ? `?scenario=${id}` : ""}`, msg));
}
