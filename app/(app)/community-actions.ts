"use server";

// Community rights, knowledge governance and community economic participation. Every write is scoped to the user's
// entities and audited; knowledge permissions and consent go through lib/community/engine gates.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  capitalProfiles, communities, communityAuthorities, communityCommitments, communityEngagements, communityFunds, communityGovernanceRights, communityGrievances, communityLedger,
  communityRights, consentRecords, knowledgeHolders, knowledgeRecords, participationStructures, projects,
} from "@/db/schema";
import type { StructureTerms } from "@/db/community";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { createKnowledgeRecord, setConsentStatus, setPermission, withdraw } from "@/lib/community/engine";
import {
  ACCESS_STATUS, ACTIVITIES, ALIGNMENT_FLAGS, AUTHORITY_POWERS, AUTHORITY_TYPES, COMMITMENT_STATUS, COMMITMENT_TYPES, COMMUNITY_TYPES, CONSENT_STATUS, CONSENT_TYPES, CP_PREFERENCE,
  DISCLOSURES, ENGAGEMENT_FORMATS, GOVERNANCE_RIGHT_TYPES, GOVERNANCE_STATUS, GRIEVANCE_STATUS, KNOWLEDGE_CATEGORIES, LEDGER_ENTRY_STATUS, MATERIALITY, PARTICIPATION_TYPES, RIGHT_STATUS,
  RIGHT_TYPES, STAKE_FUNDING, STRUCTURE_STATUS, SUPPORTED_STRUCTURES,
} from "@/lib/community/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 600) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const bool = (f: FormData, k: string) => f.get(k) === "on";
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const tab = (projectId: string, sec: string) => `/projects/${projectId}?tab=community&sec=${sec}`;
type Scope = Parameters<typeof mandateCondition>[0];

async function scopedProject(scope: Scope, id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}
async function scopedCommunity(scope: Scope, id: string) {
  const [c] = await appDb().select().from(communities).where(and(eq(communities.id, id), mandateCondition(scope, communities.mandateId)));
  if (!c) throw new Error("Community not found");
  return c;
}

/** Runs a write for a project, catching gate errors into the notice. */
type User = Awaited<ReturnType<typeof withOsUser<{ email: string; scope: Scope }>>>;
/** Every action resolves its user with withOsUser first (route-guard test), then runs scoped to the project. */
async function onProject(user: User, formData: FormData, sec: string, fn: (p: Awaited<ReturnType<typeof scopedProject>>, actor: string, scope: Scope) => Promise<string | void>, ok: string) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = ok;
  const p = await scopedProject(user.scope, projectId);
  try { const m = await fn(p, user.email, user.scope); if (m) msg = m; } catch (e) { msg = `Not saved: ${(e as Error).message}`; }
  redirect(note(tab(projectId, sec), msg));
}

export async function addCommunityAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "communities", async (p, actor) => {
    const [c] = await appDb().insert(communities).values({
      mandateId: p.mandateId, projectId: p.id, name: str(formData, "name", 200), preferredName: str(formData, "preferredName", 200), peopleNationGroup: str(formData, "peopleNationGroup", 200),
      communityType: z.enum(keys(COMMUNITY_TYPES)).catch("local").parse(formData.get("communityType")), country: str(formData, "country", 60) || p.country, jurisdiction: str(formData, "jurisdiction", 120),
      territoryName: str(formData, "territoryName", 200), languagePrimary: str(formData, "languagePrimary", 80), representativeBody: str(formData, "representativeBody", 200),
      customaryAuthority: str(formData, "customaryAuthority", 200), legalEntityName: str(formData, "legalEntityName", 200), tenureType: str(formData, "tenureType", 120),
      knownDisputes: str(formData, "knownDisputes", 1000), isDemo: /^DEMO\b/.test(str(formData, "name", 200)), createdBy: actor,
    }).returning();
    await audit(appDb(), { actor, action: "community.create", entity: "community", entityId: c.id, after: { name: c.name } });
  }, "Community recorded. Record its authorities and rights next; representation and authority stay unverified until you verify them.");
}

export async function verifyCommunityAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "communities", async (_p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const source = str(formData, "verificationSource", 600);
    if (!source) throw new Error("Record how representation and authority were verified");
    await appDb().update(communities).set({ representationVerified: bool(formData, "representationVerified"), authorityVerified: bool(formData, "authorityVerified"), verificationSource: source, customaryRightsStatus: z.enum(keys(RIGHT_STATUS)).catch(c.customaryRightsStatus).parse(formData.get("customaryRightsStatus")), statutoryRightsStatus: z.enum(keys(RIGHT_STATUS)).catch(c.statutoryRightsStatus).parse(formData.get("statutoryRightsStatus")), updatedBy: actor, updatedAt: new Date().toISOString() }).where(eq(communities.id, c.id));
    await audit(appDb(), { actor, action: "community.verify", entity: "community", entityId: c.id, after: { source } });
  }, "Verification recorded.");
}

export async function addAuthorityAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "communities", async (_p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const verified = formData.get("verificationStatus") === "verified";
    const documentation = str(formData, "documentation", 600);
    if (verified && !documentation) throw new Error("A verified authority needs its documentation (assembly act, statute, recognised customary process)");
    const [a] = await appDb().insert(communityAuthorities).values({
      mandateId: c.mandateId, communityId: c.id, name: str(formData, "name", 200), authorityType: z.enum(keys(AUTHORITY_TYPES)).parse(formData.get("authorityType")),
      individualOrBody: formData.get("individualOrBody") === "individual" ? "individual" : "body", scope: str(formData, "scope", 600), subjectsNotAuthorized: str(formData, "subjectsNotAuthorized", 600),
      basis: str(formData, "basis", 600), termEnd: date(formData, "termEnd"), powers: formData.getAll("powers").map(String).filter(x => x in AUTHORITY_POWERS),
      knowledgeCategories: formData.getAll("knowledgeCategories").map(String).filter(x => x in KNOWLEDGE_CATEGORIES), verificationStatus: verified ? "verified" : "unverified", verifiedBy: verified ? actor : null, documentation, createdBy: actor,
    }).returning();
    await audit(appDb(), { actor, action: "community.authority", entity: "community_authority", entityId: a.id, after: { name: a.name, powers: a.powers, verified } });
  }, "Authority recorded.");
}

export async function addRightAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "rights", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const [r] = await appDb().insert(communityRights).values({
      mandateId: c.mandateId, communityId: c.id, projectId: p.id, rightType: z.enum(keys(RIGHT_TYPES)).parse(formData.get("rightType")), description: str(formData, "description", 1000),
      legalBasis: str(formData, "legalBasis", 600), customaryBasis: str(formData, "customaryBasis", 600), geographicScope: str(formData, "geographicScope", 300), sourceDocument: str(formData, "sourceDocument", 300),
      status: z.enum(keys(RIGHT_STATUS)).catch("asserted").parse(formData.get("status")), materiality: z.enum(keys(MATERIALITY)).catch("unknown").parse(formData.get("materiality")),
      consentRequired: bool(formData, "consentRequired"), compensationRequired: bool(formData, "compensationRequired"), mitigationRequired: bool(formData, "mitigationRequired"), negotiationRequired: bool(formData, "negotiationRequired"),
      createdBy: actor,
    }).returning();
    await audit(appDb(), { actor, action: "community.right", entity: "community_right", entityId: r.id, after: { type: r.rightType, materiality: r.materiality } });
  }, "Right recorded.");
}

export async function resolveRightAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "rights", async (p, actor) => {
    const id = zId.parse(formData.get("rightId"));
    const resolution = z.enum(["open", "in_progress", "resolved", "disclosed"]).parse(formData.get("resolution"));
    const why = str(formData, "notes", 1000);
    if ((resolution === "resolved" || resolution === "disclosed") && !why) throw new Error("Record how the right was resolved or where it is disclosed");
    await appDb().update(communityRights).set({ resolution, notes: why, updatedBy: actor, updatedAt: new Date().toISOString() }).where(and(eq(communityRights.id, id), eq(communityRights.projectId, p.id)));
    await audit(appDb(), { actor, action: "community.right_resolution", entity: "community_right", entityId: id, after: { resolution } });
  }, "Right updated.");
}

export async function addHolderAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "knowledge", async (_p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    await appDb().insert(knowledgeHolders).values({ mandateId: c.mandateId, communityId: c.id, name: str(formData, "name", 200), preferredIdentifier: str(formData, "preferredIdentifier", 200), anonymousPublicly: !bool(formData, "namedPublicly"), role: str(formData, "role", 200), relationshipToKnowledge: str(formData, "relationshipToKnowledge", 400), attributionPreference: str(formData, "attributionPreference", 300), createdBy: actor });
  }, "Knowledge holder recorded. A holder is not an authority: permissions need an authority with the relevant power.");
}

export async function addKnowledgeAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "knowledge", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    await createKnowledgeRecord(appDb(), {
      mandateId: c.mandateId, projectId: p.id, communityId: c.id, holderId: zId.safeParse(formData.get("holderId")).data ?? null, authorityId: zId.safeParse(formData.get("authorityId")).data ?? null,
      title: str(formData, "title", 200), category: z.enum(keys(KNOWLEDGE_CATEGORIES)).parse(formData.get("category")), descriptionPublic: str(formData, "descriptionPublic", 1000),
      protectedContentRef: str(formData, "protectedContentRef", 400) || null, sourceType: str(formData, "sourceType", 120), originalLanguage: str(formData, "originalLanguage", 60), collectionMethod: str(formData, "collectionMethod", 200),
      collectionDate: date(formData, "collectionDate"), accessStatus: z.enum(keys(ACCESS_STATUS)).catch("restricted").parse(formData.get("accessStatus")),
      governanceStatus: z.enum(keys(GOVERNANCE_STATUS)).catch("unknown").parse(formData.get("governanceStatus")), spatialSensitivity: z.enum(["none", "generalise", "hide"]).catch("hide").parse(formData.get("spatialSensitivity")),
      generalizedArea: str(formData, "generalizedArea", 200),
    }, actor);
  }, "Knowledge record created with restrictive defaults (AI use prohibited).");
}

export async function setPermissionAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "knowledge", async (p, actor) => {
    const recordId = zId.parse(formData.get("recordId"));
    const [r] = await appDb().select({ projectId: knowledgeRecords.projectId }).from(knowledgeRecords).where(eq(knowledgeRecords.id, recordId));
    if (r?.projectId !== p.id) throw new Error("Record not in this project");
    await setPermission(appDb(), { recordId, activity: z.enum(keys(ACTIVITIES)).parse(formData.get("activity")), status: z.enum(["allowed", "allowed_with_conditions", "prohibited", "pending"]).parse(formData.get("status")), authorityId: zId.safeParse(formData.get("authorityId")).data ?? null, conditions: str(formData, "conditions", 600), expiryDate: date(formData, "expiryDate"), evidence: str(formData, "evidence", 600) }, actor);
  }, "Permission recorded.");
}

export async function withdrawKnowledgeAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "knowledge", async (p, actor) => {
    const recordId = zId.parse(formData.get("recordId"));
    const [r] = await appDb().select({ projectId: knowledgeRecords.projectId }).from(knowledgeRecords).where(eq(knowledgeRecords.id, recordId));
    if (r?.projectId !== p.id) throw new Error("Record not in this project");
    const activity = z.enum(keys(ACTIVITIES)).safeParse(formData.get("activity")).data;
    const w = await withdraw(appDb(), recordId, actor, str(formData, "reason", 600), activity);
    return `Withdrawal recorded. ${w.flagged} derivative output(s) flagged with remediation tasks.`;
  }, "Withdrawn.");
}

export async function addConsentAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "consent", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const disclosures = Object.fromEntries(Object.keys(DISCLOSURES).map(k => [k, bool(formData, `d_${k}`)]));
    const [r] = await appDb().insert(consentRecords).values({
      mandateId: c.mandateId, projectId: p.id, communityId: c.id, knowledgeRecordId: zId.safeParse(formData.get("knowledgeRecordId")).data ?? null,
      consentType: z.enum(keys(CONSENT_TYPES)).catch("fpic").parse(formData.get("consentType")), consentRequired: !bool(formData, "notRequired"), authorityId: zId.safeParse(formData.get("authorityId")).data ?? null,
      status: "not_started", scope: str(formData, "scope", 1000), disclosures, languageUsed: str(formData, "languageUsed", 80), interpreter: str(formData, "interpreter", 120), method: str(formData, "method", 200),
      withdrawalMechanism: str(formData, "withdrawalMechanism", 600), reconsentTriggers: str(formData, "reconsentTriggers", 600), reviewDate: date(formData, "reviewDate"), createdBy: actor,
    }).returning();
    await audit(appDb(), { actor, action: "consent.create", entity: "consent_record", entityId: r.id });
  }, "Consent record created (not started).");
}

export async function consentStatusAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "consent", async (p, actor) => {
    const id = zId.parse(formData.get("consentId"));
    const [c] = await appDb().select({ projectId: consentRecords.projectId }).from(consentRecords).where(eq(consentRecords.id, id));
    if (c?.projectId !== p.id) throw new Error("Consent record not in this project");
    const r = await setConsentStatus(appDb(), id, z.enum(keys(CONSENT_STATUS)).parse(formData.get("status")), actor, { note: str(formData, "note", 1000), evidence: str(formData, "evidence", 600) || undefined, date: date(formData, "date") ?? undefined, conditions: str(formData, "conditions", 1000) || undefined, expiryDate: date(formData, "expiryDate") ?? undefined });
    return r.warnings.length ? `Status recorded. ${r.warnings.join(" ")}` : "Status recorded.";
  }, "Status recorded.");
}

export async function addEngagementAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "consent", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const d = date(formData, "date");
    if (!d) throw new Error("Date is required");
    await appDb().insert(communityEngagements).values({ mandateId: c.mandateId, projectId: p.id, communityId: c.id, date: d, location: str(formData, "location", 200), format: z.enum(keys(ENGAGEMENT_FORMATS)).catch("meeting").parse(formData.get("format")), participants: str(formData, "participants", 600), facilitator: str(formData, "facilitator", 200), interpreter: str(formData, "interpreter", 200), topics: str(formData, "topics", 1000), concerns: str(formData, "concerns", 1000), requests: str(formData, "requests", 1000), commitmentsMade: str(formData, "commitmentsMade", 1000), nextAction: str(formData, "nextAction", 400), owner: str(formData, "owner", 200) || actor, dueDate: date(formData, "dueDate"), createdBy: actor });
  }, "Engagement recorded on the timeline.");
}

const terms = (f: FormData): StructureTerms => ({
  equityPct: num(f, "equityPct"), revenueSharePct: num(f, "revenueSharePct"), royaltyPct: num(f, "royaltyPct"), leasePerYear: num(f, "leasePerYear"), leaseEscalationPct: num(f, "leaseEscalationPct"),
  stewardshipPerYear: num(f, "stewardshipPerYear"), fundPctOfRevenue: num(f, "fundPctOfRevenue"), fixedPerYear: num(f, "fixedPerYear"),
  stakeFunding: z.enum(keys(STAKE_FUNDING)).nullable().catch(null).parse(f.get("stakeFunding") || null), stakeLoanRatePct: num(f, "stakeLoanRatePct"), downsideFloorPerYear: num(f, "downsideFloorPerYear"),
});

export async function addStructureAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "participation", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const type = z.enum(keys(PARTICIPATION_TYPES)).parse(formData.get("type"));
    const t = terms(formData);
    if (/equity/.test(type) && !t.equityPct) throw new Error("Equity structures need an equity %");
    if ((t.equityPct ?? 0) > 100 || (t.revenueSharePct ?? 0) > 100 || (t.royaltyPct ?? 0) > 100) throw new Error("Percentages must be ≤ 100");
    const [s] = await appDb().insert(participationStructures).values({ mandateId: c.mandateId, projectId: p.id, communityId: c.id, scenario: str(formData, "scenario", 60) || "Base", name: str(formData, "name", 160) || PARTICIPATION_TYPES[type], type, status: z.enum(keys(STRUCTURE_STATUS)).catch("concept").parse(formData.get("status")), basis: str(formData, "basis", 600), rationale: str(formData, "rationale", 1000), legalStructure: str(formData, "legalStructure", 300), terms: t, inflationIndexed: bool(formData, "inflationIndexed"), transferability: str(formData, "transferability", 300), changeOfControl: str(formData, "changeOfControl", 300), createdBy: actor }).returning();
    await audit(appDb(), { actor, action: "community.structure", entity: "participation_structure", entityId: s.id, after: { type, terms: t, scenario: s.scenario } });
  }, "Participation structure added.");
}

export async function structureStatusAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "participation", async (p, actor) => {
    const id = zId.parse(formData.get("structureId"));
    const status = z.enum(keys(STRUCTURE_STATUS)).parse(formData.get("status"));
    const [s] = await appDb().select().from(participationStructures).where(and(eq(participationStructures.id, id), eq(participationStructures.projectId, p.id)));
    if (!s) throw new Error("Structure not found");
    if ((status === "executed" || status === "active") && !str(formData, "agreement", 300) && !s.agreementId) throw new Error("Reference the executed agreement");
    await appDb().update(participationStructures).set({ status, notes: [s.notes, str(formData, "agreement", 300)].filter(Boolean).join(" · "), updatedBy: actor, updatedAt: new Date().toISOString() }).where(eq(participationStructures.id, id));
    await audit(appDb(), { actor, action: "community.structure_status", entity: "participation_structure", entityId: id, before: { status: s.status }, after: { status } });
  }, "Structure updated.");
}

export async function addGovernanceRightAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "participation", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    await appDb().insert(communityGovernanceRights).values({ mandateId: c.mandateId, projectId: p.id, communityId: c.id, rightType: z.enum(keys(GOVERNANCE_RIGHT_TYPES)).parse(formData.get("rightType")), governingDocument: str(formData, "governingDocument", 300), scope: str(formData, "scope", 600), trigger: str(formData, "trigger", 300), approvalRequired: bool(formData, "approvalRequired"), votingThreshold: str(formData, "votingThreshold", 120), scenario: str(formData, "scenario", 60) || "Base", createdBy: actor });
  }, "Governance right recorded.");
}

export async function addFundAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "ledgers", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const alloc = str(formData, "allocation", 1000).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).map(x => { const m = /^(.+?)\s*[:=]\s*([\d.]+)\s*%?$/.exec(x); if (!m) throw new Error(`Allocation "${x}" should look like "Education: 20"`); return { category: m[1], pct: Number(m[2]) }; });
    if (alloc.reduce((a, x) => a + x.pct, 0) > 100.001) throw new Error("Allocations exceed 100%");
    await appDb().insert(communityFunds).values({ mandateId: c.mandateId, projectId: p.id, communityId: c.id, name: str(formData, "name", 200), legalVehicle: str(formData, "legalVehicle", 200), governanceBody: str(formData, "governanceBody", 200), beneficiaries: str(formData, "beneficiaries", 400), allocationPolicy: alloc, spendingPolicy: str(formData, "spendingPolicy", 600), reservePolicy: str(formData, "reservePolicy", 600), trustee: str(formData, "trustee", 200), auditRequirement: str(formData, "auditRequirement", 300), balance: num(formData, "balance"), createdBy: actor });
  }, "Community fund recorded. Allocation rules are the community's, as entered.");
}

export async function addLedgerAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "ledgers", async (p, actor, scope) => {
    const c = await scopedCommunity(scope, zId.parse(formData.get("communityId")));
    const amount = num(formData, "amount");
    const d = date(formData, "date");
    if (!amount || !d) throw new Error("Amount and date are required");
    await appDb().insert(communityLedger).values({ mandateId: c.mandateId, projectId: p.id, communityId: c.id, structureId: zId.safeParse(formData.get("structureId")).data ?? null, ledger: z.enum(["mitigation", "participation", "development"]).parse(formData.get("ledger")), category: str(formData, "category", 200), description: str(formData, "description", 600), amount, currency: str(formData, "currency", 3).toUpperCase() || p.currency || "USD", date: d, status: z.enum(keys(LEDGER_ENTRY_STATUS)).catch("scheduled").parse(formData.get("status")), evidence: str(formData, "evidence", 400), createdBy: actor });
    await audit(appDb(), { actor, action: "community.ledger", entity: "project", entityId: p.id, after: { ledger: formData.get("ledger"), amount } });
  }, "Ledger entry recorded.");
}

export async function addCommitmentAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "commitments", async (p, actor) => {
    const communityId = zId.safeParse(formData.get("communityId")).data ?? null;
    await appDb().insert(communityCommitments).values({ mandateId: p.mandateId, projectId: p.id, communityId, source: str(formData, "source", 300), type: z.enum(keys(COMMITMENT_TYPES)).parse(formData.get("type")), description: str(formData, "description", 1000), owner: str(formData, "owner", 200) || null, beneficiary: str(formData, "beneficiary", 200), startDate: date(formData, "startDate"), dueDate: date(formData, "dueDate"), recurrence: z.enum(["none", "monthly", "quarterly", "annual"]).catch("none").parse(formData.get("recurrence")), amount: num(formData, "amount"), currency: str(formData, "currency", 3).toUpperCase() || p.currency || "USD", indexed: bool(formData, "indexed"), status: z.enum(keys(COMMITMENT_STATUS)).catch("proposed").parse(formData.get("status")), verificationRequired: bool(formData, "verificationRequired"), createdBy: actor });
  }, "Commitment recorded.");
}

export async function commitmentStatusAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "commitments", async (p, actor) => {
    const id = zId.parse(formData.get("commitmentId"));
    const status = z.enum(keys(COMMITMENT_STATUS)).parse(formData.get("status"));
    const evidence = str(formData, "evidence", 600);
    const [c] = await appDb().select().from(communityCommitments).where(and(eq(communityCommitments.id, id), eq(communityCommitments.projectId, p.id)));
    if (!c) throw new Error("Commitment not found");
    if (status === "fulfilled" && !evidence && !c.evidence) throw new Error("Fulfilment needs evidence");
    await appDb().update(communityCommitments).set({ status, evidence: evidence || c.evidence, verifiedBy: status === "fulfilled" && c.verificationRequired ? actor : c.verifiedBy, updatedBy: actor, updatedAt: new Date().toISOString() }).where(eq(communityCommitments.id, id));
    await audit(appDb(), { actor, action: "community.commitment_status", entity: "community_commitment", entityId: id, before: { status: c.status }, after: { status } });
  }, "Commitment updated.");
}

export async function addGrievanceAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "commitments", async (p, actor) => {
    const received = date(formData, "received");
    if (!received) throw new Error("Date received is required");
    await appDb().insert(communityGrievances).values({ mandateId: p.mandateId, projectId: p.id, communityId: zId.safeParse(formData.get("communityId")).data ?? null, received, channel: str(formData, "channel", 120), summary: str(formData, "summary", 1000), category: str(formData, "category", 120), owner: str(formData, "owner", 200) || actor, createdBy: actor });
  }, "Grievance recorded (confidential).");
}

export async function grievanceStatusAction(formData: FormData) {
  await onProject(await withOsUser(async u => ({ email: u.email, scope: u.scope })), formData, "commitments", async (p, actor) => {
    const id = zId.parse(formData.get("grievanceId"));
    const status = z.enum(keys(GRIEVANCE_STATUS)).parse(formData.get("status"));
    const response = str(formData, "response", 1000);
    if ((status === "resolved" || status === "closed") && !response) throw new Error("Record the response agreed with the complainant");
    await appDb().update(communityGrievances).set({ status, response, resolvedAt: status === "resolved" ? new Date().toISOString().slice(0, 10) : null, updatedBy: actor, updatedAt: new Date().toISOString() }).where(and(eq(communityGrievances.id, id), eq(communityGrievances.projectId, p.id)));
  }, "Grievance updated.");
}

/** Community alignment on a capital profile (explainable fit inputs). */
export async function saveCommunityAlignmentAction(formData: FormData) {
  const id = zId.parse(formData.get("profileId"));
  const back = str(formData, "back", 300) || "/capital";
  await withOsUser(async user => {
    const [cp] = await appDb().select({ id: capitalProfiles.id }).from(capitalProfiles).where(and(eq(capitalProfiles.id, id), mandateCondition(user.scope, capitalProfiles.mandateId)));
    if (!cp) throw new Error("Profile not found");
    const v = { flags: formData.getAll("flags").map(String).filter(x => x in ALIGNMENT_FLAGS), preference: z.enum(keys(CP_PREFERENCE)).catch("unknown").parse(formData.get("preference")), supported: formData.getAll("supported").map(String).filter(x => x in SUPPORTED_STRUCTURES), source: str(formData, "source", 400) };
    await appDb().update(capitalProfiles).set({ communityAlignment: v }).where(eq(capitalProfiles.id, id));
    await audit(appDb(), { actor: user.email, action: "capital.community_alignment", entity: "capital_profile", entityId: id, after: v });
  });
  redirect(note(back.startsWith("/") ? back : "/capital", "Community alignment saved."));
}
