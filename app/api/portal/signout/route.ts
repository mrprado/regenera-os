// Anonymous-safe: ends the portal session and clears its cookie.
import { cookies } from "next/headers";
import { redirectTo, sameOrigin, sessionCookie } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { endPortalSession, PORTAL_COOKIE } from "@/lib/portal/auth";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  await endPortalSession(appDb(), (await cookies()).get(PORTAL_COOKIE)?.value);
  const res = redirectTo(request, "/portal/signin?signed_out=1", sessionCookie(request, PORTAL_COOKIE, "", 0));
  res.headers.set("clear-site-data", '"cache"');
  return res;
}
