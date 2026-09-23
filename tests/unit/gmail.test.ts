import { describe, expect, it } from "vitest";
import { fromBase64Url } from "@/lib/crypto";
import { buildRawMessage } from "@/lib/google/gmail";
import { createState, verifyState } from "@/lib/google/oauth";

const decode = (raw: string) => new TextDecoder().decode(fromBase64Url(raw));

describe("buildRawMessage", () => {
  it("builds a plain-text message with threading headers", () => {
    const msg = decode(buildRawMessage({
      from: "Alan Prado <alanprado@regenera.bio>",
      to: "test@example.com",
      subject: "Your closure plan filing",
      text: "Line one\nLine two",
      inReplyTo: "<abc@mail.gmail.com>",
      references: "<abc@mail.gmail.com>",
    }));
    expect(msg).toContain("From: Alan Prado <alanprado@regenera.bio>\r\n");
    expect(msg).toContain("Subject: Your closure plan filing\r\n");
    expect(msg).toContain("In-Reply-To: <abc@mail.gmail.com>\r\n");
    expect(msg).toContain("Content-Type: text/plain; charset=UTF-8");
    const body = msg.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0)))).toBe("Line one\r\nLine two");
  });

  it("encodes non-ASCII subjects", () => {
    expect(decode(buildRawMessage({ from: "a@b.co", to: "c@d.co", subject: "Diagnóstico", text: "x" }))).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("rejects header injection", () => {
    expect(() => buildRawMessage({ from: "a@b.co", to: "c@d.co\r\nBcc: x@y.z", subject: "s", text: "x" })).toThrow(/line breaks/);
  });
});

describe("OAuth state", () => {
  const secret = "c".repeat(64);

  it("round-trips when the cookie nonce matches", async () => {
    const { state, nonce } = await createState(secret, "sending", "u_prado");
    expect(await verifyState(secret, state, nonce)).toEqual({ mailbox: "sending", userId: "u_prado" });
  });

  it("rejects a missing or wrong nonce, tampering, expiry and bad mailbox", async () => {
    const now = Date.now();
    const { state, nonce } = await createState(secret, "primary", "u_prado", now);
    expect(await verifyState(secret, state, undefined)).toBeNull();
    expect(await verifyState(secret, state, "other")).toBeNull();
    expect(await verifyState(secret, state.replace("primary", "sending"), nonce)).toBeNull();
    expect(await verifyState("d".repeat(64), state, nonce)).toBeNull();
    expect(await verifyState(secret, state, nonce, now + 11 * 60_000)).toBeNull();
  });
});
