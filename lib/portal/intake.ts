// Public intake (master build instruction §69): four professional forms whose submissions land in a review queue.
// Spam protection: honeypot (in the route), per-IP rate limit, validation. Nothing internal is shown after submitting.
// Conversion creates the canonical records; a broker becomes an Applied profile with a portal invite, never approved.
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { brokerProfiles, capitalProfiles, intakeSubmissions, networkProfiles, organizations, projectParties } from "@/db/schema";
import { audit } from "@/lib/audit";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { createProject } from "@/lib/projects/engine";
import { invitePortalUser } from "./auth";
import type { IntakeKind } from "./vocab";

const s = (max = 300) => z.string().trim().max(max).default("");
const base = { name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), organization: s(200), phone: s(40) };

export const INTAKE_SCHEMAS = {
  project: z.object({ ...base, projectName: z.string().trim().min(2).max(200), location: s(200), country: s(80), sector: s(80), stage: s(80), site: s(500), capacity: s(80), capitalNeed: s(200), documents: s(1000), help: s(3000) }),
  capital: z.object({ ...base, type: s(80), jurisdiction: s(80), geographies: s(500), sectors: s(500), stages: s(300), ticket: s(200), structures: s(500), mandate: s(3000) }),
  broker: z.object({ ...base, role: s(80), jurisdictions: s(300), licenses: s(500), markets: s(500), network: s(1000), experience: s(2000), purpose: s(2000) }),
  partner: z.object({ ...base, services: z.string().trim().min(2).max(1000), technologies: s(500), regions: s(500), team: s(1000), trackRecord: s(3000), certifications: s(1000) }),
} as const;

export const RATE_LIMIT = { perHour: 5 };

export async function submitIntake(db: Db, kind: IntakeKind, raw: Record<string, unknown>, ipHash: string, now = new Date()) {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(intakeSubmissions).where(and(eq(intakeSubmissions.ipHash, ipHash), gt(intakeSubmissions.createdAt, since)));
  if (n >= RATE_LIMIT.perHour) return { ok: false as const, reason: "rate" };
  const parsed = INTAKE_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) return { ok: false as const, reason: "invalid" };
  const { name, email, organization, ...rest } = parsed.data as Record<string, string>;
  const [r] = await db.insert(intakeSubmissions).values({ kind, name, email: email.toLowerCase(), organization, payload: rest, ipHash }).returning({ id: intakeSubmissions.id });
  return { ok: true as const, id: r.id };
}

const list = (v: string | undefined) => (v ?? "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 40);

async function upsertOrg(db: Db, mandateId: string, name: string, country?: string) {
  const nn = normalizeOrgName(name);
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.nameNormalized, nn)));
  if (o) return o.id;
  const [n] = await db.insert(organizations).values({ mandateId, name, nameNormalized: nn, country: country || null, source: "website" }).returning({ id: organizations.id });
  return n.id;
}

/** Turns a reviewed submission into records. Returns the created entity and, for brokers, a one-time invite token. */
export async function convertIntake(db: Db, submissionId: string, mandateId: string, actor: string) {
  const [x] = await db.select().from(intakeSubmissions).where(eq(intakeSubmissions.id, submissionId));
  if (!x) throw new Error("Submission not found");
  if (x.status === "converted") throw new Error("Already converted");
  const p = x.payload;
  let type = "", id = "", token: string | null = null;
  if (x.kind === "project") {
    const orgId = x.organization ? await upsertOrg(db, mandateId, x.organization, p.country) : null;
    const proj = await createProject(db, { mandateId, name: p.projectName, description: [p.help, p.site && `Site: ${p.site}`, p.capacity && `Capacity: ${p.capacity}`, p.capitalNeed && `Capital need (sponsor-provided): ${p.capitalNeed}`].filter(Boolean).join("\n\n"), country: p.country || null, municipality: p.location || null, originationSource: "Public intake", ownerEmail: actor }, actor);
    type = "project"; id = proj.id;
    if (orgId) { await db.insert(projectParties).values({ projectId: proj.id, mandateId, orgId, role: "sponsor", confirmed: "proposed", note: "From public intake" }); }
  } else if (x.kind === "capital") {
    const orgId = await upsertOrg(db, mandateId, x.organization || x.name, p.jurisdiction);
    const [cp] = await db.insert(capitalProfiles).values({ mandateId, orgId, name: x.organization || x.name, capitalType: "other", geographies: list(p.geographies), source: "Public intake (self-described; verify)", notes: [p.type && `Type: ${p.type}`, p.ticket && `Ticket: ${p.ticket}`, p.structures && `Structures: ${p.structures}`, p.stages && `Stages: ${p.stages}`, p.sectors && `Sectors: ${p.sectors}`, p.mandate].filter(Boolean).join("\n") }).returning({ id: capitalProfiles.id });
    type = "capital_profile"; id = cp.id;
  } else if (x.kind === "broker") {
    const orgId = x.organization ? await upsertOrg(db, mandateId, x.organization) : null;
    const inv = await invitePortalUser(db, { mandateId, email: x.email, name: x.name, kind: "broker", orgId }, actor);
    const [existing] = await db.select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.portalUserId, inv.user.id));
    if (!existing) await db.insert(brokerProfiles).values({ mandateId, portalUserId: inv.user.id, orgId, jurisdictions: list(p.jurisdictions).map(j => j.toUpperCase()), licenseStatus: p.licenses ? "claimed" : "none", registrationNumbers: p.licenses ?? "", specialties: p.network ?? "", geographies: p.markets ?? "", complianceStatus: "applied", reviewNote: [p.role && `Stated role: ${p.role}`, p.experience, p.purpose].filter(Boolean).join("\n") });
    type = "portal_user"; id = inv.user.id; token = inv.token;
  } else {
    const orgId = await upsertOrg(db, mandateId, x.organization || x.name);
    const [np] = await db.insert(networkProfiles).values({ mandateId, orgId, technologies: [p.services, p.technologies].filter(Boolean).join("; "), jurisdictions: list(p.regions), trackRecord: p.trackRecord ?? "", references: p.certifications ?? "" }).returning({ id: networkProfiles.id });
    type = "network_profile"; id = np.id;
  }
  await db.update(intakeSubmissions).set({ status: "converted", convertedType: type, convertedId: id, reviewedBy: actor, updatedAt: new Date().toISOString() }).where(eq(intakeSubmissions.id, x.id));
  await audit(db, { actor, action: "intake_converted", entity: "intake_submissions", entityId: x.id, after: { type, id } });
  return { type, id, token };
}
