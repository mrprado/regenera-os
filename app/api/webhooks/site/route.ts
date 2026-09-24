import { env } from "cloudflare:workers";
import { applySiteEvent, verifySiteSignature, zSiteEvent } from "@/lib/crm/site-intake";
import { appDb } from "@/lib/db/scoped";

// Anonymous route (SPEC section 23): regenera.bio posts inquiries and referrals, signed with HMAC.
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await verifySiteSignature(env.SITE_WEBHOOK_SECRET, request.headers.get("x-regenera-signature"), body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  const parsed = zSiteEvent.safeParse(JSON.parse(body));
  if (!parsed.success) return Response.json({ error: "Unrecognized event" }, { status: 400 });
  const result = await applySiteEvent(appDb(), parsed.data);
  return Response.json({ ok: true, ...result });
}
