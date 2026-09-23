import { describe, expect, it } from "vitest";
import { bearerMatches, decryptSecret, encryptSecret, hmac, safeEqual } from "@/lib/crypto";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("token encryption", () => {
  it("round-trips and never stores plaintext", async () => {
    const ct = await encryptSecret("ya29.secret-token", KEY);
    expect(ct).not.toContain("secret-token");
    expect(await decryptSecret(ct, KEY)).toBe("ya29.secret-token");
  });

  it("uses a fresh IV each time", async () => {
    expect(await encryptSecret("x", KEY)).not.toBe(await encryptSecret("x", KEY));
  });

  it("fails with the wrong key or tampered ciphertext", async () => {
    const ct = await encryptSecret("x", KEY);
    await expect(decryptSecret(ct, OTHER)).rejects.toThrow();
    await expect(decryptSecret(ct.slice(0, -2) + "AA", KEY)).rejects.toThrow();
  });

  it("rejects malformed keys", async () => {
    await expect(encryptSecret("x", "short")).rejects.toThrow(/64 hex/);
  });
});

describe("hmac and comparisons", () => {
  it("separates purposes", async () => {
    expect(await hmac("s", "a", "m")).not.toBe(await hmac("s", "b", "m"));
  });

  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("bearerMatches", () => {
    const req = (h?: string) => new Request("https://x/api/jobs/tick", { method: "POST", headers: h ? { authorization: h } : {} });
    expect(bearerMatches(req("Bearer t0k"), "t0k")).toBe(true);
    expect(bearerMatches(req("Bearer nope"), "t0k")).toBe(false);
    expect(bearerMatches(req(), "t0k")).toBe(false);
    expect(bearerMatches(req("Bearer "), "")).toBe(false);
    expect(bearerMatches(req("Bearer t0k"), undefined)).toBe(false);
  });
});
