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

// ---------- reading (reply watcher, threading) ----------
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailGet(accessToken: string, path: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gmail ${path.split("?")[0]} returned ${res.status}`);
  return res.json() as Promise<unknown>;
}

const zHeader = z.object({ name: z.string(), value: z.string() });
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: z.infer<typeof zHeader>[] };
const zPart: z.ZodType<Part> = z.lazy(() => z.object({
  mimeType: z.string().optional(),
  body: z.object({ data: z.string().optional() }).optional(),
  parts: z.array(zPart).optional(),
  headers: z.array(zHeader).optional(),
}));
const zMessage = z.object({
  id: z.string(), threadId: z.string(), historyId: z.string().optional(), snippet: z.string().optional(),
  internalDate: z.string().optional(), labelIds: z.array(z.string()).optional(), payload: zPart.optional(),
});
export type GmailMessage = z.infer<typeof zMessage>;

export function header(m: GmailMessage, name: string): string | undefined {
  return m.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** First text/plain part, decoded. */
export function plainBody(m: GmailMessage): string {
  const find = (p: Part | undefined): string | undefined => {
    if (!p) return undefined;
    if (p.mimeType === "text/plain" && p.body?.data) return new TextDecoder().decode(fromB64Url(p.body.data));
    for (const c of p.parts ?? []) { const t = find(c); if (t) return t; }
    return undefined;
  };
  return find(m.payload) ?? "";
}

function fromB64Url(v: string) {
  const bin = atob(v.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((v.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export async function gmailGetMessage(accessToken: string, id: string, format: "full" | "metadata" = "full", fetchImpl: typeof fetch = fetch) {
  const q = format === "metadata" ? "?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc" : "?format=full";
  const json = await gmailGet(accessToken, `/messages/${encodeURIComponent(id)}${q}`, fetchImpl);
  return json ? zMessage.parse(json) : null;
}

const zProfile = z.object({ emailAddress: z.string(), historyId: z.string() });
export async function gmailProfile(accessToken: string, fetchImpl: typeof fetch = fetch) {
  return zProfile.parse(await gmailGet(accessToken, "/profile", fetchImpl));
}

const zHistory = z.object({
  historyId: z.string(),
  nextPageToken: z.string().optional(),
  history: z.array(z.object({ messagesAdded: z.array(z.object({ message: z.object({ id: z.string(), threadId: z.string(), labelIds: z.array(z.string()).optional() }) })).optional() })).optional(),
});

/** Message ids added to INBOX since `startHistoryId`. Returns null when the cursor is too old (404): caller resets it. */
export async function gmailHistorySince(accessToken: string, startHistoryId: string, fetchImpl: typeof fetch = fetch) {
  const ids: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  let latest = startHistoryId;
  for (let page = 0; page < 5; page++) {
    const json = await gmailGet(accessToken, `/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&labelId=INBOX${pageToken ? `&pageToken=${pageToken}` : ""}`, fetchImpl);
    if (!json) return null;
    const h = zHistory.parse(json);
    latest = h.historyId;
    for (const rec of h.history ?? []) for (const a of rec.messagesAdded ?? []) {
      if (!a.message.labelIds || a.message.labelIds.includes("INBOX")) ids.push({ id: a.message.id, threadId: a.message.threadId });
    }
    pageToken = h.nextPageToken;
    if (!pageToken) break;
  }
  return { messages: ids, historyId: latest };
}
