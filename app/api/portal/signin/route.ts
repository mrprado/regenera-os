// Anonymous: portal email + password sign-in (lib/portal/auth.ts). Separate cookie from the OS session.
import { redirectTo, sameOrigin, sessionCookie } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { PORTAL_COOKIE, PORTAL_SESSION_DAYS, portalSignIn } from "@/lib/portal/auth";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const r = await portalSignIn(appDb(), String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!r) return redirectTo(request, "/portal/signin?error=invalid");
  return redirectTo(request, `/portal/${r.kind}`, sessionCookie(request, PORTAL_COOKIE, r.session, PORTAL_SESSION_DAYS * 86_400));
}
