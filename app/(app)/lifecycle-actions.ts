"use server";

// Commercial lifecycle actions (phase 29A): commercial pipeline moves, versioned proposals, agreement → engagement,
// delivery templates, deliverables, client requests and change requests. Identity comes from the session; every record
// is checked against the user's workspaces. Approving offers and templates is for workspace owners.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { changeRequests, clientRequests, contacts, deals, deliveryTemplates, engagementDeliverables, engagements, fieldReviews, offerProposals, offerProposalVersions, organizations, partnerships, projects, relationshipIntroductions, services, stewardFindings } from "@/db/schema";
import { decideFieldReview } from "@/lib/lifecycle/reviews";
import { createFinding, FINDING_DIMENSIONS, setFindingStatus } from "@/lib/steward/findings";
import { captureContact, createIntroduction, movePartnership, setIntroductionOutcome, setRelationshipStage, upsertPartnership } from "@/lib/lifecycle/network";
import { addRole, removeRole } from "@/lib/lifecycle/relationships";
import { completeEngagement } from "@/lib/lifecycle/closeout";
import { reviewMeeting } from "@/lib/lifecycle/meetings";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition, type Scope } from "@/lib/db/scoped";
import { decideChange, ensureTemplates, instantiateTemplate, moveDeliverable, proposeChange, reviewClientRequest, setTemplateStatus, submitClientRequest } from "@/lib/lifecycle/delivery";
import { moveCommercialStage } from "@/lib/lifecycle/pipeline";
import { createProposal, decideVersion, recordAgreement, saveVersion, sendVersion } from "@/lib/lifecycle/proposals";
import { CAPTURE_CHANNELS, COMMERCIAL_STAGES, DELIVERABLE_STATUS, FEE_STRUCTURES, PARTNERSHIP_KINDS, PARTNERSHIP_STAGES, RELATIONSHIP_ROLES, RELATIONSHIP_STAGES } from "@/lib/lifecycle/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 2000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k, 40).replace(/[, ]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const lines = (s: string) => s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
// The notice goes in the query, before any #anchor, so the page can read it.
const note = (path: string, text: string) => { const [base, hash] = path.split("#"); return `${base}${base.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}${hash ? `#${hash}` : ""}`; };

type U = { email: string; scope: Scope };
const me = async (u: { email: string; scope: Scope }): Promise<U> => ({ email: u.email, scope: u.scope });
/** Runs a write; a rule failure comes back as a notice on the same page, nothing half-saved. */
async function run(back: string, user: U, fn: (u: U) => Promise<string | void>, ok: string) {
  let msg = ok, to = back;
  try { const m = await fn(user); if (m) { if (m.startsWith("/")) to = m; else msg = m; } }
  catch (e) { msg = `Not saved: ${(e as Error).message}`; }
  redirect(note(to, msg));
}

const scopedDeal = async (scope: Scope, id: string) => { const [d] = await appDb().select().from(deals).where(and(eq(deals.id, id), mandateCondition(scope, deals.mandateId))); if (!d) throw new Error("Opportunity not found"); return d; };
const scopedProposal = async (scope: Scope, id: string) => { const [p] = await appDb().select().from(offerProposals).where(and(eq(offerProposals.id, id), mandateCondition(scope, offerProposals.mandateId))); if (!p) throw new Error("Proposal not found"); return p; };
const scopedEngagement = async (scope: Scope, id: string) => { const [e] = await appDb().select().from(engagements).where(and(eq(engagements.id, id), mandateCondition(scope, engagements.mandateId))); if (!e) throw new Error("Engagement not found"); return e; };
const pUrl = (id: string) => `/commercial/proposals/${id}`;
const eUrl = (id: string) => `/commercial/engagements/${id}#delivery`;

export async function moveCommercialStageAction(f: FormData) {
  const dealId = zId.parse(f.get("dealId"));
  const stage = z.enum(keys(COMMERCIAL_STAGES)).parse(f.get("stage"));
  await run(`/deals/${dealId}#commercial`, await withOsUser(me), async ({ email, scope }) => {
    const d = await scopedDeal(scope, dealId);
    await moveCommercialStage(appDb(), dealId, stage, { reason: str(f, "reason", 500), evidence: str(f, "evidence", 500), override: f.get("override") === "on" && isOwner(scope, d.mandateId) }, email);
  }, `Moved to ${COMMERCIAL_STAGES[stage]}.`);
}

export async function createProposalAction(f: FormData) {
  const dealId = zId.parse(f.get("dealId"));
  await run(`/deals/${dealId}#commercial`, await withOsUser(me), async ({ email, scope }) => {
    const d = await scopedDeal(scope, dealId);
    const serviceIds = f.getAll("serviceId").map(v => zId.parse(v));
    const svc = serviceIds.length ? (await appDb().select().from(services).where(eq(services.mandateId, d.mandateId))).filter(s => serviceIds.includes(s.id)) : [];
    const templateId = zId.safeParse(f.get("templateId")).data ?? null;
    const p = await createProposal(appDb(), {
      dealId, title: str(f, "title", 200) || d.name, serviceIds: svc.map(s => s.id), templateId,
      scope: svc.map(s => `${s.name}: ${s.description || s.deliverables.join(", ")}`).join("\n"),
      deliverables: svc.flatMap(s => s.deliverables.map(label => ({ label }))), exclusions: svc.flatMap(s => s.exclusions).join("\n"),
      feeStructure: z.enum(keys(FEE_STRUCTURES)).catch("fixed").parse(f.get("feeStructure")), currency: (str(f, "currency", 3) || svc[0]?.currency || "USD").toUpperCase(),
    }, email);
    return pUrl(p.id);
  }, "Proposal drafted from the selected services. Set the fee, schedule and validity, then send.");
}

export async function saveProposalAction(f: FormData) {
  const proposalId = zId.parse(f.get("proposalId"));
  await run(pUrl(proposalId), await withOsUser(me), async ({ email, scope }) => {
    await scopedProposal(scope, proposalId);
    const schedule = lines(str(f, "paymentSchedule", 4000)).map(l => { const [label, amount, trigger] = l.split("|").map(x => x.trim()); const n = Number((amount ?? "").replace(/[, ]/g, "")); if (!label || !Number.isFinite(n)) throw new Error(`Payment line "${l}" needs: label | amount | when`); return { label, amount: n, trigger: trigger || "on invoice" }; });
    const v = await saveVersion(appDb(), proposalId, {
      summary: str(f, "summary"), scope: str(f, "scope", 8000), deliverables: lines(str(f, "deliverables", 4000)).map(label => ({ label })),
      assumptions: str(f, "assumptions", 4000), exclusions: str(f, "exclusions", 4000), timeline: str(f, "timeline"), responsibilities: str(f, "responsibilities", 4000),
      feeStructure: z.enum(keys(FEE_STRUCTURES)).catch("fixed").parse(f.get("feeStructure")), currency: (str(f, "currency", 3) || "USD").toUpperCase(),
      fee: num(f, "fee"), monthlyFee: num(f, "monthlyFee"), months: num(f, "months"), hourlyRate: num(f, "hourlyRate"), estimatedHours: num(f, "estimatedHours"),
      paymentSchedule: schedule, validUntil: date(f, "validUntil"), templateId: zId.safeParse(f.get("templateId")).data ?? null,
    }, email);
    return `Saved as version ${v.version} (draft).`;
  }, "Saved.");
}

export async function sendProposalAction(f: FormData) {
  const proposalId = zId.parse(f.get("proposalId"));
  await run(pUrl(proposalId), await withOsUser(me), async ({ email, scope }) => {
    await scopedProposal(scope, proposalId);
    await sendVersion(appDb(), proposalId, email);
  }, "Recorded as sent. The version is now frozen; any change becomes a new version. Send the document itself from your mailbox or an approved message.");
}

export async function decideProposalAction(f: FormData) {
  const versionId = zId.parse(f.get("versionId"));
  const decision = z.enum(["accepted", "declined"]).parse(f.get("decision"));
  await run("/commercial?tab=proposals", await withOsUser(me), async ({ email, scope }) => {
    const [v] = await appDb().select({ proposalId: offerProposalVersions.proposalId }).from(offerProposalVersions).where(eq(offerProposalVersions.id, versionId));
    if (!v) throw new Error("Version not found");
    await scopedProposal(scope, v.proposalId);
    await decideVersion(appDb(), versionId, decision, { decidedBy: str(f, "decidedBy", 200), evidence: str(f, "evidence", 1000) }, email);
    return pUrl(v.proposalId);
  }, decision === "accepted" ? "Acceptance recorded. Record the agreement to start the engagement." : "Recorded as declined.");
}

export async function recordAgreementAction(f: FormData) {
  const proposalId = zId.parse(f.get("proposalId"));
  await run(pUrl(proposalId), await withOsUser(me), async ({ email, scope }) => {
    await scopedProposal(scope, proposalId);
    const executionDate = date(f, "executionDate");
    if (!executionDate) throw new Error("Set the signature date.");
    const r = await recordAgreement(appDb(), proposalId, { executionDate, startDate: date(f, "startDate"), evidence: str(f, "evidence", 1000), templateId: zId.safeParse(f.get("templateId")).data ?? null }, email);
    return eUrl(r.engagementId);
  }, "Agreement recorded: contract registered, engagement created from the accepted version, delivery plan set up. Run the conflict check before activating.");
}

export async function setServiceOfferAction(f: FormData) {
  const serviceId = zId.parse(f.get("serviceId"));
  const status = z.enum(["approved", "retired", "draft"]).parse(f.get("status"));
  await run("/commercial?tab=services", await withOsUser(me), async ({ email, scope }) => {
    const [s] = await appDb().select().from(services).where(and(eq(services.id, serviceId), mandateCondition(scope, services.mandateId)));
    if (!s) throw new Error("Service not found");
    if (!isOwner(scope, s.mandateId)) throw new Error("Only a workspace owner approves offers.");
    if (status === "approved" && (!s.deliverables.length || s.listPrice == null)) throw new Error("An approved offer needs deliverables and a price set by you.");
    await appDb().update(services).set({ offerStatus: status, approvedBy: status === "approved" ? email : s.approvedBy, approvedAt: status === "approved" ? new Date().toISOString() : s.approvedAt, offerVersion: status === "approved" && s.offerStatus !== "approved" ? s.offerVersion + (s.approvedAt ? 1 : 0) : s.offerVersion, updatedAt: new Date().toISOString() }).where(eq(services.id, serviceId));
    await audit(appDb(), { actor: email, action: `service_offer_${status}`, entity: "services", entityId: serviceId });
  }, status === "approved" ? "Offer approved." : status === "retired" ? "Offer retired." : "Back to draft.");
}

export async function ensureTemplatesAction() {
  await run("/commercial?tab=templates", await withOsUser(me), async ({ email, scope }) => {
    if (scope.kind !== "user" || !scope.mandateIds[0]) throw new Error("No workspace.");
    await ensureTemplates(appDb(), scope.mandateIds[0], email);
  }, "Starter templates added as drafts. Review and approve them before use.");
}

export async function setTemplateStatusAction(f: FormData) {
  const templateId = zId.parse(f.get("templateId"));
  const status = z.enum(["approved", "retired"]).parse(f.get("status"));
  await run("/commercial?tab=templates", await withOsUser(me), async ({ email, scope }) => {
    const [t] = await appDb().select().from(deliveryTemplates).where(and(eq(deliveryTemplates.id, templateId), mandateCondition(scope, deliveryTemplates.mandateId)));
    if (!t) throw new Error("Template not found");
    if (!isOwner(scope, t.mandateId)) throw new Error("Only a workspace owner approves templates.");
    await setTemplateStatus(appDb(), templateId, status, email);
  }, status === "approved" ? "Template approved." : "Template retired.");
}

export async function instantiateTemplateAction(f: FormData) {
  const engagementId = zId.parse(f.get("engagementId"));
  await run(eUrl(engagementId), await withOsUser(me), async ({ email, scope }) => {
    const e = await scopedEngagement(scope, engagementId);
    await instantiateTemplate(appDb(), e.id, zId.parse(f.get("templateId")), date(f, "startDate") ?? e.startDate ?? new Date().toISOString().slice(0, 10), email);
  }, "Delivery plan created from the template.");
}

export async function moveDeliverableAction(f: FormData) {
  const id = zId.parse(f.get("deliverableId"));
  const to = z.enum(keys(DELIVERABLE_STATUS)).parse(f.get("to"));
  const back = zId.safeParse(f.get("engagementId")).data;
  await run(back ? eUrl(back) : "/commercial?tab=engagements", await withOsUser(me), async ({ email, scope }) => {
    const [d] = await appDb().select({ engagementId: engagementDeliverables.engagementId }).from(engagementDeliverables).where(eq(engagementDeliverables.id, id));
    if (!d) throw new Error("Deliverable not found");
    await scopedEngagement(scope, d.engagementId);
    await moveDeliverable(appDb(), id, to, { by: email, evidence: str(f, "evidence", 1000), note: str(f, "note", 1000), blockedReason: str(f, "blockedReason", 500), blockedParty: str(f, "blockedParty", 200), clientName: str(f, "clientName", 200) });
  }, `Now: ${DELIVERABLE_STATUS[to]}.`);
}

export async function clientRequestAction(f: FormData) {
  const id = zId.parse(f.get("requestId"));
  const op = z.enum(["submit", "accept", "reject"]).parse(f.get("op"));
  const back = zId.safeParse(f.get("engagementId")).data;
  await run(back ? eUrl(back) : "/commercial?tab=engagements", await withOsUser(me), async ({ email, scope }) => {
    const [r] = await appDb().select({ engagementId: clientRequests.engagementId }).from(clientRequests).where(eq(clientRequests.id, id));
    if (!r) throw new Error("Request not found");
    await scopedEngagement(scope, r.engagementId);
    if (op === "submit") await submitClientRequest(appDb(), id, { response: str(f, "response"), by: `${email} (on behalf of the client)` });
    else await reviewClientRequest(appDb(), id, op === "accept" ? "accepted" : "rejected", str(f, "note", 1000), email);
  }, op === "submit" ? "Response recorded." : op === "accept" ? "Accepted." : "Sent back with what is missing.");
}

export async function proposeChangeAction(f: FormData) {
  const engagementId = zId.parse(f.get("engagementId"));
  await run(eUrl(engagementId), await withOsUser(me), async ({ email, scope }) => {
    await scopedEngagement(scope, engagementId);
    await proposeChange(appDb(), engagementId, { title: str(f, "title", 200), description: str(f, "description"), scopeEffect: str(f, "scopeEffect"), feeImpact: num(f, "feeImpact") ?? 0, timelineWeeks: num(f, "timelineWeeks") ?? 0, addDeliverables: lines(str(f, "addDeliverables")) }, email);
  }, "Change request recorded as proposed. The agreed scope is unchanged until the client approves it.");
}

export async function decideChangeAction(f: FormData) {
  const id = zId.parse(f.get("changeId"));
  const decision = z.enum(["approved", "rejected"]).parse(f.get("decision"));
  const back = zId.safeParse(f.get("engagementId")).data;
  await run(back ? eUrl(back) : "/commercial?tab=engagements", await withOsUser(me), async ({ email, scope }) => {
    const [c] = await appDb().select({ engagementId: changeRequests.engagementId }).from(changeRequests).where(eq(changeRequests.id, id));
    if (!c) throw new Error("Change request not found");
    await scopedEngagement(scope, c.engagementId);
    await decideChange(appDb(), id, decision, str(f, "evidence", 1000), email);
  }, decision === "approved" ? "Change approved: deliverables and fee updated; the accepted proposal is kept as agreed." : "Change rejected.");
}

// ---------- Phase 29B: relationships, contacts captured by hand, partnerships, introductions ----------
const zEntity = z.enum(["contact", "organization"]);
const entityUrl = (t: "contact" | "organization", id: string) => `${t === "contact" ? "/people" : "/companies"}/${id}#relationship`;
async function scopedEntity(scope: Scope, t: "contact" | "organization", id: string) {
  if (t === "contact") {
    const [x] = await appDb().select({ id: contacts.id, mandateId: contacts.mandateId }).from(contacts).where(and(eq(contacts.id, id), mandateCondition(scope, contacts.mandateId)));
    if (!x) throw new Error("Record not found");
    return x;
  }
  const [x] = await appDb().select({ id: organizations.id, mandateId: organizations.mandateId }).from(organizations).where(and(eq(organizations.id, id), mandateCondition(scope, organizations.mandateId)));
  if (!x) throw new Error("Record not found");
  return x;
}

export async function addRoleAction(f: FormData) {
  const t = zEntity.parse(f.get("entityType")), id = zId.parse(f.get("entityId"));
  const role = z.enum(keys(RELATIONSHIP_ROLES)).parse(f.get("role"));
  await run(entityUrl(t, id), await withOsUser(me), async ({ email, scope }) => {
    const x = await scopedEntity(scope, t, id);
    await addRole(appDb(), { mandateId: x.mandateId, entityType: t, entityId: id, role, basis: f.get("verified") === "on" ? "verified" : "stated", note: str(f, "note", 500) }, email);
  }, `Added: ${RELATIONSHIP_ROLES[role]}.`);
}

export async function endRoleAction(f: FormData) {
  const t = zEntity.parse(f.get("entityType")), id = zId.parse(f.get("entityId"));
  const role = z.enum(keys(RELATIONSHIP_ROLES)).parse(f.get("role"));
  await run(entityUrl(t, id), await withOsUser(me), async ({ email, scope }) => {
    const x = await scopedEntity(scope, t, id);
    await removeRole(appDb(), x.mandateId, t, id, role, email);
  }, `Ended: ${RELATIONSHIP_ROLES[role]}.`);
}

export async function relationshipStageAction(f: FormData) {
  const t = zEntity.parse(f.get("entityType")), id = zId.parse(f.get("entityId"));
  const stage = z.enum(keys(RELATIONSHIP_STAGES)).parse(f.get("stage"));
  await run(entityUrl(t, id), await withOsUser(me), async ({ email, scope }) => {
    const x = await scopedEntity(scope, t, id);
    await setRelationshipStage(appDb(), x.mandateId, t, id, stage, { reason: str(f, "reason", 500), nextAction: str(f, "nextAction", 300), nextActionDue: date(f, "nextActionDue"), noActionReason: str(f, "noActionReason", 300) }, email);
  }, `Relationship: ${RELATIONSHIP_STAGES[stage]}.`);
}

export async function captureContactAction(f: FormData) {
  await run("/relationships#capture", await withOsUser(me), async ({ email, scope }) => {
    if (scope.kind !== "user" || !scope.mandateIds[0]) throw new Error("No workspace.");
    const wanted = String(f.get("mandateId") ?? "");
    const mandateId = scope.mandateIds.includes(wanted) ? wanted : scope.mandateIds[0];
    const role = z.enum(keys(RELATIONSHIP_ROLES)).catch("acquaintance").parse(f.get("role"));
    const r = await captureContact(appDb(), mandateId, {
      name: str(f, "name", 120), email: str(f, "email", 254) || null, organization: str(f, "organization", 200) || null, title: str(f, "title", 200) || null,
      channel: z.enum(keys(CAPTURE_CHANNELS)).catch("other").parse(f.get("channel")), referrerName: str(f, "referrerName", 120) || null, referrerEmail: str(f, "referrerEmail", 254) || null,
      note: str(f, "note", 1000), role, nextAction: str(f, "nextAction", 300), nextActionDue: date(f, "nextActionDue"),
    }, email);
    return `/people/${r.contactId}#relationship`;
  }, "Recorded with its source, referrer and next action. Not a client: that only follows an agreed engagement.");
}

export async function partnershipAction(f: FormData) {
  const orgId = zId.parse(f.get("orgId"));
  const kind = z.enum(keys(PARTNERSHIP_KINDS)).parse(f.get("kind"));
  await run(`/companies/${orgId}#partnership`, await withOsUser(me), async ({ email, scope }) => {
    const x = await scopedEntity(scope, "organization", orgId);
    await upsertPartnership(appDb(), x.mandateId, orgId, kind, { capabilities: lines(str(f, "capabilities", 2000).replace(/,/g, "\n")), geographies: lines(str(f, "geographies", 500).replace(/,/g, "\n")), capacity: str(f, "capacity", 300) }, email);
  }, "Partnership saved.");
}

export async function movePartnershipAction(f: FormData) {
  const id = zId.parse(f.get("partnershipId"));
  const to = z.enum(keys(PARTNERSHIP_STAGES)).parse(f.get("to"));
  const back = zId.safeParse(f.get("orgId")).data;
  await run(back ? `/companies/${back}#partnership` : "/partners", await withOsUser(me), async ({ email, scope }) => {
    const [p] = await appDb().select().from(partnerships).where(and(eq(partnerships.id, id), mandateCondition(scope, partnerships.mandateId)));
    if (!p) throw new Error("Partnership not found");
    await movePartnership(appDb(), id, to, { evidence: str(f, "evidence", 1000), arrangement: str(f, "arrangement", 2000) || undefined, commercialTerms: str(f, "commercialTerms", 1000) || undefined, contractId: zId.safeParse(f.get("contractId")).data ?? null, reason: str(f, "reason", 500) }, email);
  }, `Partnership: ${PARTNERSHIP_STAGES[to]}.`);
}

export async function introductionAction(f: FormData) {
  const fromOrgId = zId.parse(f.get("fromOrgId"));
  await run(`/companies/${fromOrgId}#introductions`, await withOsUser(me), async ({ email, scope }) => {
    const x = await scopedEntity(scope, "organization", fromOrgId);
    const toOrgId = zId.safeParse(f.get("toOrgId")).data ?? null;
    if (toOrgId) await scopedEntity(scope, "organization", toOrgId);
    await createIntroduction(appDb(), { mandateId: x.mandateId, fromOrgId, toOrgId, partnershipId: zId.safeParse(f.get("partnershipId")).data ?? null, projectId: zId.safeParse(f.get("projectId")).data ?? null, purpose: str(f, "purpose", 500), authorization: str(f, "authorization", 500), materialsShared: lines(str(f, "materials", 1000)), date: date(f, "date"), nextAction: str(f, "nextAction", 300) }, email);
  }, "Introduction recorded. Nothing was sent: make the introduction yourself or through an approved message.");
}

export async function introductionOutcomeAction(f: FormData) {
  const id = zId.parse(f.get("introductionId"));
  const outcome = z.enum(["meeting_held", "engaged", "declined", "no_response", "withdrawn"]).parse(f.get("outcome"));
  const back = zId.safeParse(f.get("orgId")).data;
  await run(back ? `/companies/${back}#introductions` : "/relationships", await withOsUser(me), async ({ email, scope }) => {
    const [i] = await appDb().select({ id: relationshipIntroductions.id }).from(relationshipIntroductions).where(and(eq(relationshipIntroductions.id, id), mandateCondition(scope, relationshipIntroductions.mandateId)));
    if (!i) throw new Error("Introduction not found");
    await setIntroductionOutcome(appDb(), id, outcome, str(f, "note", 500), email);
  }, "Outcome recorded.");
}

// ---------- Phase 29D: meeting follow-up and engagement completion ----------
export async function reviewMeetingAction(f: FormData) {
  const dealId = zId.parse(f.get("dealId"));
  await run(`/deals/${dealId}#meeting`, await withOsUser(me), async ({ email, scope }) => {
    const d = await scopedDeal(scope, dealId);
    // Actions: one per line, "title | owner | YYYY-MM-DD"; owner defaults to you, date to a week from now.
    const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const actions = lines(str(f, "actions", 4000)).map(l => { const [title, owner, due] = l.split("|").map(x => x.trim()); return { title, owner: owner || email, due: due || week }; });
    const subject = str(f, "followSubject", 300), body = str(f, "followBody", 8000);
    const r = await reviewMeeting(appDb(), d.mandateId, {
      dealId, title: str(f, "title", 200), heldOn: date(f, "heldOn") ?? new Date().toISOString().slice(0, 10), participants: str(f, "participants", 500), notes: str(f, "notes", 20000),
      decisions: lines(str(f, "decisions", 4000)), actions, followUp: subject && body ? { subject, body } : null,
      suggestedStage: z.enum(keys(COMMERCIAL_STAGES)).safeParse(f.get("suggestedStage")).data ?? null,
    }, email);
    return [`Meeting recorded with ${actions.length} action${actions.length === 1 ? "" : "s"}.`, r.messageId ? (r.styleIssues.length ? ` Follow-up draft needs edits before approval: ${r.styleIssues.join("; ")}.` : " Follow-up draft is in the approval queue (nothing was sent).") : "", r.suggestion ? ` Suggested stage change to review: ${r.suggestion}.` : ""].join("");
  }, "Meeting recorded.");
}

export async function completeEngagementAction(f: FormData) {
  const engagementId = zId.parse(f.get("engagementId"));
  await run(`/commercial/engagements/${engagementId}#closeout`, await withOsUser(me), async ({ email, scope }) => {
    await scopedEngagement(scope, engagementId);
    const r = await completeEngagement(appDb(), engagementId, {
      outcome: str(f, "outcome", 2000), acceptanceEvidence: str(f, "acceptanceEvidence", 1000), lessons: str(f, "lessons", 4000), continuation: str(f, "continuation", 1000),
      outstandingReason: str(f, "outstandingReason", 1000), caseStudy: f.get("askCaseStudy") === "on" ? "requested" : "not_asked", askReferral: f.get("askReferral") === "on", reviewInDays: num(f, "reviewInDays") ?? 30,
    }, email);
    return `Completed. Relationship review scheduled for ${r.reviewDue}.${r.unpaid.length ? ` ${r.unpaid.length} invoice(s) still unpaid: collection tasks created.` : ""}`;
  }, "Completed.");
}

// ---------- Phase 29E: field reviews and Steward findings ----------
export async function fieldReviewAction(f: FormData) {
  const id = zId.parse(f.get("reviewId"));
  const decision = z.enum(["accepted", "rejected"]).parse(f.get("decision"));
  await run("/intelligence/reviews", await withOsUser(me), async ({ email, scope }) => {
    const [r] = await appDb().select().from(fieldReviews).where(and(eq(fieldReviews.id, id), mandateCondition(scope, fieldReviews.mandateId)));
    if (!r) throw new Error("Review not found");
    await decideFieldReview(appDb(), id, decision, str(f, "note", 500), email);
  }, decision === "accepted" ? "Proposed value accepted, with its source." : "Current value kept.");
}

export async function createFindingAction(f: FormData) {
  const projectId = zId.parse(f.get("projectId"));
  await run(`/projects/${projectId}?tab=steward#findings`, await withOsUser(me), async ({ email, scope }) => {
    const [p] = await appDb().select({ id: projects.id, mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    await createFinding(appDb(), {
      mandateId: p.mandateId, projectId, placeId: zId.safeParse(f.get("placeId")).data ?? null, dimension: z.enum(keys(FINDING_DIMENSIONS)).parse(f.get("dimension")),
      subject: str(f, "subject", 300), scope: str(f, "scope", 300), evidence: str(f, "evidence", 2000), affectedParties: str(f, "affectedParties", 500),
      uncertainty: z.enum(["low", "moderate", "high", "unknown"]).catch("unknown").parse(f.get("uncertainty")), implication: str(f, "implication", 2000), requiredAction: str(f, "requiredAction", 1000),
      materiality: f.get("minor") === "on" ? "minor" : "material", owner: str(f, "owner", 200) || null, reviewDate: date(f, "reviewDate"),
    }, email);
  }, "Finding recorded; the action is a task for its owner and the finding stays on readiness until resolved.");
}

export async function findingStatusAction(f: FormData) {
  const id = zId.parse(f.get("findingId"));
  const status = z.enum(["monitoring", "resolved", "open"]).parse(f.get("status"));
  const projectId = zId.safeParse(f.get("projectId")).data;
  await run(projectId ? `/projects/${projectId}?tab=steward#findings` : "/steward", await withOsUser(me), async ({ email, scope }) => {
    const [x] = await appDb().select({ id: stewardFindings.id }).from(stewardFindings).where(and(eq(stewardFindings.id, id), mandateCondition(scope, stewardFindings.mandateId)));
    if (!x) throw new Error("Finding not found");
    await setFindingStatus(appDb(), id, status, { evidence: str(f, "evidence", 2000), reviewDate: date(f, "reviewDate") }, email);
  }, status === "resolved" ? "Resolved, with its evidence." : status === "monitoring" ? "Now monitored." : "Reopened.");
}
