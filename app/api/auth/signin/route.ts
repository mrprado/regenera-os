// Anonymous: email + password sign-in. The password is the tracker's, checked by the site (lib/session.ts).
import { env } from "cloudflare:workers";
import { redirectTo, sameOrigin, sessionCookie } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { parseAllowlist } from "@/lib/membership";
import { fixedPasswordCheck, normalizeEmail, safeReturnTo, SESSION_COOKIE, SESSION_DAYS, trackerPasswordCheck, verifyPassword } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("return_to"));
  const email = normalizeEmail(form.get("email"));
  const back = (error: string) => redirectTo(request, `/signin?error=${error}&return_to=${encodeURIComponent(returnTo)}`);
  if (!email) return back("invalid");
  // OS_PASSWORD (a Worker secret) is the password when set; otherwise the tracker password is checked.
  const check = env.OS_PASSWORD
    ? fixedPasswordCheck(env.OS_PASSWORD)
    : trackerPasswordCheck(env.TRACKER_AUTH_URL ?? `${env.SITE_BASE_URL ?? "https://regenera.bio"}/api/pipeline/auth`);
  let result;
  try {
    result = await verifyPassword(appDb(), {
      email, password: String(form.get("password") ?? ""), ip: request.headers.get("cf-connecting-ip") ?? "local",
    }, parseAllowlist(env.OS_ALLOWLIST), check);
  } catch {
    return back("unavailable");
  }
  if (!result.ok) return back(result.reason);
  return redirectTo(request, returnTo, sessionCookie(request, SESSION_COOKIE, result.session, SESSION_DAYS * 86_400));
}
