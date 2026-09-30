// Anonymous: accepts a one-time OS invitation (lib/tenancy/engine.ts acceptOsInvite), then asks the user to sign in.
import { redirectTo, sameOrigin } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { acceptOsInvite } from "@/lib/tenancy/engine";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const back = (e: string) => redirectTo(request, `/join/${encodeURIComponent(token)}?error=${encodeURIComponent(e)}`);
  if (password !== String(form.get("confirm") ?? "")) return back("The two passwords differ.");
  const r = await acceptOsInvite(appDb(), token, password);
  if (!r.ok) return back(r.reason);
  return redirectTo(request, `/signin?joined=1`);
}
