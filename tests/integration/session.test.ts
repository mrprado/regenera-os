import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authFailures, authSessions, mandateMembers, mandates } from "@/db/schema";
import { endSession, fixedPasswordCheck, normalizeEmail, safeReturnTo, sessionEmail, trackerPasswordCheck, verifyPassword } from "@/lib/session";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const NOW = new Date("2026-09-24T12:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const ALLOW = new Set(["alan@regenera.bio"]);
const check = fixedPasswordCheck("right-password");
const attempt = (email: string, password: string, at = NOW, ip = "1.1.1.1") => verifyPassword(t.db, { email, password, ip }, ALLOW, check, at);

beforeEach(async () => {
  for (const x of [authFailures, authSessions, mandateMembers, mandates]) await t.db.delete(x);
});

describe("email + password sign-in", () => {
  it("needs both an email that may sign in and the right password", async () => {
    expect(await attempt("alan@regenera.bio", "right-password")).toMatchObject({ ok: true });
    expect(await attempt("alan@regenera.bio", "wrong")).toEqual({ ok: false, reason: "invalid" });
    expect(await attempt("stranger@x.com", "right-password")).toEqual({ ok: false, reason: "invalid" });
    // Once members exist, the allowlist no longer grants access.
    await t.db.insert(mandates).values({ id: "m1", slug: "r", name: "R", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
    await t.db.insert(mandateMembers).values({ mandateId: "m1", email: "member@regenera.bio", role: "member" });
    expect(await attempt("alan@regenera.bio", "right-password")).toMatchObject({ ok: false });
    expect(await attempt("member@regenera.bio", "right-password")).toMatchObject({ ok: true });
  });

  it("never asks the tracker about emails that cannot sign in", async () => {
    let calls = 0;
    const counting = async () => { calls++; return true; };
    expect(await verifyPassword(t.db, { email: "stranger@x.com", password: "x", ip: "1" }, ALLOW, counting, NOW)).toMatchObject({ ok: false });
    expect(calls).toBe(0);
  });

  it("does not lock out after repeated failures (lockout is off for now)", async () => {
    for (let i = 0; i < 8; i++) await attempt("alan@regenera.bio", "wrong", later(i * 1000));
    expect(await attempt("alan@regenera.bio", "right-password", later(9000))).toMatchObject({ ok: true });
  });

  it("the tracker check passes only on HTTP 200", async () => {
    const seen: string[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      seen.push(String(init?.body));
      return new Response("{}", { status: JSON.parse(String(init?.body)).password === "tracker-pw" ? 200 : 401 });
    }) as unknown as typeof fetch;
    const tracker = trackerPasswordCheck("https://regenera.bio/api/pipeline/auth", fake);
    expect(await tracker("tracker-pw")).toBe(true);
    expect(await tracker("nope")).toBe(false);
    expect(seen[0]).toBe(JSON.stringify({ password: "tracker-pw" }));
  });

  it("sessions store only hashes and last until they expire or are ended", async () => {
    const r = await attempt("alan@regenera.bio", "right-password");
    if (!r.ok) throw new Error("sign-in failed");
    const [row] = await t.db.select().from(authSessions);
    expect(row.tokenHash).not.toContain(r.session);
    expect(await sessionEmail(t.db, r.session, later(86_400_000))).toBe("alan@regenera.bio");
    expect(await sessionEmail(t.db, r.session, later(31 * 86_400_000))).toBeNull();
    expect(await sessionEmail(t.db, "forged", NOW)).toBeNull();
    await endSession(t.db, r.session);
    expect(await sessionEmail(t.db, r.session, NOW)).toBeNull();
  });

  it("keeps return paths inside the app and emails well formed", () => {
    expect(safeReturnTo("//evil.com")).toBe("/today");
    expect(safeReturnTo("https://evil.com")).toBe("/today");
    expect(safeReturnTo("/\\evil.com")).toBe("/today");
    expect(safeReturnTo("/deals?view=table")).toBe("/deals?view=table");
    expect(normalizeEmail(" Alan@Regenera.bio ")).toBe("alan@regenera.bio");
    expect(normalizeEmail("nope")).toBeNull();
  });
});
