// Anonymous-safe: ends the current session (revoked in D1) and clears the cookie.
import { cookies } from "next/headers";
import { redirectTo, sameOrigin, sessionCookie } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { endSession, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  await endSession(appDb(), (await cookies()).get(SESSION_COOKIE)?.value);
  const res = redirectTo(request, "/signin?signed_out=1", sessionCookie(request, SESSION_COOKIE, "", 0));
  res.headers.set("clear-site-data", '"cache"'); // cached private API responses (map data) go too
  return res;
}
