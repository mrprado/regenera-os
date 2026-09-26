// Portal document gateway: every open goes through canOpenDocument (grant, NDA, broker standing, distribution
// approval) and is logged; the browser is then sent to the document's location. No document URL is ever rendered
// into a portal page.
import { cookies } from "next/headers";
import { redirectTo } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { canOpenDocument } from "@/lib/portal/access";
import { PORTAL_COOKIE, portalSessionUser } from "@/lib/portal/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await portalSessionUser(appDb(), (await cookies()).get(PORTAL_COOKIE)?.value);
  if (!user) return redirectTo(request, "/portal/signin");
  const { id } = await params;
  const d = await canOpenDocument(appDb(), user, id, new Date(), request.headers.get("cf-connecting-ip"));
  if (!d.allowed || !d.url) return redirectTo(request, `/portal/${user.kind}?tab=documents&notice=${encodeURIComponent(d.allowed ? "This document has no file location yet. Ask Regenera." : `Not available: ${d.reason}`)}`);
  if (!/^https:\/\//.test(d.url)) return new Response("Unsupported document location", { status: 400 });
  return new Response(null, { status: 302, headers: { location: d.url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
