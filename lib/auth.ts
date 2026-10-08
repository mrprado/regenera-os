import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { appDb, isInternal, isOwner, type UserScope } from "./db/scoped";
import { narrowScope } from "./mandates";
import { moduleForPath, pathAllowed } from "./tenancy/vocab";
import { parseAllowlist, resolveMembership } from "./membership";
import { SESSION_COOKIE, sessionEmail } from "./session";

export const MANDATE_COOKIE = "os_mandate";

/** visitor: an anonymous visitor let in by OS_OPEN_ACCESS. They see the owner's view and change nothing. */
export type OsUser = { userId: string; email: string; displayName: string; scope: UserScope; visitor?: boolean };

// Deduplicated per request. mandate_members decides access; OS_ALLOWLIST only bootstraps the first owner.
const toOsUser = cache(async (userId: string, email: string, displayName: string): Promise<OsUser | null> => {
  const scope = await resolveMembership(appDb(), { userId, email }, parseAllowlist(env.OS_ALLOWLIST));
  if (!scope) return null;
  // The header switcher narrows every query to one mandate; only mandates the user belongs to are honoured.
  let focus: string | undefined;
  try { focus = (await cookies()).get(MANDATE_COOKIE)?.value; } catch { focus = undefined; }
  return { userId, email: scope.email, displayName, scope: narrowScope(scope, focus) };
});

/** The email of the signed-in session (email-link sign-in, lib/session.ts), or null. Cached per request. */
export const currentEmail = cache(async (): Promise<string | null> => {
  let token: string | undefined;
  try { token = (await cookies()).get(SESSION_COOKIE)?.value; } catch { return null; }
  return sessionEmail(appDb(), token);
});

// The verified email is the identity; membership rows bind to this id on first sign-in.
const fromEmail = (email: string) => toOsUser(`email:${email}`, email, email);

// Open access (OS_OPEN_ACCESS = "1"): with no session, a visitor gets the first OS_ALLOWLIST email's view without a
// password. Every server action and write route refuses visitors (no sends, approvals, credit or AI spend, deletions);
// signing in at /signin still gives full rights. Turn it off by removing the variable.
export function openAccessEmail(): string | null {
  if (env.OS_OPEN_ACCESS !== "1") return null;
  return [...parseAllowlist(env.OS_ALLOWLIST)][0] ?? null;
}

/** The signed-in user, or the open-access visitor, or null. */
export const currentOsUser = cache(async (): Promise<OsUser | null> => {
  const email = await currentEmail();
  if (email) return fromEmail(email);
  const open = openAccessEmail();
  const os = open ? await fromEmail(open) : null;
  return os ? { ...os, visitor: true } : null;
});

/** Guard for every page under app/(app). Sends anonymous visitors to sign-in, others to /not-allowed. */
export async function requireOsUser(returnTo: string): Promise<OsUser> {
  const email = await currentEmail();
  if (!email && !openAccessEmail()) redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
  const os = await currentOsUser();
  if (!os) redirect("/not-allowed");
  // Module entitlements (lib/tenancy): a client user opening a module their organization does not license is sent away.
  if (!pathAllowed(os.scope.modules, returnTo)) redirect(`/not-allowed?module=${encodeURIComponent(moduleForPath(returnTo) ?? "")}`);
  return os;
}

export async function requireOsOwner(returnTo: string): Promise<OsUser> {
  const os = await requireOsUser(returnTo);
  if (!isOwner(os.scope)) redirect("/not-allowed");
  return os;
}

/** For API route handlers: returns null instead of redirecting. Pass { write: true } on anything that changes data
 *  or spends: open-access visitors are refused there. */
export async function getOsApiUser(opts: { write?: boolean } = {}): Promise<OsUser | null> {
  const os = await currentOsUser();
  if (opts.write && os?.visitor) return null;
  return os;
}

/** Wrap every server action body. Throws rather than redirecting so a forged call gets nothing. */
export async function withOsUser<T>(fn: (user: OsUser) => Promise<T>, opts: { owner?: boolean; internal?: boolean } = {}): Promise<T> {
  const os = await getOsApiUser();
  if (!os) throw new Error("Not authorized");
  if (os.visitor) throw new Error("View only without a password: sign in at /signin to make changes");
  if (opts.owner && !isOwner(os.scope)) throw new Error("Owner only");
  // Platform administration (jobs, sending, demo data, prompts) is Regenera's; a client admin owning their own workspace is not enough.
  if (opts.internal && !isInternal(os.scope)) throw new Error("Regenera internal only");
  // Read-only users can open everything they are granted and change nothing: refused here, for every action.
  if (os.scope.userType === "read_only") throw new Error("Read-only access");
  return fn(os);
}

export async function currentUser(): Promise<{ email: string } | null> {
  const email = await currentEmail();
  return email ? { email } : null;
}
