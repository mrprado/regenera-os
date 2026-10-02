import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { mailSources } from "@/db/schema";
import { bearerMatches } from "@/lib/crypto";
import { appDb } from "@/lib/db/scoped";
import { applyExtraction, ensureSource, finishRun, ingestBatch, rebuild, startRun, type Extraction } from "@/lib/mail-intel/engine";
import type { RawMessage } from "@/lib/mail-intel/classify";

// Anonymous route (bearer): the backfill CLI (scripts/mail-import.mjs) posts import-schema batches here. The token is
// MAIL_IMPORT_TOKEN (falls back to JOBS_TICK_TOKEN only on localhost outside production). Read-only with respect to Gmail: it only
// receives records that were read from the mailbox; it never calls Gmail.
const zRaw = z.object({
  account: z.string().email(), gmailMessageId: z.string().min(4), gmailThreadId: z.string().min(4), internalDate: z.string(), from: z.string(), to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]), bcc: z.array(z.string()).default([]), replyTo: z.string().nullish(), subject: z.string().default(""), snippet: z.string().default(""), body: z.string().nullish(),
  labels: z.array(z.string()).default([]), attachments: z.array(z.object({ id: z.string(), filename: z.string(), mimeType: z.string().optional(), size: z.number().optional() })).default([]),
  inReplyTo: z.string().nullish(), references: z.string().nullish(), displayUrl: z.string().nullish(),
});
const zBody = z.discriminatedUnion("op", [
  z.object({ op: z.literal("source"), account: z.string().email(), mandateId: z.string(), ownAddresses: z.array(z.string().email()), boundaryStart: z.string(), boundaryEnd: z.string() }),
  z.object({ op: z.literal("start"), account: z.string().email(), transport: z.string(), model: z.string().default("none") }),
  z.object({ op: z.literal("batch"), account: z.string().email(), batchId: z.string(), messages: z.array(zRaw).max(200) }),
  z.object({ op: z.literal("rebuild"), account: z.string().email() }),
  z.object({ op: z.literal("extract"), account: z.string().email(), model: z.string(), extractions: z.array(z.record(z.unknown())).max(50) }),
  z.object({ op: z.literal("finish"), runId: z.string(), counts: z.record(z.number()), status: z.string().default("complete") }),
]);

export async function POST(request: Request) {
  const e = env as unknown as Record<string, string | undefined>;
  // Production needs its own MAIL_IMPORT_TOKEN; the tick-token fallback exists only for local development.
  const host = new URL(request.url).hostname;
  const local = e.APP_ENV !== "production" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  const token = e.MAIL_IMPORT_TOKEN ?? (local ? e.JOBS_TICK_TOKEN : undefined);
  if (!token || !bearerMatches(request, token)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = zBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const b = parsed.data, db = appDb(), actor = "system:mail-import";
  try {
    if (b.op === "source") return Response.json(await ensureSource(db, b, actor));
    if (b.op === "start") {
      const [s] = await db.select().from(mailSources).where(eq(mailSources.account, b.account));
      if (!s) throw new Error("Configure the source first");
      return Response.json(await startRun(db, s, b.transport, actor, b.model));
    }
    if (b.op === "batch") return Response.json(await ingestBatch(db, b.account, b.messages as RawMessage[], b.batchId));
    if (b.op === "rebuild") return Response.json(await rebuild(db, b.account, actor));
    if (b.op === "extract") {
      const out: { threadKey: string; ok: boolean; error?: string }[] = [];
      for (const x of b.extractions as unknown as Extraction[]) {
        try { await applyExtraction(db, b.account, x, b.model, actor); out.push({ threadKey: x.threadKey, ok: true }); }
        catch (err) { out.push({ threadKey: x.threadKey, ok: false, error: (err as Error).message }); }
      }
      return Response.json(out);
    }
    await finishRun(db, b.runId, b.counts, b.status);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
