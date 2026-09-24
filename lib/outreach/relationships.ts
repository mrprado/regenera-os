// Relationship intelligence (docs/plans/phase-2.md item 14). Gmail and Calendar METADATA only: addresses and
// dates, never subjects or bodies. Backfills 12 months one 30-day window per run, then stays current.
// Warm paths per organization feed the access axis of scoring.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { relationships } from "@/db/schema";
import { gmailGetMessage, header } from "@/lib/google/gmail";
import { getState, setState } from "@/lib/state";

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "proton.me", "protonmail.com", "aol.com"]);
const WINDOW_MS = 30 * 86_400_000;

export function addresses(value: string | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map(m => m[0].toLowerCase());
}

/** 0 to 100. Two-way email and meetings count most; decays over a year of silence. */
export function strengthOf(r: { emailsSent: number; emailsReceived: number; meetings: number; lastContactAt: string | null }, now = new Date()) {
  const raw = Math.min(r.emailsSent, 30) * 2 + Math.min(r.emailsReceived, 30) * 3 + Math.min(r.meetings, 10) * 8 + (r.emailsSent > 0 && r.emailsReceived > 0 ? 10 : 0);
  const ageDays = r.lastContactAt ? (now.getTime() - Date.parse(r.lastContactAt)) / 86_400_000 : 365;
  return Math.round(Math.min(100, raw) * Math.max(0.2, 1 - ageDays / 450));
}

export async function recordTouch(db: Db, input: { mandateId: string; email: string; mailbox: string; kind: "sent" | "received" | "meeting"; at: string }) {
  const email = input.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!domain || email === input.mailbox.toLowerCase()) return;
  await db.insert(relationships).values({ mandateId: input.mandateId, email, domain, mailbox: input.mailbox, lastContactAt: input.at })
    .onConflictDoNothing();
  const col = input.kind === "sent" ? sql`emails_sent = emails_sent + 1` : input.kind === "received" ? sql`emails_received = emails_received + 1` : sql`meetings = meetings + 1`;
  await db.run(sql`UPDATE relationships SET ${col}, last_contact_at = max(coalesce(last_contact_at, ''), ${input.at}), updated_at = ${new Date().toISOString()}
    WHERE mandate_id = ${input.mandateId} AND email = ${email} AND mailbox = ${input.mailbox}`);
  const [r] = await db.select().from(relationships).where(and(eq(relationships.mandateId, input.mandateId), eq(relationships.email, email), eq(relationships.mailbox, input.mailbox)));
  if (r) await db.update(relationships).set({ strength: strengthOf(r) }).where(eq(relationships.id, r.id));
}

const zList = z.object({ messages: z.array(z.object({ id: z.string() })).optional(), nextPageToken: z.string().optional() });

/** One window per run. Returns the number of messages read. Cursor: state `relationships_cursor:<mailbox>`. */
export async function syncRelationships(db: Db, input: { mandateId: string; accessToken: string; mailbox: string; ownDomains: string[]; now?: Date; fetchImpl?: typeof fetch; maxMessages?: number }) {
  const now = input.now ?? new Date();
  const f = input.fetchImpl ?? fetch;
  const key = `relationships_cursor:${input.mailbox}`;
  const from = new Date((await getState(db, key)) ?? new Date(now.getTime() - 365 * 86_400_000).toISOString());
  const to = new Date(Math.min(from.getTime() + WINDOW_MS, now.getTime()));
  const q = `after:${Math.floor(from.getTime() / 1000)} before:${Math.floor(to.getTime() / 1000)} -in:chats`;
  let read = 0;
  let pageToken: string | undefined;
  do {
    const res = await f(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: { authorization: `Bearer ${input.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Gmail list returned ${res.status}`);
    const page = zList.parse(await res.json());
    for (const { id } of page.messages ?? []) {
      const m = await gmailGetMessage(input.accessToken, id, "metadata", f);
      if (!m) continue;
      read++;
      const at = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : to.toISOString();
      const fromAddr = addresses(header(m, "From"))[0];
      const outbound = fromAddr === input.mailbox.toLowerCase();
      const others = outbound ? [...addresses(header(m, "To")), ...addresses(header(m, "Cc"))] : fromAddr ? [fromAddr] : [];
      for (const e of others) {
        const d = e.split("@")[1];
        if (FREE_MAIL.has(d) || input.ownDomains.includes(d) || /no-?reply|notifications?@|mailer-daemon/.test(e)) continue;
        await recordTouch(db, { mandateId: input.mandateId, email: e, mailbox: input.mailbox, kind: outbound ? "sent" : "received", at });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken && read < (input.maxMessages ?? 400));
  // Only advance when the window is complete, so a partial run is retried rather than skipped.
  if (!pageToken) await setState(db, key, to.toISOString());
  return read;
}

export async function warmPaths(db: Db, mandateId: string, domain: string | null, limit = 5) {
  if (!domain) return [];
  return db.select().from(relationships).where(and(eq(relationships.mandateId, mandateId), eq(relationships.domain, domain.toLowerCase())))
    .orderBy(desc(relationships.strength)).limit(limit);
}
