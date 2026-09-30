// Anonymous: email + password sign-in. The password is the tracker's, checked by the site (lib/session.ts).
import { env } from "cloudflare:workers";
import { redirectTo, sameOrigin, sessionCookie } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { parseAllowlist } from "@/lib/membership";
import { credentialFor, recordLogin } from "@/lib/tenancy/engine";
import { fixedPasswordCheck, hasMembers, normalizeEmail, safeReturnTo, SESSION_COOKIE, SESSION_DAYS, trackerPasswordCheck, verifyPassword } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("return_to"));
  const email = normalizeEmail(form.get("email"));
  const back = (error: string) => redirectTo(request, `/signin?error=${error}&return_to=${encodeURIComponent(returnTo)}`);
  if (!email) return back("invalid");
  // Say so plainly when nobody can sign in yet, instead of "incorrect".
  if (!env.OS_ALLOWLIST && !(await hasMembers(appDb()))) return back("setup");
  // OS_PASSWORD (a Worker secret) is the password when set; otherwise the tracker password is checked.
  // Invited client users have their own credential (lib/tenancy); it takes precedence for their email.
  const credential = await credentialFor(appDb(), email);
  const check = credential ?? (env.OS_PASSWORD
    ? fixedPasswordCheck(env.OS_PASSWORD)
    : trackerPasswordCheck(env.TRACKER_AUTH_URL ?? `${env.SITE_BASE_URL ?? "https://regenera.bio"}/api/pipeline/auth`));
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  let result;
  try {
    result = await verifyPassword(appDb(), {
      email, password: String(form.get("password") ?? ""), ip,
    }, parseAllowlist(env.OS_ALLOWLIST), check);
    await recordLogin(appDb(), { email, ok: result.ok, method: credential ? "credential" : "regenera", ip, userAgent: request.headers.get("user-agent") ?? "" });
  } catch {
    return back("unavailable");
  }
  if (!result.ok) return back(result.reason);
  return redirectTo(request, returnTo, sessionCookie(request, SESSION_COOKIE, result.session, SESSION_DAYS * 86_400));
}
