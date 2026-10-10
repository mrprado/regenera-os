// Relationship development (phase 29B): match or create people and organizations without fuzzy auto-merges, record
// contacts captured by hand (events, LinkedIn, informal introductions) with their source and referrer, move the
// relationship pipeline, develop partnerships with evidence, and track introductions with authorization to share.
// Nobody becomes a client here: that follows an agreed engagement (relationships.ts).
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, organizations, partnerships, relationshipIntroductions, relationshipStatus, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { isFreeMail, normalizeEmail, normalizeOrgName, normalizePersonName, registrableDomain, splitName } from "@/lib/dedupe/normalize";
import { attribute } from "@/lib/flow/commercial";
import type { LEAD_SOURCES } from "@/lib/vocab";
import { recordStage } from "./pipeline";
import { addRole } from "./relationships";
import { PARTNERSHIP_FORWARD, PARTNERSHIP_KINDS, RELATIONSHIP_STAGES, type PartnershipStage, type RelationshipRole } from "./vocab";

type Source = keyof typeof LEAD_SOURCES;
const addDays = (n: number, from = new Date()) => new Date(from.getTime() + n * 86_400_000).toISOString();

/** Matches an organization by verified domain, then exact normalized name; creates one otherwise. Never fuzzy. */
export async function matchOrCreateOrg(db: Db, mandateId: string, input: { name?: string | null; email?: string | null; country?: string | null; source: Source }) {
  const domain = input.email ? registrableDomain(input.email.split("@")[1]) : null;
  const work = domain && !isFreeMail(domain) ? domain : null;
  if (work) { const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.domain, work))).limit(1); if (o) return { id: o.id, matched: "domain" as const }; }
  const name = (input.name ?? "").trim();
  if (!name) return null;
  const nn = normalizeOrgName(name);
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.nameNormalized, nn))).limit(1);
  if (o) return { id: o.id, matched: "name" as const };
  const [n] = await db.insert(organizations).values({ mandateId, name, nameNormalized: nn, domain: work, country: input.country || null, source: input.source }).returning({ id: organizations.id });
  return { id: n.id, matched: null };
}

/** Matches a person by email (exact), else creates. A same-name person without email is not merged automatically. */
export async function matchOrCreateContact(db: Db, mandateId: string, input: { name: string; email?: string | null; orgId?: string | null; title?: string | null; source: Source }) {
  const email = normalizeEmail(input.email);
  if (email) { const [c] = await db.select({ id: contacts.id, orgId: contacts.orgId }).from(contacts).where(and(eq(contacts.mandateId, mandateId), eq(contacts.emailLower, email))).limit(1); if (c) { if (!c.orgId && input.orgId) await db.update(contacts).set({ orgId: input.orgId }).where(eq(contacts.id, c.id)); return { id: c.id, matched: "email" as const }; } }
  const { first, last } = splitName(input.name);
  const [n] = await db.insert(contacts).values({ mandateId, orgId: input.orgId ?? null, firstName: first, lastName: last, fullName: input.name.trim(), nameNormalized: normalizePersonName(input.name), email: email, emailLower: email, title: input.title ?? null, source: input.source } as never).returning({ id: contacts.id });
  return { id: n.id, matched: null };
}

export async function ensureStatus(db: Db, mandateId: string, entityType: "contact" | "organization", entityId: string, by: string, owner?: string | null) {
  const [s] = await db.select().from(relationshipStatus).where(and(eq(relationshipStatus.mandateId, mandateId), eq(relationshipStatus.entityType, entityType), eq(relationshipStatus.entityId, entityId)));
  if (s) return s;
  const [n] = await db.insert(relationshipStatus).values({ mandateId, entityType, entityId, owner: owner ?? by, createdBy: by }).onConflictDoNothing().returning();
  if (n) await recordStage(db, { mandateId, pipeline: "relationship", entityType, entityId, from: null, to: "identified", reason: "First recorded", by });
  return n ?? (await db.select().from(relationshipStatus).where(and(eq(relationshipStatus.mandateId, mandateId), eq(relationshipStatus.entityType, entityType), eq(relationshipStatus.entityId, entityId))))[0];
}

/** Moves the relationship stage. Closing needs a reason; an active stage needs a next action or a reason for none. */
export async function setRelationshipStage(db: Db, mandateId: string, entityType: "contact" | "organization", entityId: string, stage: keyof typeof RELATIONSHIP_STAGES, input: { reason?: string; nextAction?: string; nextActionDue?: string | null; noActionReason?: string }, by: string) {
  const s = await ensureStatus(db, mandateId, entityType, entityId, by);
  const reason = (input.reason ?? "").trim();
  if ((stage === "closed" || stage === "dormant") && !reason) throw new Error(`${RELATIONSHIP_STAGES[stage]} needs a reason.`);
  const nextAction = input.nextAction?.trim() ?? s.nextAction;
  const noActionReason = input.noActionReason?.trim() || null;
  if (!["closed", "dormant"].includes(stage) && !nextAction && !noActionReason) throw new Error("Record a next action, or why none is scheduled.");
  const t = new Date().toISOString();
  await db.update(relationshipStatus).set({ stage, nextAction, nextActionDue: input.nextActionDue ?? s.nextActionDue, noActionReason, stageChangedAt: s.stage !== stage ? t : s.stageChangedAt, updatedAt: t }).where(eq(relationshipStatus.id, s.id));
  if (s.stage !== stage) await recordStage(db, { mandateId, pipeline: "relationship", entityType, entityId, from: s.stage, to: stage, reason, by });
}

/** A contact recorded by hand: keeps its source and referrer, gets a next action, is never made a client. */
export async function captureContact(db: Db, mandateId: string, input: {
  name: string; email?: string | null; organization?: string | null; title?: string | null; channel: string; referrerName?: string | null; referrerEmail?: string | null;
  note?: string; role?: RelationshipRole; nextAction: string; nextActionDue?: string | null; owner?: string | null;
}, by: string) {
  if (!input.name.trim()) throw new Error("A name is needed.");
  if (!input.nextAction.trim()) throw new Error("Record the next action (for example: send the intro deck, follow up after the event).");
  const source: Source = input.channel === "linkedin" ? "linkedin" : input.channel === "event" ? "event" : input.channel === "email" ? "email" : input.channel === "referral" || input.channel === "informal_introduction" ? "referral" : "other";
  const org = input.organization || input.email ? await matchOrCreateOrg(db, mandateId, { name: input.organization, email: input.email, source }) : null;
  const person = await matchOrCreateContact(db, mandateId, { name: input.name, email: input.email, orgId: org?.id, title: input.title, source });
  let introducerContactId: string | null = null;
  if (input.referrerName?.trim()) introducerContactId = (await matchOrCreateContact(db, mandateId, { name: input.referrerName, email: input.referrerEmail, source: "referral" })).id;
  await attribute(db, mandateId, { entityType: "contact", entityId: person.id, channel: input.channel === "event" ? "event" : input.channel === "referral" || input.channel === "informal_introduction" ? "referral" : "manual", introducerContactId, note: [input.channel, input.note].filter(Boolean).join(": ") }, by);
  if (org) await attribute(db, mandateId, { entityType: "organization", entityId: org.id, channel: "manual", introducerContactId, note: input.channel }, by);
  await addRole(db, { mandateId, entityType: "contact", entityId: person.id, role: input.role ?? "acquaintance", source: input.channel }, by);
  await ensureStatus(db, mandateId, "contact", person.id, by, input.owner);
  await db.update(relationshipStatus).set({ nextAction: input.nextAction, nextActionDue: input.nextActionDue ?? null, updatedAt: new Date().toISOString() }).where(and(eq(relationshipStatus.mandateId, mandateId), eq(relationshipStatus.entityType, "contact"), eq(relationshipStatus.entityId, person.id)));
  await db.insert(tasks).values({ mandateId, contactId: person.id, orgId: org?.id ?? null, type: "follow_up", title: `${input.name}: ${input.nextAction}`, dueAt: input.nextActionDue ? `${input.nextActionDue}T09:00:00.000Z` : addDays(7), owner: input.owner ?? by, workstream: `relationship:${person.id}` });
  await audit(db, { actor: by, action: "contact_captured", entity: "contacts", entityId: person.id, after: { channel: input.channel, matched: person.matched, referrer: !!introducerContactId } });
  return { contactId: person.id, orgId: org?.id ?? null, matched: person.matched };
}

// ---------- partnerships ----------
export async function upsertPartnership(db: Db, mandateId: string, orgId: string, kind: keyof typeof PARTNERSHIP_KINDS, patch: { capabilities?: string[]; geographies?: string[]; sectors?: string[]; capacity?: string; owner?: string | null }, by: string) {
  const [p] = await db.select().from(partnerships).where(and(eq(partnerships.mandateId, mandateId), eq(partnerships.orgId, orgId), eq(partnerships.kind, kind)));
  if (p) { await db.update(partnerships).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(partnerships.id, p.id)); return { ...p, ...patch }; }
  const [n] = await db.insert(partnerships).values({ mandateId, orgId, kind, ...patch, owner: patch.owner ?? by, createdBy: by }).returning();
  await addRole(db, { mandateId, entityType: "organization", entityId: orgId, role: kind === "referral" ? "referral_partner" : kind === "capital" ? "capital_partner" : "technical_partner", source: "partnership" }, by);
  await recordStage(db, { mandateId, pipeline: "partnership", entityType: "partnership", entityId: n.id, from: null, to: "potential", reason: "Partnership recorded", by });
  return n;
}

/** Partnership stages. Capability verified needs evidence; Agreed needs a contract or recorded agreement evidence; going
 *  live (Active) needs Agreed first. Terms are only what is written down: no referral fee is assumed. */
export async function movePartnership(db: Db, id: string, to: PartnershipStage, input: { evidence?: string; arrangement?: string; commercialTerms?: string; contractId?: string | null; reason?: string }, by: string) {
  const [p] = await db.select().from(partnerships).where(eq(partnerships.id, id));
  if (!p) throw new Error("Partnership not found");
  const from = p.stage;
  if (from === to) return p;
  const set: Partial<typeof partnerships.$inferInsert> = { stage: to, stageChangedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const back = PARTNERSHIP_FORWARD.indexOf(to) >= 0 && PARTNERSHIP_FORWARD.indexOf(from) > PARTNERSHIP_FORWARD.indexOf(to);
  if ((back || to === "closed") && !input.reason?.trim()) throw new Error(to === "closed" ? "Closing needs a reason." : "Moving back needs a reason.");
  const reached = (s: PartnershipStage) => PARTNERSHIP_FORWARD.indexOf(from) >= PARTNERSHIP_FORWARD.indexOf(s);
  if (to !== "closed" && PARTNERSHIP_FORWARD.indexOf(to) >= PARTNERSHIP_FORWARD.indexOf("capability_verified")) {
    if (!p.verifiedAt && to !== "capability_verified") throw new Error("Verify the partner's capability first.");
    if (to === "capability_verified") { if (!input.evidence?.trim()) throw new Error("Record the evidence for the capability (references, certifications, past work)."); Object.assign(set, { capabilityEvidence: input.evidence, verifiedBy: by, verifiedAt: new Date().toISOString() }); }
  }
  if (to === "proposed_arrangement") { if (!(input.arrangement ?? p.arrangement).trim()) throw new Error("Describe the proposed arrangement."); if (input.arrangement) set.arrangement = input.arrangement; }
  if (to === "agreed") {
    if (!input.contractId && !input.evidence?.trim()) throw new Error("Link the agreement or record its evidence.");
    Object.assign(set, { contractId: input.contractId ?? p.contractId, agreementEvidence: input.evidence ?? p.agreementEvidence, commercialTerms: input.commercialTerms ?? p.commercialTerms });
  }
  if ((to === "active" || to === "review") && !reached("agreed")) throw new Error("A partnership becomes active only after it is agreed.");
  await db.update(partnerships).set(set).where(eq(partnerships.id, id));
  await recordStage(db, { mandateId: p.mandateId, pipeline: "partnership", entityType: "partnership", entityId: id, from, to, reason: input.reason ?? "", evidence: input.evidence ?? "", by });
  await audit(db, { actor: by, action: "partnership_stage", entity: "partnerships", entityId: id, before: { stage: from }, after: { stage: to } });
  return { ...p, ...set };
}

// ---------- introductions ----------
const openKeyOf = (i: { mandateId: string; fromOrgId?: string | null; fromContactId?: string | null; toOrgId?: string | null; toContactId?: string | null; projectId?: string | null; purpose: string }) =>
  [i.mandateId, i.fromOrgId ?? i.fromContactId ?? "", i.toOrgId ?? i.toContactId ?? "", i.projectId ?? "", i.purpose.trim().toLowerCase().replace(/\s+/g, " ")].join("|");

/** Records an introduction. Sharing materials needs a recorded authorization; an open duplicate is refused. */
export async function createIntroduction(db: Db, input: { mandateId: string; fromOrgId?: string | null; fromContactId?: string | null; toOrgId?: string | null; toContactId?: string | null; partnershipId?: string | null; projectId?: string | null; engagementId?: string | null; purpose: string; authorization?: string; materialsShared?: string[]; date?: string | null; nextAction?: string; nextActionDue?: string | null }, by: string) {
  if (!input.purpose.trim()) throw new Error("State the purpose of the introduction.");
  if (!(input.fromOrgId || input.fromContactId) || !(input.toOrgId || input.toContactId)) throw new Error("Name both parties.");
  if ((input.materialsShared ?? []).length && !input.authorization?.trim()) throw new Error("Record who authorized sharing these materials before they are shared.");
  const openKey = openKeyOf(input);
  const [dup] = await db.select({ id: relationshipIntroductions.id }).from(relationshipIntroductions).where(eq(relationshipIntroductions.openKey, openKey));
  if (dup) throw new Error("This introduction is already open; update it instead.");
  const [n] = await db.insert(relationshipIntroductions).values({ ...input, materialsShared: input.materialsShared ?? [], authorization: input.authorization ?? "", nextAction: input.nextAction ?? "", openKey, owner: by, createdBy: by }).returning();
  await audit(db, { actor: by, action: "introduction_recorded", entity: "relationship_introductions", entityId: n.id, after: { purpose: input.purpose, materials: (input.materialsShared ?? []).length } });
  return n;
}

export async function setIntroductionOutcome(db: Db, id: string, outcome: "meeting_held" | "engaged" | "declined" | "no_response" | "withdrawn", note: string, by: string) {
  const [i] = await db.select().from(relationshipIntroductions).where(eq(relationshipIntroductions.id, id));
  if (!i) throw new Error("Introduction not found");
  const closed = ["engaged", "declined", "no_response", "withdrawn"].includes(outcome);
  await db.update(relationshipIntroductions).set({ outcome, outcomeNote: note, openKey: closed ? null : i.openKey, updatedAt: new Date().toISOString() }).where(eq(relationshipIntroductions.id, id));
  await audit(db, { actor: by, action: "introduction_outcome", entity: "relationship_introductions", entityId: id, after: { outcome } });
}

