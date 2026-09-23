// Google OAuth for Gmail, Calendar and Drive (SPEC section 24). Internal Workspace app.
import { z } from "zod";
import { fromBase64Url, hmac, safeEqual, toBase64Url } from "@/lib/crypto";
import { MAILBOX_ROLES } from "@/db/schema";

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

export type MailboxRole = (typeof MAILBOX_ROLES)[number];
export const zMailboxRole = z.enum(MAILBOX_ROLES);

export const STATE_COOKIE = "os_google_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

export function redirectUri(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/api/oauth/google/callback`;
}

export function authUrl(params: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: params.state,
  });
  if (params.loginHint) q.set("login_hint", params.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/**
 * State = "<mailbox>.<userId>.<expiresMs>.<nonce>.<sig>". The nonce is also set in an HttpOnly cookie,
 * so a state value is only usable from the browser that started the flow.
 */
export async function createState(secret: string, mailbox: MailboxRole, userId: string, now = Date.now()) {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const body = [mailbox, toBase64Url(new TextEncoder().encode(userId)), String(now + STATE_TTL_MS), nonce].join(".");
  return { state: `${body}.${await hmac(secret, "google-oauth-state", body)}`, nonce };
}

export async function verifyState(secret: string, state: string, cookieNonce: string | undefined, now = Date.now()):
  Promise<{ mailbox: MailboxRole; userId: string } | null> {
  const parts = state.split(".");
  if (parts.length !== 5) return null;
  const [mailbox, userIdB64, expires, nonce, sig] = parts;
  const body = parts.slice(0, 4).join(".");
  if (!safeEqual(sig, await hmac(secret, "google-oauth-state", body))) return null;
  if (!cookieNonce || !safeEqual(nonce, cookieNonce)) return null;
  if (Number(expires) < now) return null;
  const role = zMailboxRole.safeParse(mailbox);
  if (!role.success) return null;
  const userId = new TextDecoder().decode(fromBase64Url(userIdB64));
  return { mailbox: role.data, userId };
}

const zTokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof zTokenResponse>;

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token endpoint returned ${res.status}`);
  return zTokenResponse.parse(await res.json());
}

export function exchangeCode(p: { code: string; clientId: string; clientSecret: string; redirectUri: string }, fetchImpl: typeof fetch = fetch) {
  return tokenRequest({ code: p.code, client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri, grant_type: "authorization_code" }, fetchImpl);
}

export function refreshAccessToken(p: { refreshToken: string; clientId: string; clientSecret: string }, fetchImpl: typeof fetch = fetch) {
  return tokenRequest({ refresh_token: p.refreshToken, client_id: p.clientId, client_secret: p.clientSecret, grant_type: "refresh_token" }, fetchImpl);
}

export async function fetchAccountEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google userinfo returned ${res.status}`);
  const data = z.object({ email: z.string().email(), email_verified: z.boolean().optional() }).parse(await res.json());
  return data.email.toLowerCase();
}
