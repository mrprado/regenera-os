// LinkedIn extension support (SPEC section 24, docs/plans/phase-3.md item 4). Per-user tokens are shown once,
// stored only as SHA-256 hashes and revocable. The extension acts only on the profile Prado has open and
// clicks on: it never crawls, never clicks anything on LinkedIn and never sends messages itself.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { contacts, extensionTokens, mandateMembers, organizations, tasks } from "@/db/schema";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { toBase64Url } from "@/lib/crypto";
import { canonicalLinkedin, normalizeOrgName, normalizePersonName } from "@/lib/dedupe/normalize";
import { completeTask } from "@/lib/outreach/tasks";

async function sha256(value: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function issueExtensionToken(db: Db, userEmail: string, label = "Chrome"): Promise<string> {
  const token = `rox_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await db.insert(extensionTokens).values({ userEmail: userEmail.toLowerCase(), tokenHash: await sha256(token), label });
  return token;
}

export async function revokeExtensionToken(db: Db, id: string, userEmail: string) {
  await db.update(extensionTokens).set({ revokedAt: new Date().toISOString() }).where(and(eq(extensionTokens.id, id), eq(extensionTokens.userEmail, userEmail.toLowerCase())));
}

/** Returns the user's email and mandates for a valid, unrevoked token, else null. */
export async function verifyExtensionToken(db: Db, header: string | null): Promise<{ email: string; mandateIds: string[] } | null> {
  const token = header?.match(/^Bearer\s+(rox_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const [row] = await db.select().from(extensionTokens).where(and(eq(extensionTokens.tokenHash, await sha256(token)), isNull(extensionTokens.revokedAt)));
  if (!row) return null;
  const mandates = await db.select({ id: mandateMembers.mandateId }).from(mandateMembers).where(eq(mandateMembers.email, row.userEmail));
  if (!mandates.length) return null;
  await db.update(extensionTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(extensionTokens.id, row.id));
  return { email: row.userEmail, mandateIds: mandates.map(m => m.id) };
}

export const zExtensionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lookup"), url: z.string().url() }),
  z.object({
    action: z.literal("capture"),
    profile: z.object({
      url: z.string().url(), name: z.string().trim().min(1).max(200), headline: z.string().max(400).default(""),
      location: z.string().max(200).default(""), company: z.string().max(200).default(""), title: z.string().max(200).default(""),
    }),
  }),
  z.object({ action: z.literal("mark_sent"), taskId: z.string().uuid() }),
]);
export type ExtensionRequest = z.infer<typeof zExtensionRequest>;

async function contactView(db: Db, contactId: string) {
  const [c] = await db.select({ id: contacts.id, fullName: contacts.fullName, title: contacts.title, orgId: contacts.orgId, leadState: contacts.leadState }).from(contacts).where(eq(contacts.id, contactId));
  const [org] = c?.orgId ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, c.orgId)) : [];
  const open = await db.select({ id: tasks.id, type: tasks.type, title: tasks.title, body: tasks.body, dueAt: tasks.dueAt }).from(tasks)
    .where(and(eq(tasks.contactId, contactId), eq(tasks.status, "open"), inArray(tasks.type, ["linkedin_connect", "linkedin_message"]))).orderBy(asc(tasks.dueAt));
  return { contact: c ? { ...c, orgName: org?.name ?? null } : null, tasks: open };
}

export async function handleExtensionRequest(db: Db, user: { email: string; mandateIds: string[] }, req: ExtensionRequest) {
  const mandateId = user.mandateIds[0];
  if (req.action === "mark_sent") {
    const [t] = await db.select({ id: tasks.id, mandateId: tasks.mandateId, contactId: tasks.contactId }).from(tasks).where(eq(tasks.id, req.taskId));
    if (!t || !user.mandateIds.includes(t.mandateId)) return { status: 404 as const, body: { error: "Task not found" } };
    const r = await completeTask(db, t.id, "done", user.email, "extension");
    return { status: 200 as const, body: { result: r, ...(t.contactId ? await contactView(db, t.contactId) : {}) } };
  }
  const url = canonicalLinkedin(req.action === "lookup" ? req.url : req.profile.url);
  if (!url || !/linkedin\.com\/in\//.test(url)) return { status: 400 as const, body: { error: "Not a LinkedIn profile URL" } };
  const [byUrl] = await db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.mandateId, user.mandateIds), eq(contacts.linkedinUrl, url)));
  if (req.action === "lookup") return { status: 200 as const, body: byUrl ? await contactView(db, byUrl.id) : { contact: null, tasks: [] } };

  const p = req.profile;
  let contactId = byUrl?.id;
  if (!contactId && p.company) {
    // Name plus organization, for people saved from Apollo or a CSV without their LinkedIn URL.
    const org = (await db.select({ id: organizations.id }).from(organizations)
      .where(and(eq(organizations.mandateId, mandateId), eq(organizations.nameNormalized, normalizeOrgName(p.company)))))[0];
    if (org) {
      const [c] = await db.select({ id: contacts.id }).from(contacts)
        .where(and(eq(contacts.orgId, org.id), eq(contacts.nameNormalized, normalizePersonName(p.name))));
      contactId = c?.id;
    }
  }
  let created = false;
  const org = p.company ? (await upsertOrganization(db, mandateId, { name: p.company }, "linkedin", { source: "linkedin_extension" })).row : null;
  const res = await upsertContact(db, mandateId, {
    fullName: p.name, title: p.title || p.headline.slice(0, 200) || null, location: p.location || null, linkedinUrl: url, orgId: org?.id ?? null,
  }, "linkedin", { source: "linkedin_extension", url });
  created = !contactId && res.created;
  contactId = res.row.id;
  return { status: 200 as const, body: { created, ...(await contactView(db, contactId)) } };
}
