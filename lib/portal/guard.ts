// Portal guard (master build instruction §47): every portal page and action resolves the portal session itself and
// checks the account kind. Portal sessions can never reach app/(app) (different cookie, different table).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { portalUsers } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { PORTAL_COOKIE, portalSessionUser } from "./auth";
import type { PortalKind } from "./vocab";

export type PortalUser = typeof portalUsers.$inferSelect;

export const currentPortalUser = cache(async (): Promise<PortalUser | null> => {
  let token: string | undefined;
  try { token = (await cookies()).get(PORTAL_COOKIE)?.value; } catch { return null; }
  return portalSessionUser(appDb(), token);
});

export async function requestIp() {
  try { return (await headers()).get("cf-connecting-ip"); } catch { return null; }
}

/** Page guard: anonymous → portal sign-in; another portal kind → its own home. */
export async function requirePortalUser(kind: PortalKind): Promise<PortalUser> {
  const u = await currentPortalUser();
  if (!u) redirect("/portal/signin");
  if (u.kind !== kind) redirect(`/portal/${u.kind}`);
  return u;
}

/** Server-action guard. */
export async function withPortalUser<T>(kind: PortalKind, fn: (u: PortalUser) => Promise<T>): Promise<T> {
  const u = await currentPortalUser();
  if (!u || u.kind !== kind) throw new Error("Not authorized");
  return fn(u);
}
