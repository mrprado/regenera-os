import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getChatGPTUser, requireChatGPTUser, type ChatGPTUser } from "./chatgpt-auth";
import { appDb, isOwner, type UserScope } from "./db/scoped";
import { parseAllowlist, resolveMembership } from "./membership";

export type OsUser = { userId: string; email: string; displayName: string; scope: UserScope };

// Deduplicated per request. mandate_members decides access; OS_ALLOWLIST only bootstraps the first owner.
const toOsUser = cache(async (userId: string, email: string, displayName: string): Promise<OsUser | null> => {
  const scope = await resolveMembership(appDb(), { userId, email }, parseAllowlist(env.OS_ALLOWLIST));
  return scope ? { userId, email: scope.email, displayName, scope } : null;
});

const fromChatGPT = (u: ChatGPTUser) => toOsUser(u.userId, u.email, u.displayName);

/** Guard for every page under app/(app). Sends anonymous visitors to sign-in, others to /not-allowed. */
export async function requireOsUser(returnTo: string): Promise<OsUser> {
  const os = await fromChatGPT(await requireChatGPTUser(returnTo));
  if (!os) redirect("/not-allowed");
  return os;
}

export async function requireOsOwner(returnTo: string): Promise<OsUser> {
  const os = await requireOsUser(returnTo);
  if (!isOwner(os.scope)) redirect("/not-allowed");
  return os;
}

/** For API route handlers: returns null instead of redirecting. */
export async function getOsApiUser(): Promise<OsUser | null> {
  const user = await getChatGPTUser();
  return user ? fromChatGPT(user) : null;
}

/** Wrap every server action body. Throws rather than redirecting so a forged call gets nothing. */
export async function withOsUser<T>(fn: (user: OsUser) => Promise<T>, opts: { owner?: boolean } = {}): Promise<T> {
  const os = await getOsApiUser();
  if (!os) throw new Error("Not authorized");
  if (opts.owner && !isOwner(os.scope)) throw new Error("Owner only");
  return fn(os);
}

export async function currentUser(): Promise<ChatGPTUser | null> {
  return getChatGPTUser();
}
