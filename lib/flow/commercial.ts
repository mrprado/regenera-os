// Discovery-to-revenue connective tissue (extended specification §9–10, §18): account coverage, commercial
// qualification of opportunities, source attribution (original vs influence), effort, relationship reviews and campaign
// economics. Unknown stays unknown; relationship strength is never inferred from a contact merely existing; reviews are
// decisions for a person, not legal conclusions; conversions come from event history, never from current stage counts.
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  accountCoverage, accountQualifications, activities, aiRuns, attributions, contacts, deals, effortEntries, engagements, invoices, meetingNotes, opportunityQualifications,
  organizations, relationshipReviews, scanResults, scanRuns, QUALIFICATION_FIELDS, type QualificationField,
} from "@/db/schema";
import { checkConflicts } from "@/lib/crm/conflicts";

// ---------- account coverage ----------
export async function coverageFor(db: Db, mandateId: string, orgId: string) {
  const rows = await db.select({ c: accountCoverage, name: contacts.fullName, title: contacts.title }).from(accountCoverage).leftJoin(contacts, eq(contacts.id, accountCoverage.contactId))
    .where(and(eq(accountCoverage.mandateId, mandateId), eq(accountCoverage.orgId, orgId)));
  // Last interaction comes from recorded activity with that person, never from the contact existing.
  const ids = rows.map(r => r.c.contactId).filter(Boolean) as string[];
  const last = ids.length ? await db.select({ contactId: activities.contactId, at: sql<string>`max(${activities.occurredAt})` }).from(activities).where(and(eq(activities.mandateId, mandateId), inArray(activities.contactId, ids))).groupBy(activities.contactId) : [];
  return rows.map(r => ({ ...r, lastInteraction: last.find(l => l.contactId === r.c.contactId)?.at ?? r.c.lastInteractionAt ?? null }));
}

export async function setCoverage(db: Db, mandateId: string, orgId: string, role: string, input: { contactId: string | null; relationshipOwner: string | null; nextAction: string; evidence: string }, by: string) {
  if (input.contactId) {
    const [c] = await db.select({ orgId: contacts.orgId }).from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.mandateId, mandateId)));
    if (!c) throw new Error("Person not found in this workspace");
  }
  const t = new Date().toISOString();
  await db.insert(accountCoverage).values({ mandateId, orgId, role, ...input, updatedBy: by })
    .onConflictDoUpdate({ target: [accountCoverage.mandateId, accountCoverage.orgId, accountCoverage.role], set: { ...input, updatedBy: by, updatedAt: t } });
}

// ---------- commercial qualification ----------
/** The evidence a person needs before calling an opportunity qualified. */
export const REQUIRED_FOR_QUALIFIED: QualificationField[] = ["need", "buyer", "timing", "budgetPath", "agreedNextStep"];

export async function opportunityQualification(db: Db, mandateId: string, dealId: string) {
  const [q] = await db.select().from(opportunityQualifications).where(and(eq(opportunityQualifications.mandateId, mandateId), eq(opportunityQualifications.dealId, dealId)));
  return q ?? null;
}

export async function setQualificationField(db: Db, mandateId: string, dealId: string, field: QualificationField, text: string, evidence: string, by: string) {
  if (!(field in QUALIFICATION_FIELDS)) throw new Error("Unknown field");
  const t = new Date().toISOString();
  const q = await opportunityQualification(db, mandateId, dealId);
  const entry = { text: text.trim(), evidence: evidence.trim(), by, at: t };
  const change = `${QUALIFICATION_FIELDS[field]}: ${entry.text || "cleared"}`;
  if (!q) { await db.insert(opportunityQualifications).values({ mandateId, dealId, fields: entry.text ? { [field]: entry } : {}, history: [{ at: t, by, change }] }); return; }
  const fields = { ...q.fields };
  if (entry.text) fields[field] = entry; else delete fields[field];
  // Changing evidence after a decision reopens it: the decision was made on different facts.
  await db.update(opportunityQualifications).set({ fields, history: [...q.history, { at: t, by, change }], updatedAt: t, ...(q.decision !== "open" ? { decision: "open", reason: `Reopened: ${change}` } : {}) })
    .where(eq(opportunityQualifications.id, q.id));
}

export function qualificationGaps(fields: Partial<Record<QualificationField, { text: string; evidence: string }>>): string[] {
  return REQUIRED_FOR_QUALIFIED.filter(f => !fields[f]?.text || !fields[f]?.evidence).map(f => `${QUALIFICATION_FIELDS[f]} (with evidence)`);
}

export async function decideQualification(db: Db, mandateId: string, dealId: string, decision: "qualified" | "not_qualified", reason: string, by: string) {
  if (!reason.trim()) throw new Error("A reason is required.");
  const q = await opportunityQualification(db, mandateId, dealId);
  if (decision === "qualified") {
    const gaps = qualificationGaps(q?.fields ?? {});
    if (gaps.length) throw new Error(`Not yet: record ${gaps.join(", ")}.`);
  }
  const t = new Date().toISOString();
  if (!q) await db.insert(opportunityQualifications).values({ mandateId, dealId, decision, decidedBy: by, decidedAt: t, reason, history: [{ at: t, by, change: `Decision: ${decision}` }] });
  else await db.update(opportunityQualifications).set({ decision, decidedBy: by, decidedAt: t, reason, history: [...q.history, { at: t, by, change: `Decision: ${decision}. ${reason}` }], updatedAt: t }).where(eq(opportunityQualifications.id, q.id));
}

// ---------- attribution ----------
/** Records a source. The first row for a record is its original source; every later row is influence. */
export async function attribute(db: Db, mandateId: string, input: { entityType: "organization" | "contact" | "deal"; entityId: string; channel: string; campaign?: string | null; scanRunId?: string | null; introducerOrgId?: string | null; introducerContactId?: string | null; note?: string }, by: string) {
  const [first] = await db.select({ id: attributions.id }).from(attributions).where(and(eq(attributions.mandateId, mandateId), eq(attributions.entityType, input.entityType), eq(attributions.entityId, input.entityId))).limit(1);
  await db.insert(attributions).values({ mandateId, ...input, campaign: input.campaign ?? null, note: input.note ?? "", kind: first ? "influence" : "original", by });
}

export async function attributionFor(db: Db, mandateId: string, entityType: "organization" | "contact" | "deal", entityId: string) {
  return db.select().from(attributions).where(and(eq(attributions.mandateId, mandateId), eq(attributions.entityType, entityType), eq(attributions.entityId, entityId))).orderBy(asc(attributions.at));
}

// ---------- effort ----------
export async function logEffort(db: Db, mandateId: string, input: { campaign: string | null; dealId: string | null; minutes: number; on: string; note: string }, by: string) {
  if (!(input.minutes > 0 && input.minutes <= 24 * 60)) throw new Error("Minutes must be between 1 and 1440.");
  await db.insert(effortEntries).values({ mandateId, ...input, by });
}

// ---------- relationship ownership and reviews ----------
export async function setRelationshipOwner(db: Db, mandateId: string, orgId: string, owner: string | null, by: string) {
  const [o] = await db.select({ ownerEmail: organizations.ownerEmail }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.mandateId, mandateId)));
  if (!o) throw new Error("Organization not found");
  await db.update(organizations).set({ ownerEmail: owner, updatedAt: new Date().toISOString() }).where(eq(organizations.id, orgId));
  if (o.ownerEmail && owner !== o.ownerEmail) await db.insert(relationshipReviews).values({ mandateId, orgId, kind: "ownership", detail: `Owner changed from ${o.ownerEmail} to ${owner ?? "nobody"}`, status: "cleared", origin: "manual", raisedBy: by, decidedBy: by, decidedAt: new Date().toISOString(), reason: "Recorded change" });
}

/** Raises open reviews for conflicts the CRM can detect (open deal, other workspace, partner referral, active sequence,
 *  suppression). Idempotent per kind and detail; the person decides whether it is a real conflict. */
export async function raiseConflictReviews(db: Db, mandateId: string, orgId: string, by: string) {
  const [o] = await db.select({ domain: organizations.domain, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  if (!o) return 0;
  const found = await checkConflicts(db, mandateId, { orgId, domain: o.domain, name: o.name });
  const open = await db.select({ detail: relationshipReviews.detail }).from(relationshipReviews).where(and(eq(relationshipReviews.mandateId, mandateId), eq(relationshipReviews.orgId, orgId)));
  let n = 0;
  for (const c of found) {
    if (open.some(r => r.detail === c.detail)) continue;
    const kind = c.kind === "open_deal" ? "existing_client" : c.kind === "other_mandate" ? "competing_mandate" : c.kind === "partner_referral" ? "referral_claim" : c.kind === "suppressed" ? "exclusion" : "other";
    await db.insert(relationshipReviews).values({ mandateId, orgId, kind, detail: c.detail, origin: "auto", raisedBy: by, status: c.blocking ? "blocked" : "open" });
    n++;
  }
  return n;
}

export async function decideReview(db: Db, mandateId: string, id: string, status: "cleared" | "blocked", reason: string, by: string) {
  if (!reason.trim()) throw new Error("A reason is required.");
  await db.update(relationshipReviews).set({ status, reason, decidedBy: by, decidedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(and(eq(relationshipReviews.id, id), eq(relationshipReviews.mandateId, mandateId)));
}

// ---------- campaign economics ----------
export type CampaignRow = {
  campaign: string; discovered: number; reviewed: number; qualified: number; meetings: number; opportunities: number; reachedProposal: number; signed: number;
  signedFees: number; collected: number; credits: number; aiUsd: number; minutes: number;
};

/** Per campaign (scan preset or recorded campaign name), from event history: stage changes that happened, not where
 *  records sit today. Fees are Regenera's own (deal estimate, USD); collected is paid invoices on linked engagements. */
export async function campaignEconomics(db: Db, mandateIds: string[]): Promise<CampaignRow[]> {
  const ids = mandateIds.length ? mandateIds : ["-"];
  const [runs, origins, effort] = await Promise.all([
    db.select({ id: scanRuns.id, name: scanRuns.presetName, credits: scanRuns.creditsUsed }).from(scanRuns).where(inArray(scanRuns.mandateId, ids)),
    db.select().from(attributions).where(and(inArray(attributions.mandateId, ids), eq(attributions.kind, "original"))),
    db.select({ campaign: effortEntries.campaign, minutes: sql<number>`sum(${effortEntries.minutes})` }).from(effortEntries).where(inArray(effortEntries.mandateId, ids)).groupBy(effortEntries.campaign),
  ]);
  const runName = new Map(runs.map(r => [r.id, r.name || "Scan"]));
  const camp = (a: { campaign: string | null; scanRunId: string | null; channel: string }) => a.campaign ?? (a.scanRunId ? runName.get(a.scanRunId) ?? "Scan" : `(${a.channel})`);
  const rows = new Map<string, CampaignRow>();
  const row = (k: string) => { let r = rows.get(k); if (!r) { r = { campaign: k, discovered: 0, reviewed: 0, qualified: 0, meetings: 0, opportunities: 0, reachedProposal: 0, signed: 0, signedFees: 0, collected: 0, credits: 0, aiUsd: 0, minutes: 0 }; rows.set(k, r); } return r; };

  // Discovery: organizations each scan found, by the scan's name.
  const found = await db.select({ runId: scanResults.runId, orgId: scanResults.entityId, review: scanResults.review }).from(scanResults).where(and(inArray(scanResults.mandateId, ids), eq(scanResults.entityType, "organization")));
  const orgCampaign = new Map<string, string>();
  for (const o of origins.filter(a => a.entityType === "organization")) orgCampaign.set(o.entityId, camp(o));
  for (const f of found) { const k = orgCampaign.get(f.orgId) ?? runName.get(f.runId) ?? "Scan"; const r = row(k); r.discovered++; if (f.review === "accepted") r.reviewed++; if (!orgCampaign.has(f.orgId)) orgCampaign.set(f.orgId, k); }
  for (const r of runs) row(r.name || "Scan").credits += r.credits;
  const ai = await db.select({ entityId: aiRuns.entityId, usd: sql<number>`sum(${aiRuns.costUsd})` }).from(aiRuns).where(eq(aiRuns.entity, "scan_run")).groupBy(aiRuns.entityId);
  for (const a of ai) if (a.entityId && runName.has(a.entityId)) row(runName.get(a.entityId)!).aiUsd += a.usd;
  const quals = await db.select({ orgId: accountQualifications.orgId, status: accountQualifications.status }).from(accountQualifications).where(inArray(accountQualifications.mandateId, ids));
  for (const q of quals) if (["ready_for_outreach", "engaged", "qualified_opportunity"].includes(q.status) && orgCampaign.has(q.orgId)) row(orgCampaign.get(q.orgId)!).qualified++;
  const meet = await db.select({ orgId: meetingNotes.orgId }).from(meetingNotes).where(inArray(meetingNotes.mandateId, ids));
  for (const m of meet) if (m.orgId && orgCampaign.has(m.orgId)) row(orgCampaign.get(m.orgId)!).meetings++;

  // Opportunities: their own original source, else the organization's.
  const ds = await db.select({ id: deals.id, orgId: deals.orgId, value: deals.valueEstimate }).from(deals).where(and(inArray(deals.mandateId, ids), eq(deals.testRecord, false)));
  const dealOrigin = new Map(origins.filter(a => a.entityType === "deal").map(a => [a.entityId, camp(a)]));
  const stageEvents = ds.length ? await db.select({ dealId: activities.dealId, detail: activities.detail }).from(activities).where(and(inArray(activities.mandateId, ids), eq(activities.type, "stage_change"), like(activities.detail, "%→%"))) : [];
  const paid = await db.select({ dealId: engagements.dealId, paid: sql<number>`sum(${invoices.paidAmount})` }).from(invoices).innerJoin(engagements, eq(engagements.id, invoices.engagementId)).where(inArray(invoices.mandateId, ids)).groupBy(engagements.dealId);
  for (const d of ds) {
    const k = dealOrigin.get(d.id) ?? (d.orgId ? orgCampaign.get(d.orgId) : undefined);
    if (!k) continue;
    const r = row(k); r.opportunities++;
    const ev = stageEvents.filter(e => e.dealId === d.id).map(e => e.detail);
    if (ev.some(x => /→ (Proposal|Signed|Active)/.test(x))) r.reachedProposal++;
    if (ev.some(x => /→ (Signed|Active)/.test(x))) { r.signed++; r.signedFees += d.value ?? 0; }
    r.collected += paid.find(p => p.dealId === d.id)?.paid ?? 0;
  }
  for (const e of effort) row(e.campaign ?? "(no campaign)").minutes += e.minutes;
  return [...rows.values()].sort((a, b) => b.signedFees - a.signedFees || b.opportunities - a.opportunities || b.discovered - a.discovered);
}

export async function reviewsFor(db: Db, mandateId: string, orgId: string) {
  return db.select().from(relationshipReviews).where(and(eq(relationshipReviews.mandateId, mandateId), eq(relationshipReviews.orgId, orgId))).orderBy(desc(relationshipReviews.createdAt));
}

export const ATTRIBUTION_CHANNELS_KEYS = ["scan", "campaign", "referral", "inbound", "event", "signal", "import", "manual"] as const;
