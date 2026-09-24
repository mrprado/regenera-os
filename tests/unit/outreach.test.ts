import { describe, expect, it } from "vitest";
import { checkDomainDns, deliverabilityIssues, dmarcPolicy, shouldPause } from "@/lib/outreach/deliverability";
import { addresses, strengthOf } from "@/lib/outreach/relationships";
import { isBounce, parseAddress } from "@/lib/outreach/replies";
import { checkDraft } from "@/lib/outreach/sequences";

describe("deliverability", () => {
  it("reads DMARC policies", () => {
    expect(dmarcPolicy(["v=DMARC1; p=quarantine; rua=mailto:d@regenera.bio"])).toBe("quarantine");
    expect(dmarcPolicy(["v=spf1 include:_spf.google.com ~all"])).toBe("missing");
  });

  it("checks SPF, DKIM, DMARC and MX over DNS-over-HTTPS", async () => {
    const answers: Record<string, { type: number; data: string }[]> = {
      "regenera.bio|TXT": [{ type: 16, data: '"v=spf1 include:_spf.google.com ~all"' }],
      "_dmarc.regenera.bio|TXT": [{ type: 16, data: '"v=DMARC1; p=reject"' }],
      "regenera.bio|MX": [{ type: 15, data: "1 smtp.google.com." }],
      "google._domainkey.regenera.bio|TXT": [{ type: 16, data: '"v=DKIM1; k=rsa; p=MIIB" "IjANBg"' }],
    };
    const f = (async (url: string) => {
      const u = new URL(url);
      return Response.json({ Status: 0, Answer: answers[`${u.searchParams.get("name")}|${u.searchParams.get("type")}`] ?? null });
    }) as unknown as typeof fetch;
    const r = await checkDomainDns("regenera.bio", ["google"], f);
    expect(r).toMatchObject({ spf: true, dmarc: "reject", dkim: true, mx: true });
    expect(deliverabilityIssues({ domain: "regenera.bio", ...r })).toEqual([]);
    expect(deliverabilityIssues({ domain: "x.test", spf: false, dmarc: "missing", dkim: false, mx: true })).toHaveLength(3);
  });

  it("pauses above 3% bounces with at least 20 sends, or on any complaint", () => {
    expect(shouldPause({ sent: 19, bounceRate: 0.2, hostile: 0 })).toBeNull();
    expect(shouldPause({ sent: 40, bounceRate: 0.05, hostile: 0 })).toMatch(/Bounce rate 5\.0%/);
    expect(shouldPause({ sent: 40, bounceRate: 0.02, hostile: 0 })).toBeNull();
    expect(shouldPause({ sent: 3, bounceRate: 0, hostile: 1 })).not.toBeNull();
  });
});

describe("mail parsing", () => {
  it("parses senders and spots bounces", () => {
    expect(parseAddress("Ana Ruiz <Ana.Ruiz@Fund.com>")).toBe("ana.ruiz@fund.com");
    expect(isBounce("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "x")).toBe(true);
    expect(isBounce("ana@fund.com", "Undeliverable: hello")).toBe(true);
    expect(isBounce("ana@fund.com", "Re: diagnostic")).toBe(false);
    expect(addresses("A <a@x.com>, b@Y.org")).toEqual(["a@x.com", "b@y.org"]);
  });

  it("scores relationships with decay", () => {
    const now = new Date("2026-09-23T00:00:00Z");
    const fresh = strengthOf({ emailsSent: 5, emailsReceived: 5, meetings: 1, lastContactAt: "2026-09-01T00:00:00Z" }, now);
    const stale = strengthOf({ emailsSent: 5, emailsReceived: 5, meetings: 1, lastContactAt: "2025-10-01T00:00:00Z" }, now);
    expect(fresh).toBeGreaterThan(stale);
    expect(strengthOf({ emailsSent: 50, emailsReceived: 50, meetings: 20, lastContactAt: "2026-09-22T00:00:00Z" }, now)).toBeLessThanOrEqual(100);
  });
});

describe("LinkedIn drafts", () => {
  it("enforces the connection-note length", () => {
    const long = "a ".repeat(200);
    expect(checkDraft({ step: 1, channel: "linkedin_connect", subject: "", body: long, angle_tag: "", personalization_refs: [] }, false).map(i => i.rule)).toEqual(["length"]);
    expect(checkDraft({ step: 1, channel: "linkedin_message", subject: "", body: long, angle_tag: "", personalization_refs: [] }, false)).toEqual([]);
  });
});
