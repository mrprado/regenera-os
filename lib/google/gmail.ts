import { z } from "zod";
import { toBase64Url } from "@/lib/crypto";

const utf8 = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function encodeHeaderWord(value: string): string {
  // RFC 2047 for non-ASCII header text (names, subjects).
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(utf8.encode(value))}?=`;
}

function assertNoHeaderInjection(...values: string[]) {
  for (const v of values) if (/[\r\n]/.test(v)) throw new Error("Header values cannot contain line breaks");
}

export type OutgoingEmail = {
  from: string;          // "Name <addr>" or "addr"
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
  extraHeaders?: Record<string, string>;
};

/** Builds a plain-text RFC 5322 message, base64url-encoded for Gmail's `raw` field. */
export function buildRawMessage(m: OutgoingEmail): string {
  assertNoHeaderInjection(m.from, m.to, m.subject, m.inReplyTo ?? "", m.references ?? "", ...Object.values(m.extraHeaders ?? {}));
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeaderWord(m.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    ...Object.entries(m.extraHeaders ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];
  const body = base64(utf8.encode(m.text.replace(/\r?\n/g, "\r\n"))).replace(/.{1,76}/g, "$&\r\n");
  return toBase64Url(utf8.encode(`${headers.join("\r\n")}\r\n\r\n${body}`));
}

const zSendResult = z.object({ id: z.string(), threadId: z.string() });

export async function gmailSend(accessToken: string, raw: string, threadId?: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new Error("Gmail rate limit (429): mailbox paused for today");
  if (!res.ok) throw new Error(`Gmail send returned ${res.status}`);
  return zSendResult.parse(await res.json());
}
