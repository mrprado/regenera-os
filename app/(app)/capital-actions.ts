"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  capitalMandates, capitalMatches, capitalOpportunities, capitalProfiles, capitalRequirements, capitalTranches, contacts, debtSecurities,
  introductions, investorQualifications, privateCapitalProfiles, projects,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { runMatches, setCommitment, setGate } from "@/lib/capital/engine";
import { APPETITE, CAPITAL_TYPES, COMMITMENT_STAGES, GATE_STATES, INTRO_STATUSES, INVESTOR_JOURNEY, MATCH_STATUSES, QUALIFICATION_STATUSES, RELATIONSHIP_STRENGTH } from "@/lib/capital/vocab";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { INSTRUMENTS, PROJECT_STAGES } from "@/lib/projects/vocab";
import { SECTORS } from "@/lib/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const opt = (f: FormData, k: string, max = 300) => str(f, k, max) || null;
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const pick = <T extends Record<string, string>>(o: T, f: FormData, k: string) => { const v = str(f, k); return (v in o ? v : null) as (keyof T & string) | null; };
const csv = (f: FormData, k: string) => str(f, k, 2000).split(",").map(s => s.trim()).filter(Boolean).slice(0, 40);
const multi = <T extends Record<string, string>>(o: T, f: FormData, k: string) => f.getAll(k).map(String).filter(v => v in o).slice(0, 40);
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Criteria fields shared by profiles, mandates and private profiles. */
const criteria = (f: FormData) => ({
  geographies: csv(f, "geographies"), sectors: multi(SECTORS, f, "sectors"), stages: multi(PROJECT_STAGES, f, "stages"), instruments: multi(INSTRUMENTS, f, "instruments"),
  ticketMin: num(f, "ticketMin"), ticketMax: num(f, "ticketMax"), currency: (opt(f, "currency", 8) ?? "").toUpperCase() || null,
});
const entityOf = (user: { scope: { mandateIds: string[] } }, f: FormData) => {
  const m = str(f, "mandateId") || user.scope.mandateIds[0];
  if (!user.scope.mandateIds.includes(m)) throw new Error("Not your entity");
  return m;
};

// ---------- institutional and other capital partners ----------

export async function createCapitalProfileAction(formData: FormData) {
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  const capitalType = z.enum(keys(CAPITAL_TYPES)).parse(formData.get("capitalType"));
  let target = "/capital";
  await withOsUser(async user => {
    const mandateId = entityOf(user, formData);
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
    const [row] = await appDb().insert(capitalProfiles).values({ mandateId, name, capitalType, orgId, ...criteria(formData), source: str(formData, "source", 300), relationshipOwner: user.email }).returning();
    await audit(appDb(), { actor: user.email, action: "capital_profile_created", entity: "capital_profiles", entityId: row.id });
    target = note(`/capital/partners/${row.id}`, "Capital partner created. Unknown criteria stay empty: they neither help nor hurt a match.");
  });
  redirect(target);
}

export async function updateCapitalProfileAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const [p] = await appDb().select().from(capitalProfiles).where(and(eq(capitalProfiles.id, id), mandateCondition(user.scope, capitalProfiles.mandateId)));
    if (!p) throw new Error("Not found");
    await appDb().update(capitalProfiles).set({
      name: str(formData, "name", 200) || p.name, capitalType: pick(CAPITAL_TYPES, formData, "capitalType") ?? p.capitalType, ...criteria(formData),
      technologies: csv(formData, "technologies"), risk: str(formData, "risk", 500), returnTarget: str(formData, "returnTarget", 300), tenor: str(formData, "tenor", 200),
      impact: str(formData, "impact", 1000), esRequirements: str(formData, "esRequirements", 1000), localContent: str(formData, "localContent", 500),
      relationshipStrength: pick(RELATIONSHIP_STRENGTH, formData, "relationshipStrength") ?? p.relationshipStrength, nextAction: opt(formData, "nextAction", 300),
      nextActionDate: date(formData, "nextActionDate"), source: str(formData, "source", 300), notes: str(formData, "notes", 4000),
      lastVerifiedAt: formData.get("verified") === "on" ? new Date().toISOString() : p.lastVerifiedAt, updatedAt: new Date().toISOString(),
    }).where(eq(capitalProfiles.id, id));
    await audit(appDb(), { actor: user.email, action: "capital_profile_updated", entity: "capital_profiles", entityId: id });
  });
  redirect(note(`/capital/partners/${id}`, "Saved."));
}

export async function addCapitalMandateAction(formData: FormData) {
  const profileId = zId.parse(formData.get("profileId"));
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  await withOsUser(async user => {
    const [p] = await appDb().select().from(capitalProfiles).where(and(eq(capitalProfiles.id, profileId), mandateCondition(user.scope, capitalProfiles.mandateId)));
    if (!p) throw new Error("Not found");
    await appDb().insert(capitalMandates).values({ mandateId: p.mandateId, profileId, name, ...criteria(formData), validFrom: date(formData, "validFrom"), validTo: date(formData, "validTo"), source: str(formData, "source", 300), lastVerifiedAt: new Date().toISOString() });
  });
  redirect(note(`/capital/partners/${profileId}`, "Mandate added. Matching uses the best-fitting active mandate."));
}

// ---------- private capital (owner only) ----------

export async function createPrivateProfileAction(formData: FormData) {
  const contactId = zId.parse(formData.get("contactId"));
  let target = "/capital?tab=private";
  await withOsUser(async user => {
    const [c] = await appDb().select({ mandateId: contacts.mandateId }).from(contacts).where(and(eq(contacts.id, contactId), mandateCondition(user.scope, contacts.mandateId)));
    if (!c) throw new Error("Person not found");
    const [row] = await appDb().insert(privateCapitalProfiles).values({ mandateId: c.mandateId, contactId, relationshipOwner: user.email, relationshipSource: str(formData, "relationshipSource", 300) }).onConflictDoNothing().returning();
    if (row) await audit(appDb(), { actor: user.email, action: "private_profile_created", entity: "private_capital_profiles", entityId: row.id });
    target = row ? note(`/capital/private/${row.id}`, "Private capital profile created. Record only what the person has told you; unknown stays unknown.") : note("/capital?tab=private", "This person already has a profile.");
  }, { owner: true });
  redirect(target);
}

export async function updatePrivateProfileAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const [p] = await appDb().select().from(privateCapitalProfiles).where(and(eq(privateCapitalProfiles.id, id), mandateCondition(user.scope, privateCapitalProfiles.mandateId)));
    if (!p) throw new Error("Not found");
    const patch = {
      ...criteria(formData), assetClasses: csv(formData, "assetClasses"), relationshipSource: str(formData, "relationshipSource", 300),
      relationshipStrength: pick(RELATIONSHIP_STRENGTH, formData, "relationshipStrength") ?? p.relationshipStrength, primaryJurisdiction: opt(formData, "primaryJurisdiction", 40),
      vehicleJurisdiction: opt(formData, "vehicleJurisdiction", 40), preferredChannel: opt(formData, "preferredChannel", 80), horizon: str(formData, "horizon", 200),
      incomePreference: pick(APPETITE, formData, "incomePreference") ?? "unknown", growthPreference: pick(APPETITE, formData, "growthPreference") ?? "unknown",
      impactInterests: str(formData, "impactInterests", 1000), developmentAppetite: pick(APPETITE, formData, "developmentAppetite") ?? "unknown",
      constructionAppetite: pick(APPETITE, formData, "constructionAppetite") ?? "unknown", operatingAppetite: pick(APPETITE, formData, "operatingAppetite") ?? "unknown",
      knownRiskAppetite: str(formData, "knownRiskAppetite", 500), constraints: str(formData, "constraints", 1000), privateNotes: str(formData, "privateNotes", 4000),
      journeyStage: pick(INVESTOR_JOURNEY, formData, "journeyStage") ?? p.journeyStage, nextAction: opt(formData, "nextAction", 300), nextActionDate: date(formData, "nextActionDate"),
      lastVerifiedAt: formData.get("verified") === "on" ? new Date().toISOString() : p.lastVerifiedAt, updatedAt: new Date().toISOString(),
    };
    await appDb().update(privateCapitalProfiles).set(patch).where(eq(privateCapitalProfiles.id, id));
    await audit(appDb(), { actor: user.email, action: "private_profile_updated", entity: "private_capital_profiles", entityId: id, before: { journeyStage: p.journeyStage }, after: { journeyStage: patch.journeyStage, reason: str(formData, "reason", 300) } });
  }, { owner: true });
  redirect(note(`/capital/private/${id}`, "Saved."));
}

export async function addQualificationAction(formData: FormData) {
  const back = z.string().startsWith("/capital").catch("/capital").parse(formData.get("back"));
  const jurisdiction = z.string().trim().min(2).max(40).parse(formData.get("jurisdiction"));
  const classification = z.string().trim().min(2).max(200).parse(formData.get("classification"));
  const verificationStatus = z.enum(keys(QUALIFICATION_STATUSES)).parse(formData.get("verificationStatus"));
  await withOsUser(async user => {
    const contactId = zId.safeParse(formData.get("contactId")).data ?? null;
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
    if (!contactId && !orgId) throw new Error("Person or entity required");
    const table = contactId ? contacts : null;
    const [owner] = contactId && table ? await appDb().select({ mandateId: contacts.mandateId }).from(contacts).where(and(eq(contacts.id, contactId), mandateCondition(user.scope, contacts.mandateId))) : [{ mandateId: user.scope.mandateIds[0] }];
    if (!owner) throw new Error("Not found");
    if (["third_party_verified", "professionally_verified"].includes(verificationStatus) && !str(formData, "verifiedBy")) throw new Error("Verified statuses need who verified.");
    const [row] = await appDb().insert(investorQualifications).values({
      mandateId: owner.mandateId, contactId, orgId, jurisdiction: jurisdiction.toUpperCase(), classification, definitionVersion: str(formData, "definitionVersion", 200),
      assessmentStatus: str(formData, "assessmentStatus", 200), verificationStatus, method: str(formData, "method", 300), verifiedBy: opt(formData, "verifiedBy", 200),
      verifiedAt: date(formData, "verifiedAt"), expiresAt: date(formData, "expiresAt"), evidenceRef: str(formData, "evidenceRef", 500), restrictions: str(formData, "restrictions", 1000),
    }).returning();
    await audit(appDb(), { actor: user.email, action: "qualification_recorded", entity: "investor_qualifications", entityId: row.id, after: { jurisdiction, classification, verificationStatus } });
  }, { owner: true });
  redirect(note(back, "Qualification recorded. It applies to that jurisdiction and classification only, until its expiry."));
}

// ---------- capital opportunities ----------

export async function createOpportunityAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let target = `/projects/${projectId}?tab=capital`;
  await withOsUser(async user => {
    const [p] = await appDb().select().from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    const trancheId = zId.safeParse(formData.get("trancheId")).data ?? null;
    const requirementId = zId.safeParse(formData.get("requirementId")).data ?? null;
    const [tr] = trancheId ? await appDb().select().from(capitalTranches).where(eq(capitalTranches.id, trancheId)) : [];
    const [req] = await appDb().select().from(capitalRequirements).where(eq(capitalRequirements.id, tr?.requirementId ?? requirementId ?? ""));
    if (!req || req.projectId !== projectId) throw new Error("Requirement not found");
    const [row] = await appDb().insert(capitalOpportunities).values({
      mandateId: p.mandateId, projectId, requirementId: req.id, trancheId: tr?.id ?? null, title: `${p.name}: ${tr?.name ?? req.purpose}`,
      instrument: tr?.instrument ?? req.instrument, target: tr?.target ?? req.target, currency: tr?.currency ?? req.currency,
    }).returning();
    await audit(appDb(), { actor: user.email, action: "capital_opportunity_created", entity: "capital_opportunities", entityId: row.id });
    target = note(`/capital/opportunities/${row.id}`, "Capital opportunity created. The gate starts at Review required: set roles, jurisdictions and approved materials, then record the review.");
  });
  redirect(target);
}

export async function updateOpportunityAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const [o] = await appDb().select().from(capitalOpportunities).where(and(eq(capitalOpportunities.id, id), mandateCondition(user.scope, capitalOpportunities.mandateId)));
    if (!o) throw new Error("Not found");
    const jurisdictions = csv(formData, "jurisdictions").map(j => j.toUpperCase());
    const changedScope = JSON.stringify(jurisdictions) !== JSON.stringify(o.jurisdictions) || str(formData, "offering", 4000) !== o.offering;
    await appDb().update(capitalOpportunities).set({
      title: str(formData, "title", 300) || o.title, offering: str(formData, "offering", 4000), jurisdictions,
      issuerOrgId: zId.safeParse(formData.get("issuerOrgId")).data ?? null, sponsorOrgId: zId.safeParse(formData.get("sponsorOrgId")).data ?? null,
      arranger: str(formData, "arranger", 200), placementParty: str(formData, "placementParty", 200), counsel: str(formData, "counsel", 200),
      financialAdvisor: str(formData, "financialAdvisor", 200), regeneraRole: str(formData, "regeneraRole", 200) || o.regeneraRole,
      status: (["draft", "active", "closed"] as const).find(s => s === str(formData, "status")) ?? o.status,
      // Changing who it is offered to, or what is offered, reopens the review.
      ...(changedScope && o.gateState === "approved" ? { gateState: "review_required" as const } : {}),
      updatedAt: new Date().toISOString(),
    }).where(eq(capitalOpportunities.id, id));
    await audit(appDb(), { actor: user.email, action: "capital_opportunity_updated", entity: "capital_opportunities", entityId: id, after: { jurisdictions, reopened: changedScope && o.gateState === "approved" } });
  });
  redirect(note(`/capital/opportunities/${id}`, "Saved."));
}

export async function setGateAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const state = z.enum(keys(GATE_STATES)).parse(formData.get("state"));
  let msg = `Gate set to ${GATE_STATES[state]}.`;
  await withOsUser(async user => {
    const [o] = await appDb().select({ id: capitalOpportunities.id }).from(capitalOpportunities).where(and(eq(capitalOpportunities.id, id), mandateCondition(user.scope, capitalOpportunities.mandateId)));
    if (!o) throw new Error("Not found");
    try { await setGate(appDb(), id, { state, reviewer: str(formData, "reviewer", 200), evidence: str(formData, "evidence", 2000), conditions: str(formData, "conditions", 2000) }, user.email); }
    catch (e) { msg = errorText(e); }
  }, { owner: true });
  redirect(note(`/capital/opportunities/${id}`, msg));
}

export async function addMaterialAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const title = z.string().trim().min(2).max(200).parse(formData.get("title"));
  const version = z.string().trim().min(1).max(40).parse(formData.get("version"));
  await withOsUser(async user => {
    const [o] = await appDb().select().from(capitalOpportunities).where(and(eq(capitalOpportunities.id, id), mandateCondition(user.scope, capitalOpportunities.mandateId)));
    if (!o) throw new Error("Not found");
    const materials = [...o.approvedMaterials.filter(m => m.title !== title), { title, version, ref: str(formData, "ref", 500) }];
    // New or changed material means a fresh review before investment communications go out.
    await appDb().update(capitalOpportunities).set({ approvedMaterials: materials, ...(o.gateState === "approved" ? { gateState: "review_required" as const } : {}), updatedAt: new Date().toISOString() }).where(eq(capitalOpportunities.id, id));
    await audit(appDb(), { actor: user.email, action: "capital_material_added", entity: "capital_opportunities", entityId: id, after: { title, version } });
  });
  redirect(note(`/capital/opportunities/${id}`, "Material recorded. The gate returns to Review required until the new version is reviewed."));
}

export async function runMatchesAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let n = 0;
  await withOsUser(async user => {
    const [o] = await appDb().select({ id: capitalOpportunities.id }).from(capitalOpportunities).where(and(eq(capitalOpportunities.id, id), mandateCondition(user.scope, capitalOpportunities.mandateId)));
    if (!o) throw new Error("Not found");
    n = await runMatches(appDb(), id);
  });
  redirect(note(`/capital/opportunities/${id}`, `${n} ${n === 1 ? "investor" : "investors"} with a commercial fit of 40 or more. Regulatory eligibility is shown separately.`));
}

export async function matchStatusAction(formData: FormData) {
  const matchId = zId.parse(formData.get("matchId"));
  const status = z.enum(keys(MATCH_STATUSES)).parse(formData.get("status"));
  let opportunityId = "";
  let msg = `Marked ${MATCH_STATUSES[status].toLowerCase()}.`;
  await withOsUser(async user => {
    const [m] = await appDb().select({ m: capitalMatches, gate: capitalOpportunities.gateState }).from(capitalMatches)
      .innerJoin(capitalOpportunities, eq(capitalOpportunities.id, capitalMatches.opportunityId))
      .where(and(eq(capitalMatches.id, matchId), mandateCondition(user.scope, capitalMatches.mandateId)));
    if (!m) throw new Error("Not found");
    opportunityId = m.m.opportunityId;
    if (status === "approved_for_outreach" && m.gate !== "approved") { msg = "Approve the gate on this opportunity first: investors cannot be approved for outreach while it is under review."; return; }
    if (status === "approved_for_outreach" && m.m.eligibility === "not_eligible") { msg = "This investor is recorded as not eligible for this offering."; return; }
    await appDb().update(capitalMatches).set({ status, updatedAt: new Date().toISOString() }).where(eq(capitalMatches.id, matchId));
    await audit(appDb(), { actor: user.email, action: "capital_match_status", entity: "capital_matches", entityId: matchId, before: { status: m.m.status }, after: { status } });
  });
  redirect(note(`/capital/opportunities/${opportunityId}`, msg));
}

export async function setCommitmentAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const investorKey = z.string().regex(/^(profile|private):[0-9a-f-]{36}$/).parse(formData.get("investorKey"));
  const stage = z.enum(keys(COMMITMENT_STAGES)).parse(formData.get("stage"));
  let msg = `Ledger updated: ${COMMITMENT_STAGES[stage]}.`;
  await withOsUser(async user => {
    const [o] = await appDb().select({ id: capitalOpportunities.id }).from(capitalOpportunities).where(and(eq(capitalOpportunities.id, id), mandateCondition(user.scope, capitalOpportunities.mandateId)));
    if (!o) throw new Error("Not found");
    try { await setCommitment(appDb(), { opportunityId: id, investorKey, stage, amount: num(formData, "amount"), evidence: str(formData, "evidence", 1000), actor: user.email }); }
    catch (e) { msg = errorText(e); }
  });
  redirect(note(`/capital/opportunities/${id}`, msg));
}

// ---------- introductions and bonds ----------

export async function addIntroductionAction(formData: FormData) {
  const fromContactId = zId.parse(formData.get("fromContactId"));
  const back = z.string().startsWith("/").catch("/capital?tab=introductions").parse(formData.get("back"));
  await withOsUser(async user => {
    const [c] = await appDb().select({ mandateId: contacts.mandateId }).from(contacts).where(and(eq(contacts.id, fromContactId), mandateCondition(user.scope, contacts.mandateId)));
    if (!c) throw new Error("Introducer not found");
    const compensation = formData.get("compensation") === "on";
    await appDb().insert(introductions).values({
      mandateId: c.mandateId, fromContactId, toContactId: zId.safeParse(formData.get("toContactId")).data ?? null, toOrgId: zId.safeParse(formData.get("toOrgId")).data ?? null,
      date: date(formData, "date"), context: str(formData, "context", 1000), projectId: zId.safeParse(formData.get("projectId")).data ?? null,
      status: pick(INTRO_STATUSES, formData, "status") ?? "requested", compensation, reviewStatus: compensation ? "review_required" : "not_required", notes: str(formData, "notes", 2000),
    });
  });
  redirect(note(back, formData.get("compensation") === "on" ? "Introduction recorded. COMPENSATION / REGULATORY REVIEW REQUIRED before anything is paid or promised." : "Introduction recorded."));
}

export async function introductionReviewedAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await appDb().update(introductions).set({ reviewStatus: "reviewed", notes: str(formData, "notes", 2000), updatedAt: new Date().toISOString() }).where(and(eq(introductions.id, id), mandateCondition(user.scope, introductions.mandateId)));
    await audit(appDb(), { actor: user.email, action: "introduction_reviewed", entity: "introductions", entityId: id, after: { notes: str(formData, "notes", 2000) } });
  }, { owner: true });
  redirect(note("/capital?tab=introductions", "Review recorded."));
}

export async function createDebtSecurityAction(formData: FormData) {
  const program = z.string().trim().min(2).max(200).parse(formData.get("program"));
  await withOsUser(async user => {
    const mandateId = entityOf(user, formData);
    const [row] = await appDb().insert(debtSecurities).values({
      mandateId, program, instrument: str(formData, "instrument", 80) || "bond", currency: (str(formData, "currency", 8) || "USD").toUpperCase(), issueSize: num(formData, "issueSize"),
      minDenomination: num(formData, "minDenomination"), coupon: str(formData, "coupon", 80), couponType: str(formData, "couponType", 80), maturity: date(formData, "maturity"),
      issuerOrgId: zId.safeParse(formData.get("issuerOrgId")).data ?? null, projectId: zId.safeParse(formData.get("projectId")).data ?? null,
      jurisdictions: csv(formData, "jurisdictions"), offeringRestrictions: str(formData, "offeringRestrictions", 2000), eligibleRecipients: str(formData, "eligibleRecipients", 1000),
      useOfProceeds: str(formData, "useOfProceeds", 2000), isin: opt(formData, "isin", 20), trustee: str(formData, "trustee", 200), arranger: str(formData, "arranger", 200),
      placementAgent: str(formData, "placementAgent", 200), counsel: str(formData, "counsel", 200), seniority: str(formData, "seniority", 200), security: str(formData, "security", 500),
    }).returning();
    await audit(appDb(), { actor: user.email, action: "debt_security_created", entity: "debt_securities", entityId: row.id });
  });
  redirect(note("/capital?tab=bonds", "Bond / note program recorded. Regenera is not the issuer, arranger or placement agent unless recorded as such by counsel."));
}
