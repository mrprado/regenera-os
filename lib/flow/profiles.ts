// Party profiles (extended specification §4): common organization fields stay on organizations; role-specific facts
// live here, each value with its basis. Headquarters is never operating coverage: coverage is its own field with its
// own basis. One organization can hold several role profiles (an EPC can also be a referral partner).
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { organizations, partyProfiles, type Basis } from "@/db/schema";

export const BASIS_LABELS: Record<Basis, string> = { verified: "Verified", stated: "Stated by the party", provider: "Provider data", inferred: "Inferred", unknown: "Unknown" };

type Field = { key: string; label: string; hint?: string };
const F = (key: string, label: string, hint?: string): Field => ({ key, label, hint });

export const PROFILE_ROLES: Record<string, { label: string; fields: Field[] }> = {
  epc: { label: "EPC / contractor", fields: [
    F("technologies", "Technologies and capabilities", "solar PV, BESS, substations, water…"), F("scope", "Scope delivered", "engineering, procurement, construction, commissioning, O&M, turnkey"),
    F("sizeRange", "Preferred size range", "MW or contract value, with currency"), F("procurement", "Procurement preferences", "public tenders, private contracts"),
    F("contractRole", "Contract role", "prime, subcontractor, consortium"), F("credentials", "Credentials, licences, certifications (with expiry)"),
    F("projects", "Relevant completed projects (authorized proof only)"), F("capacity", "Available capacity and earliest mobilization"),
    F("bonding", "Bonding / insurance capacity"), F("exclusions", "Commercial exclusions"), F("objective", "What they want from Regenera", "win contracts, consortium partners, origination support"),
  ] },
  developer: { label: "Developer / sponsor", fields: [
    F("assetClasses", "Asset classes"), F("stages", "Development stages"), F("sizeRange", "Typical project size"), F("siteAccess", "Land / site access"),
    F("constraints", "Development constraints"), F("deliveryNeeds", "Delivery needs"), F("capitalNeeds", "Capital requirements"), F("trackRecord", "Track record"), F("decisionMakers", "Decision makers"),
  ] },
  capital_provider: { label: "Capital provider", fields: [
    F("type", "Organization type", "fund, family office, PE, lender, DFI, foundation, strategic"), F("strategy", "Investment strategy"), F("sectors", "Sectors"), F("stages", "Project / company stage"),
    F("ticket", "Ticket range and currency"), F("instruments", "Instruments"), F("control", "Ownership / control preferences"), F("returns", "Return or impact requirements (only when stated)"),
    F("timing", "Deployment timing"), F("exclusions", "Exclusions"), F("vehicle", "Fund / vintage or vehicle"), F("mandateSource", "Stated mandate source and date"), F("introductionRoute", "Introduction route"),
  ] },
  landowner: { label: "Landowner", fields: [
    F("parcels", "Parcels / boundaries"), F("tenure", "Ownership / tenure evidence"), F("rights", "Rights and access"), F("objectives", "Objectives"), F("infrastructure", "Infrastructure"),
    F("uses", "Existing uses"), F("constraints", "Constraints"), F("stakeholders", "Stakeholders"), F("gaps", "Verification gaps"),
  ] },
  public_body: { label: "Public body / community / NGO", fields: [
    F("authority", "Authority and jurisdiction"), F("objective", "Public or community objective"), F("route", "Procurement or funding route"), F("governance", "Governance and decision process"),
    F("stakeholders", "Stakeholders"), F("capacity", "Implementation capacity"), F("consultation", "Applicable consultation requirements"),
  ] },
  adviser: { label: "Adviser / referral partner", fields: [
    F("expertise", "Expertise"), F("clients", "Client base and needs"), F("terms", "Collaboration terms (only when agreed)"), F("referralValue", "Referral value"), F("conflicts", "Conflicts to check"),
  ] },
};

export async function profilesFor(db: Db, mandateId: string, orgId: string) {
  return db.select().from(partyProfiles).where(and(eq(partyProfiles.mandateId, mandateId), eq(partyProfiles.orgId, orgId)));
}

async function orgInWorkspace(db: Db, mandateId: string, orgId: string) {
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.mandateId, mandateId)));
  if (!o) throw new Error("Organization not found in this workspace");
}

/** Saves a role profile. Values left blank are removed; each value keeps its basis and source. */
export async function saveProfile(db: Db, mandateId: string, orgId: string, role: string, input: { values: Record<string, { value: string; basis: Basis; source?: string }>; coverage: string[]; coverageBasis: Basis }, by: string, now = new Date()) {
  const def = PROFILE_ROLES[role];
  if (!def) throw new Error("Unknown profile role");
  await orgInWorkspace(db, mandateId, orgId);
  const t = now.toISOString();
  const [existing] = await db.select().from(partyProfiles).where(and(eq(partyProfiles.mandateId, mandateId), eq(partyProfiles.orgId, orgId), eq(partyProfiles.role, role)));
  const fields: Record<string, { value: string; basis: Basis; source?: string; at: string; by: string }> = {};
  for (const f of def.fields) {
    const v = input.values[f.key];
    if (!v || !v.value.trim()) continue;
    const prev = existing?.fields[f.key];
    // Unchanged values keep their original timestamp and author; changed ones are re-attributed.
    fields[f.key] = prev && prev.value === v.value.trim() && prev.basis === v.basis ? prev : { value: v.value.trim(), basis: v.basis, ...(v.source ? { source: v.source } : {}), at: t, by };
  }
  if (existing) await db.update(partyProfiles).set({ fields, coverage: input.coverage, coverageBasis: input.coverageBasis, reviewedBy: by, reviewedAt: t, updatedAt: t }).where(eq(partyProfiles.id, existing.id));
  else await db.insert(partyProfiles).values({ mandateId, orgId, role, fields, coverage: input.coverage, coverageBasis: input.coverageBasis, owner: by, reviewedBy: by, reviewedAt: t });
}
