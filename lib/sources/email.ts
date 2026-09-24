// Free email signals (SPEC section 12a): MX checks over DNS-over-HTTPS and address-pattern inference.
// An inferred address is never "verified": it is allowed for manual targeted sends only.
import { z } from "zod";
import type { Db } from "@/db";
import { fetchJson } from "./http";

const zDoh = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).nullish(),
});

export async function mxRecords(db: Db, domain: string, fetchImpl?: typeof fetch): Promise<string[]> {
  const res = await fetchJson(db, {
    provider: "doh", endpoint: "mx",
    url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
    init: { headers: { accept: "application/dns-json" } },
    schema: zDoh, cacheKey: `mx:${domain}`, cacheTtlMs: 86_400_000, fetchImpl,
  });
  return (res.Answer ?? []).filter(a => a.type === 15).map(a => a.data.split(" ").pop()!.replace(/\.$/, ""));
}

export async function domainAcceptsMail(db: Db, domain: string, fetchImpl?: typeof fetch): Promise<boolean> {
  try { return (await mxRecords(db, domain, fetchImpl)).length > 0; } catch { return false; }
}

export type EmailPattern = "first.last" | "flast" | "first" | "firstlast" | "first_last" | "f.last" | "last";

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

export function applyPattern(pattern: EmailPattern, first: string, last: string, domain: string): string | null {
  const f = strip(first), l = strip(last);
  if (!f || !l) return null;
  const local = {
    "first.last": `${f}.${l}`, flast: `${f[0]}${l}`, first: f, firstlast: `${f}${l}`,
    first_last: `${f}_${l}`, "f.last": `${f[0]}.${l}`, last: l,
  }[pattern];
  return `${local}@${domain}`;
}

/** Learns the dominant pattern from known addresses at one domain. Needs at least 2 agreeing examples. */
export function inferPattern(known: { first: string; last: string; email: string }[]): EmailPattern | null {
  const counts = new Map<EmailPattern, number>();
  const patterns: EmailPattern[] = ["first.last", "flast", "first", "firstlast", "first_last", "f.last", "last"];
  for (const k of known) {
    const domain = k.email.split("@")[1];
    if (!domain) continue;
    for (const p of patterns) {
      if (applyPattern(p, k.first, k.last, domain) === k.email.toLowerCase()) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 2 ? best[0] : null;
}
