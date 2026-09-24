import { z } from "zod";
import { askOs } from "@/lib/ask/agent";
import { getOsApiUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";

// Ask the OS (SPEC section 23: POST /api/command, streamed). Signed-in members only; answers are scoped to
// the member's mandates, and anything that would change data comes back as a proposal to confirm.
const zBody = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(12).default([]),
});

export async function POST(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const cfg = aiConfig();
  if (!cfg) return Response.json({ error: "Ask the OS needs ANTHROPIC_API_KEY (docs/ENV.md)." }, { status: 503 });
  const parsed = zBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ask a question" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        const r = await askOs({ db: appDb(), scope: user.scope, actor: user.email, source: "ask" }, cfg, parsed.data.question, parsed.data.history, e => send(e));
        send({ type: "done", answer: r.answer, proposals: r.proposals });
      } catch (e) {
        send({ type: "error", error: (e as Error).message.slice(0, 300) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
