// Anonymous: accepts a one-time portal invitation by setting a password (lib/portal/auth.ts acceptInvite).
import { redirectTo, sameOrigin, sessionCookie } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { acceptInvite, PORTAL_COOKIE, PORTAL_SESSION_DAYS } from "@/lib/portal/auth";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return redirectTo(request, `/portal/invite/${encodeURIComponent(token)}?error=${encodeURIComponent("The two passwords differ.")}`);
  const r = await acceptInvite(appDb(), token, password);
  if (!r.ok) return redirectTo(request, `/portal/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(r.reason)}`);
  return redirectTo(request, `/portal/${r.kind}`, sessionCookie(request, PORTAL_COOKIE, r.session, PORTAL_SESSION_DAYS * 86_400));
}
