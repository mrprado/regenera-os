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
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const ipHash = await hashToken(`intake:${request.headers.get("cf-connecting-ip") ?? "local"}`);
  // Source attribution: campaign tags, landing page, the sending page and what the person said. No visitor tracking.
  const META = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing", "referrer", "heard"];
  const attribution = Object.fromEntries(META.filter(k => raw[k]).map(k => [k, raw[k]]));
  for (const k of [...META, "consent"]) delete raw[k];
  const r = await submitIntake(appDb(), kind as IntakeKind, raw, ipHash, new Date(), { attribution, consent: String(form.get("consent") ?? "respond") });
  if (!r.ok) return redirectTo(request, `/intake/${kind}?error=${r.reason}`);
  return redirectTo(request, `/intake/${kind}?sent=1`);
}
