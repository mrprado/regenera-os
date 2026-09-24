// Deliverability monitor (docs/plans/phase-2.md item 13). SPF, DKIM, DMARC and MX over DNS-over-HTTPS
// (free, Cloudflare 1.1.1.1), plus the 7-day bounce rate per mailbox. Auto-pauses a mailbox above 3%
// bounces (minimum 20 sends). Gmail gives no complaint feed, so complaints are counted from
// replies classified hostile or unsubscribe as the closest available signal.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { deliverabilityChecks, messages, replies } from "@/db/schema";
import { pauseMailbox, type MailboxRoleName } from "./sender";

const zDoh = z.object({ Status: z.number(), Answer: z.array(z.object({ type: z.number(), data: z.string() })).nullish() });

async function doh(name: string, type: "TXT" | "MX", fetchImpl: typeof fetch): Promise<string[]> {
  const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`DNS-over-HTTPS returned ${res.status}`);
  const j = zDoh.parse(await res.json());
  const want = type === "TXT" ? 16 : 15;
  return (j.Answer ?? []).filter(a => a.type === want).map(a => a.data.replace(/"\s*"/g, "").replace(/^"|"$/g, ""));
}

export type DnsResult = { spf: boolean; dmarc: "none" | "quarantine" | "reject" | "missing"; dkim: boolean; mx: boolean; detail: Record<string, unknown> };

export function dmarcPolicy(records: string[]): DnsResult["dmarc"] {
  const rec = records.find(r => /^v=DMARC1/i.test(r));
  const p = rec?.match(/;\s*p=(none|quarantine|reject)/i)?.[1]?.toLowerCase();
  return (p as DnsResult["dmarc"]) ?? "missing";
}

export async function checkDomainDns(domain: string, dkimSelectors = ["google"], fetchImpl: typeof fetch = fetch): Promise<DnsResult> {
  const [txt, dmarc, mx, ...dkim] = await Promise.all([
    doh(domain, "TXT", fetchImpl), doh(`_dmarc.${domain}`, "TXT", fetchImpl), doh(domain, "MX", fetchImpl),
    ...dkimSelectors.map(s => doh(`${s}._domainkey.${domain}`, "TXT", fetchImpl)),
  ]);
  const spfRec = txt.find(r => /^v=spf1/i.test(r)) ?? null;
  return {
    spf: !!spfRec && /include:_spf\.google\.com|include:[^ ]+/.test(spfRec),
    dmarc: dmarcPolicy(dmarc),
    dkim: dkim.some(r => r.some(x => /v=DKIM1|k=rsa|p=/i.test(x))),
    mx: mx.length > 0,
    detail: { spf: spfRec, dmarc: dmarc[0] ?? null, mx, dkimSelectors },
  };
}

export async function bounceStats(db: Db, role: MailboxRoleName, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [{ sent }] = await db.select({ sent: sql<number>`count(*)` }).from(messages).where(and(eq(messages.mailboxRole, role), eq(messages.status, "sent"), gte(messages.sentAt, since)));
  const rows = await db.select({ cls: replies.classification, n: sql<number>`count(*)` }).from(replies)
    .innerJoin(messages, eq(messages.id, replies.messageId))
    .where(and(eq(messages.mailboxRole, role), gte(replies.receivedAt, since), inArray(replies.classification, ["bounce", "hostile", "unsubscribe"])))
    .groupBy(replies.classification);
  const bounces = rows.find(r => r.cls === "bounce")?.n ?? 0;
  const complaints = rows.filter(r => r.cls !== "bounce").reduce((a, r) => a + r.n, 0);
  return { sent, bounces, complaints, bounceRate: sent ? bounces / sent : 0 };
}

/** Pause rule: bounce rate above 3% with at least 20 sends, or any hostile reply this week. */
export function shouldPause(s: { sent: number; bounceRate: number; hostile: number }) {
  if (s.sent >= 20 && s.bounceRate > 0.03) return `Bounce rate ${(s.bounceRate * 100).toFixed(1)}% over 7 days`;
  if (s.hostile > 0) return "Spam-style complaint this week";
  return null;
}

export async function runDeliverability(db: Db, input: { domains: { domain: string; role: MailboxRoleName }[]; fetchImpl?: typeof fetch; now?: Date }) {
  const now = input.now ?? new Date();
  const out: (DnsResult & { domain: string; bounceRate: number; paused: string | null })[] = [];
  for (const { domain, role } of input.domains) {
    const dns = await checkDomainDns(domain, ["google"], input.fetchImpl);
    const stats = await bounceStats(db, role, now);
    const [{ hostile }] = await db.select({ hostile: sql<number>`count(*)` }).from(replies).innerJoin(messages, eq(messages.id, replies.messageId))
      .where(and(eq(messages.mailboxRole, role), eq(replies.classification, "hostile"), gte(replies.receivedAt, new Date(now.getTime() - 7 * 86_400_000).toISOString())));
    const pause = shouldPause({ sent: stats.sent, bounceRate: stats.bounceRate, hostile });
    if (pause) await pauseMailbox(db, role, new Date(now.getTime() + 72 * 3_600_000), pause);
    await db.insert(deliverabilityChecks).values({ domain, spf: dns.spf, dmarc: dns.dmarc, dkim: dns.dkim, mx: dns.mx, bounceRate: stats.bounceRate, complaints: stats.complaints, detail: { ...dns.detail, sent7d: stats.sent, bounces7d: stats.bounces, paused: pause }, checkedAt: now.toISOString() });
    out.push({ ...dns, domain, bounceRate: stats.bounceRate, paused: pause });
  }
  return out;
}

/** Plain-language problems for Home and the digest. */
export function deliverabilityIssues(c: { domain: string; spf: boolean; dmarc: string | null; dkim: boolean; mx: boolean }) {
  const out: string[] = [];
  if (!c.spf) out.push(`${c.domain}: no SPF record`);
  if (!c.dkim) out.push(`${c.domain}: DKIM not found (selector google)`);
  if (c.dmarc === "missing") out.push(`${c.domain}: no DMARC policy`);
  if (!c.mx) out.push(`${c.domain}: no MX records`);
  return out;
}
