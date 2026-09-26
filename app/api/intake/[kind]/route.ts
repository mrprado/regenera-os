// Anonymous: public intake forms (lib/portal/intake.ts). Honeypot + per-IP rate limit + validation; the submitter
// only ever sees a thank-you page.
import { redirectTo, sameOrigin } from "@/lib/auth-http";
import { appDb } from "@/lib/db/scoped";
import { submitIntake } from "@/lib/portal/intake";
import { INTAKE_KINDS, type IntakeKind } from "@/lib/portal/vocab";
import { hashToken } from "@/lib/session";

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(kind in INTAKE_KINDS)) return new Response("Not found", { status: 404 });
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  if (String(form.get("website_url") ?? "")) return redirectTo(request, `/intake/${kind}?sent=1`); // honeypot: bots fill it
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const ipHash = await hashToken(`intake:${request.headers.get("cf-connecting-ip") ?? "local"}`);
  const r = await submitIntake(appDb(), kind as IntakeKind, raw, ipHash);
  if (!r.ok) return redirectTo(request, `/intake/${kind}?error=${r.reason}`);
  return redirectTo(request, `/intake/${kind}?sent=1`);
}
