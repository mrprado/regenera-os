// Email + password sign-in. The password is the OS_PASSWORD secret when set; otherwise the tracker's
// (regenera.bio/tracker), checked by the site's own login endpoint and never stored. The email must be able to open the OS (a mandate member, or an
// allowlisted first owner). Sessions live in D1, so sign-out revokes them.
// Lockout after failed attempts is off for now (auth_failures stays in the schema, unused).
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { authSessions, mandateMembers } from "@/db/schema";

export const SESSION_COOKIE = "os_session";
export const SESSION_DAYS = 30;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

export async function hashToken(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
}

export const normalizeEmail = (value: unknown) => {
  const e = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
};

/** Only in-app relative paths survive; anything else becomes /today. */
export function safeReturnTo(value: unknown) {
  const v = String(value ?? "");
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && v.length < 500 ? v : "/today";
}

export async function hasMembers(db: Db) {
  const [row] = await db.select({ email: mandateMembers.email }).from(mandateMembers).limit(1);
  return Boolean(row);
}

/** True for an existing mandate member, or an allowlisted email while no member exists yet (bootstrap). */
export async function mayHaveAccess(db: Db, email: string, allowlist: Set<string>) {
  const [member] = await db.select({ email: mandateMembers.email }).from(mandateMembers).where(eq(mandateMembers.email, email)).limit(1);
  if (member) return true;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(mandateMembers);
  return count === 0 && allowlist.has(email);
}

export type PasswordCheck = (password: string) => Promise<boolean>;

/** Checks the password against the tracker's login endpoint (200 = right password). */
export function trackerPasswordCheck(url: string, fetchImpl: typeof fetch = fetch): PasswordCheck {
  return async password => {
    const res = await fetchImpl(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.status === 200;
  };
}

/** Constant-time comparison against the OS_PASSWORD secret. */
export function fixedPasswordCheck(expected: string): PasswordCheck {
  return async password => {
    const [a, b] = await Promise.all([hashToken(`pw:${password}`), hashToken(`pw:${expected}`)]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };
}

export type SignInResult = { ok: true; session: string } | { ok: false; reason: "invalid" };

/** Verifies email and password and opens a session. Wrong email and wrong password look the same. */
export async function verifyPassword(db: Db, input: { email: string; password: string; ip: string }, allowlist: Set<string>, check: PasswordCheck, now = new Date()): Promise<SignInResult> {
  const iso = now.toISOString();

  // The password is only checked for an email that may sign in, so the tracker is never an oracle for others.
  const ok = input.password.length > 0 && input.password.length <= 200 && (await mayHaveAccess(db, input.email, allowlist)) && (await check(input.password));
  if (!ok) return { ok: false, reason: "invalid" };
  const session = newToken();
  await db.insert(authSessions).values({
    tokenHash: await hashToken(session), email: input.email, createdAt: iso,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
  });
  await db.delete(authSessions).where(lt(authSessions.expiresAt, iso));
  return { ok: true, session };
}

export async function sessionEmail(db: Db, token: string | undefined, now = new Date()) {
  if (!token || token.length > 100) return null;
  const [s] = await db.select({ email: authSessions.email }).from(authSessions)
    .where(and(eq(authSessions.tokenHash, await hashToken(token)), gt(authSessions.expiresAt, now.toISOString())));
  return s?.email ?? null;
}

export async function endSession(db: Db, token: string | undefined) {
  if (token) await db.delete(authSessions).where(eq(authSessions.tokenHash, await hashToken(token)));
}
