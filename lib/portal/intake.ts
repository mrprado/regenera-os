// Public intake (master build instruction §69): four professional forms whose submissions land in a review queue.
// Spam protection: honeypot (in the route), per-IP rate limit, validation. Nothing internal is shown after submitting.
// Conversion creates the canonical records; a broker becomes an Applied profile with a portal invite, never approved.
import { emitEvent } from "@/lib/events/engine";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { brokerProfiles, capitalProfiles, deals, intakeSubmissions, networkProfiles, projectParties, tasks } from "@/db/schema";
import { attribute } from "@/lib/flow/commercial";
import { ensureStatus, matchOrCreateContact, matchOrCreateOrg, upsertPartnership } from "@/lib/lifecycle/network";
import { recordStage } from "@/lib/lifecycle/pipeline";
import { addRole } from "@/lib/lifecycle/relationships";
import type { RelationshipRole } from "@/lib/lifecycle/vocab";
import { audit } from "@/lib/audit";
import { createProject } from "@/lib/projects/engine";
import { invitePortalUser } from "./auth";
import { INTAKE_KINDS, type IntakeKind } from "./vocab";

const s = (max = 300) => z.string().trim().max(max).default("");
const base = { name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), organization: s(200), phone: s(40) };

export const INTAKE_SCHEMAS = {
  project: z.object({ ...base, projectName: z.string().trim().min(2).max(200), location: s(200), country: s(80), sector: s(80), stage: s(80), site: s(500), capacity: s(80), capitalNeed: s(200), documents: s(1000), help: s(3000) }),
  capital: z.object({ ...base, type: s(80), jurisdiction: s(80), geographies: s(500), sectors: s(500), stages: s(300), ticket: s(200), structures: s(500), mandate: s(3000) }),
  broker: z.object({ ...base, role: s(80), jurisdictions: s(300), licenses: s(500), markets: s(500), network: s(1000), experience: s(2000), purpose: s(2000) }),
  partner: z.object({ ...base, services: z.string().trim().min(2).max(1000), technologies: s(500), regions: s(500), team: s(1000), trackRecord: s(3000), certifications: s(1000) }),
  // Phase 29B
  advisory: z.object({ ...base, need: z.string().trim().min(5).max(3000), sector: s(80), geography: s(200), timing: s(200), budget: s(200), decision: s(1000) }),
  ai_implementation: z.object({ ...base, problem: z.string().trim().min(5).max(3000), users: s(500), systems: s(1000), data: s(1000), timing: s(200), budget: s(200) }),
  referral: z.object({ ...base, referredName: z.string().trim().min(2).max(120), referredEmail: z.string().trim().email().max(254).or(z.literal("")).default(""), referredOrganization: s(200), context: z.string().trim().min(5).max(3000), referredAware: s(10) }),
} as const;

/** Campaign and page details kept with a submission. Values are short strings from the form or headers. */
export type IntakeMeta = { attribution?: Record<string, string>; consent?: string };
const DEDUPE_HOURS = 24;
async function sha(sv: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sv)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }

export const RATE_LIMIT = { perHour: 5 };

export async function submitIntake(db: Db, kind: IntakeKind, raw: Record<string, unknown>, ipHash: string, now = new Date(), meta: IntakeMeta = {}) {
  const parsed = INTAKE_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) return { ok: false as const, reason: "invalid" };
  const { name, email, organization, ...rest } = parsed.data as Record<string, string>;
  // The same person sending the same form content again within a day is the same submission, not a new one.
  const dedupeKey = await sha([kind, email.toLowerCase(), JSON.stringify(Object.entries(rest).sort())].join("|"));
  const [dup] = await db.select({ id: intakeSubmissions.id }).from(intakeSubmissions).where(and(eq(intakeSubmissions.dedupeKey, dedupeKey), gt(intakeSubmissions.createdAt, new Date(now.getTime() - DEDUPE_HOURS * 3_600_000).toISOString()))).limit(1);
  if (dup) return { ok: true as const, id: dup.id, duplicate: true };
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(intakeSubmissions).where(and(eq(intakeSubmissions.ipHash, ipHash), gt(intakeSubmissions.createdAt, since)));
  if (n >= RATE_LIMIT.perHour) return { ok: false as const, reason: "rate" };
  const attribution = Object.fromEntries(Object.entries(meta.attribution ?? {}).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k.slice(0, 40), v.trim().slice(0, 300)]));
  const consent = meta.consent && ["none", "respond", "updates"].includes(meta.consent) ? meta.consent : "respond";
  const [r] = await db.insert(intakeSubmissions).values({ kind, name, email: email.toLowerCase(), organization, payload: rest, ipHash, attribution, consent, dedupeKey, createdAt: now.toISOString() }).returning({ id: intakeSubmissions.id });
  await emitEvent(db, { mandateId: REGENERA_MANDATE_ID, type: "INTAKE_RECEIVED", entityType: "intake", entityId: r.id, payload: { name, kind, organization }, actor: "public" });
  // A review task for the owner, so the enquiry is qualified or declined rather than forgotten.
  await db.insert(tasks).values({ mandateId: REGENERA_MANDATE_ID, type: "follow_up", title: `Review ${INTAKE_KINDS[kind].toLowerCase()}: ${name}${organization ? ` (${organization})` : ""}`, body: "Open Portals → Intake to qualify, convert or decline.", dueAt: new Date(now.getTime() + 86_400_000).toISOString(), workstream: `intake:${r.id}` });
  return { ok: true as const, id: r.id, duplicate: false };
}

const list = (v: string | undefined) => (v ?? "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 40);

async function upsertOrg(db: Db, mandateId: string, name: string, country?: string, email?: string) {
  return (await matchOrCreateOrg(db, mandateId, { name, email, country, source: "website" }))!.id;
}

const ROLE_FOR: Record<IntakeKind, RelationshipRole> = { project: "sponsor", capital: "capital_partner", broker: "referral_partner", partner: "technical_partner", advisory: "prospect", ai_implementation: "prospect", referral: "referral_partner" };

/** Converts a submission; a failure is kept on the submission (nothing is lost) and the error is returned. */
export async function convertIntake(db: Db, submissionId: string, mandateId: string, actor: string) {
  try { return await convertIntakeInner(db, submissionId, mandateId, actor); }
  catch (e) {
    const msg = (e as Error).message;
    if (msg !== "Already converted") await db.update(intakeSubmissions).set({ conversionError: msg.slice(0, 500), updatedAt: new Date().toISOString() }).where(eq(intakeSubmissions.id, submissionId));
    throw e;
  }
}

/** Turns a reviewed submission into records. Returns the created entity and, for brokers, a one-time invite token. */
async function convertIntakeInner(db: Db, submissionId: string, mandateId: string, actor: string) {
  const [x] = await db.select().from(intakeSubmissions).where(eq(intakeSubmissions.id, submissionId));
  if (!x) throw new Error("Submission not found");
  if (x.status === "converted") throw new Error("Already converted");
  const p = x.payload;
  let type = "", id = "", token: string | null = null;
  // Phase 29B: the submitter is matched (email, then work domain or exact name) or created, with the original source.
  const org = x.organization || x.email ? await matchOrCreateOrg(db, mandateId, { name: x.organization || null, email: x.email, source: "website" }) : null;
  const person = await matchOrCreateContact(db, mandateId, { name: x.name, email: x.email, orgId: org?.id, source: "website" });
  const a = x.attribution ?? {};
  const campaign = [a.utm_source, a.utm_medium, a.utm_campaign].filter(Boolean).join(" / ") || null;
  const sourceNote = [`Intake: ${INTAKE_KINDS[x.kind]}`, a.landing && `landing ${a.landing}`, a.referrer && `referrer ${a.referrer}`, a.heard && `said: ${a.heard}`, `consent: ${x.consent}`].filter(Boolean).join(" · ");
  await attribute(db, mandateId, { entityType: "contact", entityId: person.id, channel: x.kind === "referral" ? "referral" : "inbound", campaign, note: sourceNote }, actor);
  if (org) await attribute(db, mandateId, { entityType: "organization", entityId: org.id, channel: "inbound", campaign, note: sourceNote }, actor);
  await addRole(db, { mandateId, entityType: "contact", entityId: person.id, role: ROLE_FOR[x.kind], source: "intake" }, actor);
  if (org) await addRole(db, { mandateId, entityType: "organization", entityId: org.id, role: ROLE_FOR[x.kind], source: "intake" }, actor);
  await ensureStatus(db, mandateId, "contact", person.id, actor);
  const deal = async (name: string, projectId: string | null) => {
    const [d] = await db.insert(deals).values({ mandateId, orgId: org?.id ?? null, contactId: person.id, projectId, name, path: "project_diagnostic", stage: "lead", commercialStage: "need_identified", source: "website", nextAction: "Qualify: need, buyer, budget path, timing", nextActionDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) } as never).returning({ id: deals.id });
    await attribute(db, mandateId, { entityType: "deal", entityId: d.id, channel: "inbound", campaign, note: sourceNote }, actor);
    await recordStage(db, { mandateId, pipeline: "commercial", entityType: "deal", entityId: d.id, from: null, to: "need_identified", reason: `From intake (${INTAKE_KINDS[x.kind]})`, by: actor });
    await db.insert(tasks).values({ mandateId, dealId: d.id, contactId: person.id, orgId: org?.id ?? null, projectId, type: "follow_up", title: `Qualify ${name}`, body: "Record need, buyer, budget path and timing with evidence, then decide.", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), owner: actor, workstream: `deal:${d.id}` });
    return d.id;
  };
  if (x.kind === "advisory" || x.kind === "ai_implementation") {
    type = "deal"; id = await deal(`${x.organization || x.name}: ${x.kind === "advisory" ? "advisory" : "AI implementation"}`, null);
  } else if (x.kind === "referral") {
    const referredOrg = p.referredOrganization || p.referredEmail ? await matchOrCreateOrg(db, mandateId, { name: p.referredOrganization || null, email: p.referredEmail || null, source: "referral" }) : null;
    const referred = await matchOrCreateContact(db, mandateId, { name: p.referredName, email: p.referredEmail || null, orgId: referredOrg?.id, source: "referral" });
    await attribute(db, mandateId, { entityType: "contact", entityId: referred.id, channel: "referral", introducerContactId: person.id, introducerOrgId: org?.id ?? null, note: `Referred by ${x.name}: ${p.context}${p.referredAware ? "" : " (referred person may not know yet)"}` }, actor);
    await addRole(db, { mandateId, entityType: "contact", entityId: referred.id, role: "prospect", source: "referral" }, actor);
    await ensureStatus(db, mandateId, "contact", referred.id, actor);
    await db.insert(tasks).values({ mandateId, contactId: referred.id, type: "follow_up", title: `Referral from ${x.name}: ${p.referredName}`, body: p.referredAware ? "The referrer says they know about the introduction." : "Confirm with the referrer that the referred person agrees to be contacted.", dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), owner: actor, workstream: `relationship:${referred.id}` });
    type = "contact"; id = referred.id;
  } else if (x.kind === "project") {
    const orgId = org?.id ?? null;
    const proj = await createProject(db, { mandateId, name: p.projectName, description: [p.help, p.site && `Site: ${p.site}`, p.capacity && `Capacity: ${p.capacity}`, p.capitalNeed && `Capital need (sponsor-provided): ${p.capitalNeed}`].filter(Boolean).join("\n\n"), country: p.country || null, municipality: p.location || null, originationSource: "Public intake", ownerEmail: actor }, actor);
    type = "project"; id = proj.id;
    if (orgId) { await db.insert(projectParties).values({ projectId: proj.id, mandateId, orgId, role: "sponsor", confirmed: "proposed", note: "From public intake" }); }
    await deal(`${p.projectName}: diagnostic`, proj.id);
  } else if (x.kind === "capital") {
    const orgId = org?.id ?? await upsertOrg(db, mandateId, x.organization || x.name, p.jurisdiction);
    const [cp] = await db.insert(capitalProfiles).values({ mandateId, orgId, name: x.organization || x.name, capitalType: "other", geographies: list(p.geographies), source: "Public intake (self-described; verify)", notes: [p.type && `Type: ${p.type}`, p.ticket && `Ticket: ${p.ticket}`, p.structures && `Structures: ${p.structures}`, p.stages && `Stages: ${p.stages}`, p.sectors && `Sectors: ${p.sectors}`, p.mandate].filter(Boolean).join("\n") }).returning({ id: capitalProfiles.id });
    type = "capital_profile"; id = cp.id;
  } else if (x.kind === "broker") {
    const orgId = org?.id ?? null;
    const inv = await invitePortalUser(db, { mandateId, email: x.email, name: x.name, kind: "broker", orgId }, actor);
    const [existing] = await db.select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.portalUserId, inv.user.id));
    if (!existing) await db.insert(brokerProfiles).values({ mandateId, portalUserId: inv.user.id, orgId, jurisdictions: list(p.jurisdictions).map(j => j.toUpperCase()), licenseStatus: p.licenses ? "claimed" : "none", registrationNumbers: p.licenses ?? "", specialties: p.network ?? "", geographies: p.markets ?? "", complianceStatus: "applied", reviewNote: [p.role && `Stated role: ${p.role}`, p.experience, p.purpose].filter(Boolean).join("\n") });
    type = "portal_user"; id = inv.user.id; token = inv.token;
  } else {
    const orgId = org?.id ?? await upsertOrg(db, mandateId, x.organization || x.name, undefined, x.email);
    await upsertPartnership(db, mandateId, orgId, "technical", { capabilities: list(p.services).concat(list(p.technologies)).slice(0, 30), geographies: list(p.regions) }, actor);
    const [np] = await db.insert(networkProfiles).values({ mandateId, orgId, technologies: [p.services, p.technologies].filter(Boolean).join("; "), jurisdictions: list(p.regions), trackRecord: p.trackRecord ?? "", references: p.certifications ?? "" }).returning({ id: networkProfiles.id });
    type = "network_profile"; id = np.id;
  }
  await db.update(intakeSubmissions).set({ status: "converted", convertedType: type, convertedId: id, reviewedBy: actor, conversionError: null, updatedAt: new Date().toISOString() }).where(eq(intakeSubmissions.id, x.id));
  await audit(db, { actor, action: "intake_converted", entity: "intake_submissions", entityId: x.id, after: { type, id } });
  return { type, id, token };
}
