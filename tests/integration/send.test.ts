import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activities, contacts, mandates, messages, oauthAccounts, suppression } from "@/db/schema";
import { upsertContact } from "@/lib/crm/entities";
import { claimMessage, composeManualEmail, sendClaimedMessage, type SendPolicy } from "@/lib/crm/send";
import { validateMessage } from "@/lib/style/validate";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const STAGING: SendPolicy = { production: false, allowedDomains: ["test.regenera.bio"], postalAddress: "Test address" };
const BODY = "Your closure plan filing points to a land decision this year. A short diagnostic would map the watershed and grid conditions first. Would a 20-minute call next week be useful?";

async function contact(email: string, status: "verified_provider" | "unverified" = "verified_provider", mandateId = "m_adv") {
  return (await upsertContact(t.db, mandateId, { fullName: "Test Person", email, emailStatus: status }, "other", { source: "test" })).row;
}

beforeEach(async () => {
  for (const x of [activities, messages, suppression, contacts, oauthAccounts, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: "m_adv", slug: "adv", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: "m_inv", slug: "inv", name: "RA-ESG", type: "investment", rules: { massAllowed: false, approvalRequired: true } },
  ]);
  await t.db.insert(oauthAccounts).values({ mailboxRole: "primary", email: "alanprado@regenera.bio", accessTokenEnc: "x", accessTokenExpiresAt: "2099-01-01T00:00:00Z", scopes: "gmail.send" });
});

describe("compose guards", () => {
  it("refuses recipients outside the allowed test domains when not in production", async () => {
    const c = await contact("real.person@bigfund.com");
    const r = await composeManualEmail(t.db, { contactId: c.id, subject: "Diagnostic", body: BODY, approvedBy: "a", confirmUnverified: false, policy: STAGING });
    expect(r).toEqual({ ok: false, reason: "recipient_not_allowed" });
  });

  it("refuses investment-mandate contacts", async () => {
    const c = await contact("x@test.regenera.bio", "verified_provider", "m_inv");
    expect((await composeManualEmail(t.db, { contactId: c.id, subject: "s", body: BODY, approvedBy: "a", confirmUnverified: true, policy: STAGING })).ok).toBe(false);
  });

  it("requires explicit confirmation for unverified addresses", async () => {
    const c = await contact("u@test.regenera.bio", "unverified");
    expect(await composeManualEmail(t.db, { contactId: c.id, subject: "s", body: BODY, approvedBy: "a", confirmUnverified: false, policy: STAGING })).toEqual({ ok: false, reason: "needs_confirmation" });
    expect((await composeManualEmail(t.db, { contactId: c.id, subject: "s", body: BODY, approvedBy: "a", confirmUnverified: true, policy: STAGING })).ok).toBe(true);
  });

  it("blocks house-style violations", async () => {
    const c = await contact("s@test.regenera.bio");
    const r = await composeManualEmail(t.db, { contactId: c.id, subject: "Guaranteed — returns", body: "Sign the NCNDA!", approvedBy: "a", confirmUnverified: false, policy: STAGING });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues?.map(i => i.rule).sort()).toEqual(["ncnda", "no_dashes", "no_exclamation", "role_boundary"]);
  });
});

describe("send", () => {
  it("claims a message exactly once under parallel senders and records the send", async () => {
    const c = await contact("ok@test.regenera.bio");
    const r = await composeManualEmail(t.db, { contactId: c.id, subject: "Diagnostic", body: BODY, approvedBy: "alan", confirmUnverified: false, policy: STAGING });
    if (!r.ok) throw new Error(r.reason);
    const claims = await Promise.all(Array.from({ length: 5 }, () => claimMessage(t.db, r.messageId)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    let calls = 0;
    const fakeGmail = (async (_u: unknown, init?: RequestInit) => { if (init?.method === "POST") calls++; return new Response(JSON.stringify({ id: "gm1", threadId: "th1" }), { status: 200 }); }) as unknown as typeof fetch;
    const res = await sendClaimedMessage(t.db, r.messageId, async () => ({ accessToken: "t", email: "alanprado@regenera.bio" }), STAGING, fakeGmail);
    expect(res.sent).toBe(true);
    const again = await sendClaimedMessage(t.db, r.messageId, async () => ({ accessToken: "t", email: "alanprado@regenera.bio" }), STAGING, fakeGmail);
    expect(again.sent).toBe(false);
    expect(calls).toBe(1);
    const [m] = await t.db.select().from(messages).where(eq(messages.id, r.messageId));
    expect(m).toMatchObject({ status: "sent", gmailThreadId: "th1" });
    expect(await t.db.select().from(activities)).toHaveLength(1);
  });

  it("will not claim a message whose recipient was suppressed after approval", async () => {
    const c = await contact("gone@test.regenera.bio");
    const r = await composeManualEmail(t.db, { contactId: c.id, subject: "Diagnostic", body: BODY, approvedBy: "alan", confirmUnverified: false, policy: STAGING });
    if (!r.ok) throw new Error(r.reason);
    await t.db.insert(suppression).values({ email: "gone@test.regenera.bio", reason: "unsubscribe" });
    expect(await claimMessage(t.db, r.messageId)).toBeNull();
  });

  it("will not claim when the whole domain is suppressed", async () => {
    const c = await contact("any@test.regenera.bio");
    const r = await composeManualEmail(t.db, { contactId: c.id, subject: "Diagnostic", body: BODY, approvedBy: "alan", confirmUnverified: false, policy: STAGING });
    if (!r.ok) throw new Error(r.reason);
    await t.db.insert(suppression).values({ domain: "test.regenera.bio", reason: "legal" });
    expect(await claimMessage(t.db, r.messageId)).toBeNull();
  });
});

describe("validateMessage", () => {
  it("passes a clean first touch and enforces the 120-word limit", () => {
    expect(validateMessage({ subject: "Diagnostic", body: BODY }, { firstTouch: true, advisory: true })).toEqual([]);
    const long = Array.from({ length: 130 }, () => "word").join(" ");
    expect(validateMessage({ subject: "s", body: long }, { firstTouch: true, advisory: true }).map(i => i.rule)).toEqual(["length"]);
    expect(validateMessage({ subject: "s", body: long }, { firstTouch: false, advisory: true })).toEqual([]);
  });

  it("flags securities terms in advisory outreach and unsourced carbon-neutral claims", () => {
    expect(validateMessage({ subject: "s", body: "Target IRR is attractive." }, { firstTouch: false, advisory: true }).map(i => i.rule)).toContain("securities_terms");
    expect(validateMessage({ subject: "s", body: "The site is carbon neutral." }, { firstTouch: false, advisory: true }).map(i => i.rule)).toContain("greenwashing");
  });
});
