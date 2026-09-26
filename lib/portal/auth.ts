// Portal authentication (master build instruction §47, §80). External users are separate from OS members: their own
// table, PBKDF2 password hashes, single-use invite links and a separate session cookie scoped to /os/portal. Nothing
// here can produce an internal session.
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { portalInvites, portalSessions, portalUsers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashToken, newToken, normalizeEmail } from "@/lib/session";
import type { PortalKind } from "./vocab";

export const PORTAL_COOKIE = "portal_session";
export const PORTAL_SESSION_DAYS = 14;
export const INVITE_DAYS = 14;
const ITERATIONS = 100_000; // the Workers runtime caps PBKDF2 at 100k

const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array((s.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${ITERATIONS}$${hex(salt)}$${hex(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function checkPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [it, salt, hash] = stored.split("$");
  const got = hex(await pbkdf2(password, unhex(salt), Number(it)));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** At least 12 characters with a letter and a digit. */
export const passwordProblem = (p: string) => (p.length < 12 ? "Use at least 12 characters." : !/[a-z]/i.test(p) || !/\d/.test(p) ? "Use letters and at least one digit." : p.length > 200 ? "Too long." : null);

/** Creates (or re-invites) a portal user and returns a one-time invite token to share by hand. Nothing is emailed. */
export async function invitePortalUser(db: Db, input: { mandateId: string; email: string; name: string; kind: PortalKind; orgId?: string | null; contactId?: string | null; isDemo?: boolean }, actor: string, now = new Date()) {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Invalid email");
  let [u] = await db.select().from(portalUsers).where(eq(portalUsers.email, email));
  if (u && u.kind !== input.kind) throw new Error(`This email already has a ${u.kind} portal account`);
  if (!u) [u] = await db.insert(portalUsers).values({ mandateId: input.mandateId, email, name: input.name, kind: input.kind, orgId: input.orgId ?? null, contactId: input.contactId ?? null, invitedBy: actor, isDemo: input.isDemo ?? false }).returning();
  else if (u.status === "revoked") await db.update(portalUsers).set({ status: "invited", updatedAt: now.toISOString() }).where(eq(portalUsers.id, u.id));
  const token = newToken();
  await db.insert(portalInvites).values({ portalUserId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString() });
  await audit(db, { actor, action: "portal_invited", entity: "portal_users", entityId: u.id, after: { email, kind: input.kind } });
  return { user: u, token };
}

export async function inviteUser(db: Db, token: string | undefined, now = new Date()) {
  if (!token || token.length > 100) return null;
  const [row] = await db.select({ invite: portalInvites, user: portalUsers }).from(portalInvites).innerJoin(portalUsers, eq(portalUsers.id, portalInvites.portalUserId))
    .where(and(eq(portalInvites.tokenHash, await hashToken(token)), isNull(portalInvites.usedAt), gt(portalInvites.expiresAt, now.toISOString())));
  if (!row || row.user.status === "revoked" || row.user.status === "suspended") return null;
  return row;
}

/** Sets the password from a valid invite, activates the account and opens a session. */
export async function acceptInvite(db: Db, token: string, password: string, now = new Date()): Promise<{ ok: true; session: string; kind: PortalKind } | { ok: false; reason: string }> {
  const row = await inviteUser(db, token, now);
  if (!row) return { ok: false, reason: "This invitation is invalid or has expired." };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, reason: problem };
  await db.update(portalUsers).set({ passwordHash: await hashPassword(password), status: "active", updatedAt: now.toISOString() }).where(eq(portalUsers.id, row.user.id));
  await db.update(portalInvites).set({ usedAt: now.toISOString() }).where(eq(portalInvites.id, row.invite.id));
  return { ok: true, session: await openPortalSession(db, row.user.id, now), kind: row.user.kind };
}

async function openPortalSession(db: Db, portalUserId: string, now: Date) {
  const session = newToken();
  await db.insert(portalSessions).values({ tokenHash: await hashToken(session), portalUserId, expiresAt: new Date(now.getTime() + PORTAL_SESSION_DAYS * 86_400_000).toISOString() });
  await db.update(portalUsers).set({ lastLoginAt: now.toISOString() }).where(eq(portalUsers.id, portalUserId));
  return session;
}

/** Wrong email and wrong password look the same; only active accounts sign in. */
export async function portalSignIn(db: Db, emailRaw: string, password: string, now = new Date()) {
  const email = normalizeEmail(emailRaw);
  if (!email || !password || password.length > 200) return null;
  const [u] = await db.select().from(portalUsers).where(eq(portalUsers.email, email));
  if (!u || u.status !== "active" || !(await checkPassword(password, u.passwordHash))) return null;
  return { session: await openPortalSession(db, u.id, now), kind: u.kind };
}

export async function portalSessionUser(db: Db, token: string | undefined, now = new Date()) {
  if (!token || token.length > 100) return null;
  const [row] = await db.select({ u: portalUsers }).from(portalSessions).innerJoin(portalUsers, eq(portalUsers.id, portalSessions.portalUserId))
    .where(and(eq(portalSessions.tokenHash, await hashToken(token)), gt(portalSessions.expiresAt, now.toISOString()), isNull(portalSessions.revokedAt)));
  return row && row.u.status === "active" ? row.u : null;
}

export async function endPortalSession(db: Db, token: string | undefined) {
  if (token) await db.delete(portalSessions).where(eq(portalSessions.tokenHash, await hashToken(token)));
}

/** Suspends or revokes a portal user and ends every session they hold. */
export async function setPortalUserStatus(db: Db, portalUserId: string, status: "active" | "suspended" | "revoked", actor: string, now = new Date()) {
  const [u] = await db.select().from(portalUsers).where(eq(portalUsers.id, portalUserId));
  if (!u) throw new Error("Portal user not found");
  if (status === "active" && !u.passwordHash) throw new Error("The user has not accepted the invitation yet");
  await db.update(portalUsers).set({ status, updatedAt: now.toISOString() }).where(eq(portalUsers.id, u.id));
  if (status !== "active") await db.update(portalSessions).set({ revokedAt: now.toISOString() }).where(eq(portalSessions.portalUserId, u.id));
  await audit(db, { actor, action: "portal_user_status", entity: "portal_users", entityId: u.id, before: { status: u.status }, after: { status } });
}
