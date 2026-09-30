import { env } from "cloudflare:workers";
import { appDb } from "@/lib/db/scoped";
import { applyUnsubscribe, verifyUnsubscribeToken } from "@/lib/outreach/unsubscribe";

// Anonymous route (SPEC section 23). GET shows a confirmation button so link scanners cannot unsubscribe
// anyone; POST (the button, or a mail client's RFC 8058 one-click request) suppresses the address.

const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;background:#fff;color:#161816;font:16px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}main{max-width:480px;margin:18vh auto;padding:0 16px}h1{font-size:22px;font-weight:600;margin:0 0 8px}button{margin-top:16px;background:#161816;color:#fff;border:0;border-radius:6px;padding:10px 18px;font:inherit;cursor:pointer}</style>
</head><body><main>${body}</main></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
);

async function verify(token: string) {
  if (!env.UNSUBSCRIBE_SIGNING_SECRET) return null;
  return verifyUnsubscribeToken(env.UNSUBSCRIBE_SIGNING_SECRET, token);
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await verify(token);
  if (!v) return page("Link not valid", "<h1>This link is not valid</h1><p>Reply to the email with “unsubscribe” and we will remove you.</p>", 400);
  return page("Unsubscribe", `<h1>Stop emails from Regenera</h1><p>${v.email.replace(/[<>&"]/g, "")} will not receive further outreach.</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await verify(token);
  if (!v) return page("Link not valid", "<h1>This link is not valid</h1>", 400);
  await applyUnsubscribe(appDb(), v);
  return page("Unsubscribed", "<h1>You are unsubscribed</h1><p>Regenera will not email you again.</p>");
}
