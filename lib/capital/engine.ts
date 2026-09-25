// Capital relationships engine (docs/plans/phase-6.md M2): transparent matching that separates COMMERCIAL ALIGNMENT
// from REGULATORY ELIGIBILITY, the commitment ledger, capital formation without double counting, and the
// compliance gate for investment communications. Nothing here concludes that anything is "compliant".
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  capitalMandates, capitalMatches, capitalOpportunities, capitalProfiles, capitalRequirements, capitalTranches, commitmentEvents, commitments,
  contacts, investorQualifications, materialDeliveries, messages, privateCapitalProfiles, projects,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { COMMITMENT_STAGES, GATED_OUTREACH, QUALIFYING_STATUSES, type CommitmentStage, type GateState, type OutreachType } from "./vocab";

export type Criteria = { geographies: string[]; sectors: string[]; stages: string[]; instruments: string[]; ticketMin: number | null; ticketMax: number | null; currency: string | null };
export type MatchTarget = { country: string | null; sector: string | null; stage: string; instrument: string; ticketMin: number | null; ticketMax: number | null; currency: string };

const norm = (s: string) => s.trim().toLowerCase();
const REGIONS: Record<string, string[]> = {
  latam: ["mexico", "mex", "brazil", "bra", "colombia", "col", "peru", "per", "chile", "chl", "argentina", "arg", "ecuador", "ecu", "panama", "pan", "costa rica", "cri", "guatemala", "gtm", "uruguay", "ury", "paraguay", "pry", "bolivia", "bol", "honduras", "hnd", "el salvador", "slv", "nicaragua", "nic", "dominican republic", "dom"],
  "latin america": [], europe: ["spain", "esp", "portugal", "prt", "france", "fra", "germany", "deu", "italy", "ita", "netherlands", "nld", "united kingdom", "gbr", "ireland", "irl", "poland", "pol", "greece", "grc"],
  africa: ["kenya", "ken", "nigeria", "nga", "south africa", "zaf", "ghana", "gha", "egypt", "egy", "morocco", "mar", "ethiopia", "eth", "tanzania", "tza", "rwanda", "rwa", "senegal", "sen"],
  "north america": ["united states", "usa", "us", "canada", "can", "mexico", "mex"],
};
REGIONS["latin america"] = REGIONS.latam;

function geoCovers(list: string[], country: string | null) {
  if (!country) return null;
  const c = norm(country);
  return list.some(g => { const x = norm(g); return x === "global" || x === c || (REGIONS[x] ?? []).includes(c); });
}

/** Commercial alignment, 0–100, with reasons. An unknown criterion scores nothing and costs nothing. */
export function commercialFit(cr: Criteria, t: MatchTarget) {
  const reasons: string[] = [];
  let score = 0, known = 0;
  const dim = (weight: number, has: boolean, ok: boolean | null, yes: string, no: string, unknown: string) => {
    if (!has || ok === null) { reasons.push(unknown); return; }
    known += weight;
    if (ok) { score += weight; reasons.push(yes); } else reasons.push(no);
  };
  dim(25, cr.geographies.length > 0, geoCovers(cr.geographies, t.country), `Geography covers ${t.country}`, `Geography (${cr.geographies.join(", ")}) does not include ${t.country}`, "Geography not known");
  dim(20, cr.sectors.length > 0, t.sector ? cr.sectors.includes(t.sector) : null, `Sector ${t.sector} in mandate`, `Sector ${t.sector} not in mandate`, "Sector preference not known");
  dim(15, cr.stages.length > 0, cr.stages.includes(t.stage), `Invests at ${t.stage}`, `Does not invest at ${t.stage}`, "Stage appetite not known");
  dim(20, cr.instruments.length > 0, cr.instruments.includes(t.instrument), `Uses ${t.instrument}`, `Does not use ${t.instrument}`, "Instruments not known");
  const hasTicket = cr.ticketMin !== null || cr.ticketMax !== null;
  const want = t.ticketMin ?? t.ticketMax;
  const currencyOk = !cr.currency || !t.currency || cr.currency === t.currency;
  const ticketOk = want === null ? null : currencyOk && (cr.ticketMin === null || (t.ticketMax ?? want) >= cr.ticketMin) && (cr.ticketMax === null || want <= cr.ticketMax);
  dim(20, hasTicket, ticketOk, "Ticket range overlaps", `Ticket range ${cr.ticketMin ?? "?"}–${cr.ticketMax ?? "?"} ${cr.currency ?? ""} does not fit`, "Ticket range not known");
  return { score, reasons, completeness: known };
}

type Eligibility = { eligibility: "eligible" | "unknown" | "not_eligible" | "not_assessed"; reasons: string[] };

/** Regulatory eligibility from qualification records only: jurisdiction-specific, not expired, qualifying status. */
export async function eligibilityFor(db: Db, who: { contactId?: string | null; orgId?: string | null }, jurisdictions: string[], now = new Date()): Promise<Eligibility> {
  const conds = [who.contactId ? eq(investorQualifications.contactId, who.contactId) : undefined, who.orgId ? eq(investorQualifications.orgId, who.orgId) : undefined].filter(Boolean);
  if (!conds.length) return { eligibility: "not_assessed", reasons: ["No person or entity to assess"] };
  const quals = await db.select().from(investorQualifications).where(conds.length === 1 ? conds[0] : sql`${conds[0]} or ${conds[1]}`);
  if (!quals.length) return { eligibility: "unknown", reasons: ["No investor qualification on record: assessment required"] };
  if (!jurisdictions.length) return { eligibility: "unknown", reasons: ["The opportunity has no offering jurisdictions set"] };
  const today = now.toISOString().slice(0, 10);
  const reasons: string[] = [];
  let anyValid = false, anyNotEligible = false;
  for (const j of jurisdictions) {
    const inJ = quals.filter(q => norm(q.jurisdiction) === norm(j));
    if (!inJ.length) { reasons.push(`${j}: no qualification on record`); continue; }
    for (const q of inJ) {
      if (q.verificationStatus === "not_eligible") { anyNotEligible = true; reasons.push(`${j}: not eligible (${q.classification})`); continue; }
      if (q.expiresAt && q.expiresAt < today) { reasons.push(`${j}: ${q.classification} expired ${q.expiresAt}`); continue; }
      if ((QUALIFYING_STATUSES as readonly string[]).includes(q.verificationStatus)) { anyValid = true; reasons.push(`${j}: ${q.classification}, ${q.verificationStatus.replace(/_/g, " ")}${q.verifiedBy ? ` by ${q.verifiedBy}` : ""}${q.expiresAt ? `, until ${q.expiresAt}` : ""}`); }
      else reasons.push(`${j}: ${q.classification} is ${q.verificationStatus.replace(/_/g, " ")}`);
    }
  }
  reasons.push("Eligibility on record is not a legal conclusion; the offering's own review decides.");
  return { eligibility: anyValid ? "eligible" : anyNotEligible ? "not_eligible" : "unknown", reasons };
}

/** Target of an opportunity for matching. */
async function opportunityTarget(db: Db, opportunityId: string) {
  const [o] = await db.select().from(capitalOpportunities).where(eq(capitalOpportunities.id, opportunityId));
  if (!o) throw new Error("Capital opportunity not found");
  const [p] = await db.select().from(projects).where(eq(projects.id, o.projectId));
  const [tr] = o.trancheId ? await db.select().from(capitalTranches).where(eq(capitalTranches.id, o.trancheId)) : [];
  const [req] = o.requirementId ? await db.select().from(capitalRequirements).where(eq(capitalRequirements.id, o.requirementId)) : [];
  const target: MatchTarget = {
    country: p?.country ?? null, sector: p?.sector ?? null, stage: p?.stage ?? "opportunity", instrument: o.instrument, currency: o.currency,
    ticketMin: tr?.minParticipation ?? req?.minimum ?? null, ticketMax: tr?.maxParticipation ?? req?.maximum ?? o.target ?? null,
  };
  return { o, target };
}

/** Recomputes matches for one opportunity across the entity's capital and private profiles. Keeps each match's status. */
export async function runMatches(db: Db, opportunityId: string, now = new Date(), minScore = 40) {
  const { o, target } = await opportunityTarget(db, opportunityId);
  const profiles = await db.select().from(capitalProfiles).where(and(eq(capitalProfiles.mandateId, o.mandateId), isNull(capitalProfiles.archivedAt)));
  const mandatesByProfile = new Map<string, (typeof capitalMandates.$inferSelect)[]>();
  if (profiles.length) {
    for (const m of await db.select().from(capitalMandates).where(and(inArray(capitalMandates.profileId, profiles.map(p => p.id).slice(0, 90)), eq(capitalMandates.active, true)))) {
      mandatesByProfile.set(m.profileId, [...(mandatesByProfile.get(m.profileId) ?? []), m]);
    }
  }
  const privates = await db.select().from(privateCapitalProfiles).where(and(eq(privateCapitalProfiles.mandateId, o.mandateId), isNull(privateCapitalProfiles.archivedAt)));
  let written = 0;
  const upsert = async (investorKey: string, ids: { capitalProfileId?: string; privateProfileId?: string }, fit: ReturnType<typeof commercialFit>, el: Eligibility) => {
    if (fit.score < minScore) return;
    await db.insert(capitalMatches).values({ mandateId: o.mandateId, opportunityId, investorKey, ...ids, commercialScore: fit.score, commercialReasons: fit.reasons, eligibility: el.eligibility, eligibilityReasons: el.reasons })
      .onConflictDoUpdate({ target: [capitalMatches.opportunityId, capitalMatches.investorKey], set: { commercialScore: fit.score, commercialReasons: fit.reasons, eligibility: el.eligibility, eligibilityReasons: el.reasons, updatedAt: now.toISOString() } });
    written++;
  };
  for (const p of profiles) {
    const candidates = [p, ...(mandatesByProfile.get(p.id) ?? []).filter(m => !m.validTo || m.validTo >= now.toISOString().slice(0, 10))];
    const best = candidates.map(c => ({ c, fit: commercialFit(c, target) })).sort((a, b) => b.fit.score - a.fit.score)[0];
    if ("name" in best.c && best.c !== p) best.fit.reasons.unshift(`Mandate: ${best.c.name}`);
    const el = p.orgId || p.contactId ? await eligibilityFor(db, { orgId: p.orgId, contactId: p.contactId }, o.jurisdictions, now) : { eligibility: "not_assessed" as const, reasons: ["Institutional classification not recorded"] };
    await upsert(`profile:${p.id}`, { capitalProfileId: p.id }, best.fit, el.eligibility === "unknown" && p.capitalType !== "private_individual" && p.capitalType !== "family_office" ? { eligibility: "not_assessed", reasons: ["Institutional classification not recorded", ...el.reasons.slice(0, 1)] } : el);
  }
  for (const pp of privates) {
    const fit = commercialFit(pp, target);
    await upsert(`private:${pp.id}`, { privateProfileId: pp.id }, fit, await eligibilityFor(db, { contactId: pp.contactId, orgId: pp.vehicleOrgId }, o.jurisdictions, now));
  }
  return written;
}

const ORDER = Object.keys(COMMITMENT_STAGES) as CommitmentStage[];

/** Moves an investor to a stage on the ledger (one current row per investor per opportunity) and logs the event. */
export async function setCommitment(db: Db, input: { opportunityId: string; investorKey: string; stage: CommitmentStage; amount: number | null; evidence?: string; actor: string }, now = new Date()) {
  const [o] = await db.select({ mandateId: capitalOpportunities.mandateId, currency: capitalOpportunities.currency }).from(capitalOpportunities).where(eq(capitalOpportunities.id, input.opportunityId));
  if (!o) throw new Error("Capital opportunity not found");
  if ((input.stage === "commitment" || input.stage === "subscription" || input.stage === "funded") && !input.evidence) throw new Error("Commitments, subscriptions and funding need evidence (signed document, bank confirmation).");
  const ids = input.investorKey.startsWith("profile:") ? { capitalProfileId: input.investorKey.slice(8) } : input.investorKey.startsWith("private:") ? { privateProfileId: input.investorKey.slice(8) } : {};
  const [row] = await db.insert(commitments).values({ mandateId: o.mandateId, opportunityId: input.opportunityId, investorKey: input.investorKey, ...ids, stage: input.stage, amount: input.amount, currency: o.currency, evidence: input.evidence ?? "", updatedBy: input.actor })
    .onConflictDoUpdate({ target: [commitments.opportunityId, commitments.investorKey], set: { stage: input.stage, amount: input.amount, evidence: input.evidence ?? "", updatedBy: input.actor, updatedAt: now.toISOString() } })
    .returning();
  await db.insert(commitmentEvents).values({ commitmentId: row.id, mandateId: o.mandateId, stage: input.stage, amount: input.amount, evidence: input.evidence ?? "", actor: input.actor, at: now.toISOString() });
  await audit(db, { actor: input.actor, action: "commitment_stage", entity: "commitments", entityId: row.id, after: { stage: input.stage, amount: input.amount } });
  return row;
}

/** Capital formation for one opportunity: each investor counted once, at their current stage. */
export async function formation(db: Db, opportunityId: string) {
  const [o] = await db.select().from(capitalOpportunities).where(eq(capitalOpportunities.id, opportunityId));
  const matches = await db.select().from(capitalMatches).where(eq(capitalMatches.opportunityId, opportunityId));
  const rows = await db.select().from(commitments).where(eq(commitments.opportunityId, opportunityId));
  const live = rows.filter(r => r.stage !== "withdrawn");
  const atLeast = (s: CommitmentStage) => live.filter(r => ORDER.indexOf(r.stage) >= ORDER.indexOf(s));
  const sum = (xs: typeof rows) => xs.reduce((a, r) => a + (r.amount ?? 0), 0);
  return {
    target: o?.target ?? null, currency: o?.currency ?? "USD",
    identified: matches.length,
    matched: matches.filter(m => m.status === "shortlisted" || m.status === "approved_for_outreach").length,
    outreachApproved: matches.filter(m => m.status === "approved_for_outreach").length,
    interested: { investors: atLeast("interest").length, amount: sum(atLeast("interest")) },
    ioi: { investors: atLeast("ioi").length, amount: sum(atLeast("ioi")) },
    committed: { investors: atLeast("commitment").length, amount: sum(atLeast("commitment")) },
    funded: { investors: atLeast("funded").length, amount: sum(atLeast("funded")) },
  };
}

/** Sets the gate. APPROVED and NOT PERMITTED need a named reviewer and evidence. */
export async function setGate(db: Db, opportunityId: string, input: { state: GateState; reviewer?: string; evidence?: string; conditions?: string }, actor: string, now = new Date()) {
  if ((input.state === "approved" || input.state === "not_permitted" || input.state === "clear") && (!input.reviewer?.trim() || !input.evidence?.trim())) {
    throw new Error("Record who reviewed it (name and role, e.g. counsel) and the evidence before setting this state.");
  }
  const [before] = await db.select({ gateState: capitalOpportunities.gateState }).from(capitalOpportunities).where(eq(capitalOpportunities.id, opportunityId));
  await db.update(capitalOpportunities).set({ gateState: input.state, gateReviewer: input.reviewer ?? null, gateEvidence: input.evidence ?? "", gateConditions: input.conditions ?? "", gateReviewedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(capitalOpportunities.id, opportunityId));
  await audit(db, { actor, action: "capital_gate", entity: "capital_opportunities", entityId: opportunityId, before, after: { ...input } });
}

/**
 * The compliance gate for one outgoing message. Relationship outreach and project introductions pass; investment
 * communications, financial promotions and offering communications need: a linked opportunity with the gate
 * APPROVED, the recipient matched and approved for outreach, and (for private investors) eligibility on record.
 */
export async function gateCheck(db: Db, m: { outreachType: string; capitalOpportunityId: string | null; contactId: string }, now = new Date()) {
  const gated = GATED_OUTREACH.includes(m.outreachType as OutreachType) || !!m.capitalOpportunityId;
  if (!gated) return { ok: true as const, reasons: [] as string[] };
  const reasons: string[] = [];
  if (!m.capitalOpportunityId) return { ok: false as const, reasons: ["Investment communication without a capital opportunity"] };
  const [o] = await db.select().from(capitalOpportunities).where(eq(capitalOpportunities.id, m.capitalOpportunityId));
  if (!o) return { ok: false as const, reasons: ["Capital opportunity not found"] };
  if (o.gateState !== "approved") reasons.push(`Gate is ${o.gateState.replace(/_/g, " ")}, not approved`);
  const [c] = await db.select({ orgId: contacts.orgId }).from(contacts).where(eq(contacts.id, m.contactId));
  const [pp] = await db.select({ id: privateCapitalProfiles.id }).from(privateCapitalProfiles).where(and(eq(privateCapitalProfiles.contactId, m.contactId), eq(privateCapitalProfiles.mandateId, o.mandateId)));
  const [cp] = c?.orgId ? await db.select({ id: capitalProfiles.id }).from(capitalProfiles).where(and(eq(capitalProfiles.orgId, c.orgId), eq(capitalProfiles.mandateId, o.mandateId))) : [];
  const keys = [pp && `private:${pp.id}`, cp && `profile:${cp.id}`].filter(Boolean) as string[];
  const approved = keys.length ? await db.select({ key: capitalMatches.investorKey }).from(capitalMatches).where(and(eq(capitalMatches.opportunityId, o.id), inArray(capitalMatches.investorKey, keys), eq(capitalMatches.status, "approved_for_outreach"))) : [];
  if (!approved.length) reasons.push("Recipient is not approved for outreach on this opportunity");
  if (pp) {
    const el = await eligibilityFor(db, { contactId: m.contactId }, o.jurisdictions, now);
    if (el.eligibility !== "eligible") reasons.push(`Recipient eligibility: ${el.eligibility.replace(/_/g, " ")}`);
  }
  if (!o.approvedMaterials.length) reasons.push("No approved materials on the opportunity");
  return reasons.length ? { ok: false as const, reasons } : { ok: true as const, reasons: [] };
}

/** After a gated message is sent: record exactly which approved material versions the investor received. */
export async function recordDeliveryForMessage(db: Db, messageId: string, now = new Date()) {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m?.capitalOpportunityId) return 0;
  const [o] = await db.select().from(capitalOpportunities).where(eq(capitalOpportunities.id, m.capitalOpportunityId));
  if (!o) return 0;
  const [pp] = await db.select({ id: privateCapitalProfiles.id }).from(privateCapitalProfiles).where(eq(privateCapitalProfiles.contactId, m.contactId));
  const investorKey = pp ? `private:${pp.id}` : `contact:${m.contactId}`;
  for (const mat of o.approvedMaterials) {
    await db.insert(materialDeliveries).values({ mandateId: o.mandateId, opportunityId: o.id, investorKey, contactId: m.contactId, document: mat.title, version: mat.version, channel: "email", sentBy: m.approvedBy, sentAt: now.toISOString(), approvalRef: `Gate ${o.gateReviewer ?? ""} ${o.gateReviewedAt?.slice(0, 10) ?? ""}`.trim(), messageId });
  }
  return o.approvedMaterials.length;
}

/** Daily: qualifications past expiry become Expired, so the gate holds outreach to those investors. */
export async function expireQualifications(db: Db, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const r = await db.update(investorQualifications).set({ verificationStatus: "expired", updatedAt: now.toISOString() })
    .where(and(lt(investorQualifications.expiresAt, today), sql`${investorQualifications.verificationStatus} != 'expired'`)).returning({ id: investorQualifications.id });
  for (const q of r) await audit(db, { actor: "system", action: "qualification_expired", entity: "investor_qualifications", entityId: q.id });
  return r.length;
}
