// OAuth 2.1 for the Regenera OS MCP server (docs/plans/phase-4.md item 2): dynamic client registration,
// authorization code with PKCE (S256 only), short-lived access tokens with rotating refresh tokens, plus revocable
// personal tokens for Claude Code and Claude Desktop. Everything is stored hashed in D1. The consent screen
// runs under the normal Sign in with ChatGPT and allowlist.
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { mandateMembers, mcpClients, mcpCodes, mcpTokens } from "@/db/schema";
import { safeEqual, toBase64Url } from "@/lib/crypto";
import type { UserScope } from "@/lib/db/scoped";

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86_400;
const CODE_TTL_MS = 5 * 60_000;

const enc = new TextEncoder();
export async function sha256b64url(value: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
}
const random = (prefix: string, bytes = 32) => `${prefix}${toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))}`;

export function metadata(baseUrl: string) {
  const b = baseUrl.replace(/\/$/, "");
  return {
    authorizationServer: {
      issuer: b,
      authorization_endpoint: `${b}/connect/mcp`,
      token_endpoint: `${b}/api/oauth/mcp/token`,
      registration_endpoint: `${b}/api/oauth/mcp/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["crm"],
    },
    protectedResource: { resource: `${b}/api/mcp`, authorization_servers: [b], scopes_supported: ["crm"], bearer_methods_supported: ["header"] },
  };
}

// ---------- registration ----------
export const zRegistration = z.object({
  client_name: z.string().trim().min(1).max(120).default("MCP client"),
  redirect_uris: z.array(z.string().url()).min(1).max(5),
});

/** Only https redirect URIs, or loopback http for local clients. */
export function redirectAllowed(uri: string) {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch { return false; }
}

export async function registerClient(db: Db, input: z.infer<typeof zRegistration>) {
  if (!input.redirect_uris.every(redirectAllowed)) throw new Error("redirect_uris must be https (or http on localhost)");
  const clientId = random("mcpc_", 16);
  await db.insert(mcpClients).values({ clientId, name: input.client_name, redirectUris: input.redirect_uris });
  return { client_id: clientId, client_name: input.client_name, redirect_uris: input.redirect_uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
}

export async function getClient(db: Db, clientId: string) {
  const [c] = await db.select().from(mcpClients).where(eq(mcpClients.clientId, clientId));
  return c ?? null;
}

// ---------- authorization ----------
export const zAuthorize = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(500).optional(),
});

export async function issueCode(db: Db, a: { clientId: string; userEmail: string; redirectUri: string; codeChallenge: string }, now = new Date()) {
  const code = random("mcpa_");
  await db.insert(mcpCodes).values({ codeHash: await sha256b64url(code), clientId: a.clientId, userEmail: a.userEmail.toLowerCase(), redirectUri: a.redirectUri, codeChallenge: a.codeChallenge, expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString() });
  return code;
}

async function issueTokens(db: Db, clientId: string | null, userEmail: string, now: Date) {
  const access = random("mcpt_"), refresh = random("mcpr_");
  await db.insert(mcpTokens).values([
    { tokenHash: await sha256b64url(access), kind: "access", clientId, userEmail, expiresAt: new Date(now.getTime() + ACCESS_TTL_S * 1000).toISOString() },
    { tokenHash: await sha256b64url(refresh), kind: "refresh", clientId, userEmail, expiresAt: new Date(now.getTime() + REFRESH_TTL_S * 1000).toISOString() },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: "crm" };
}

export type TokenError = { error: "invalid_request" | "invalid_grant" | "invalid_client" | "unsupported_grant_type"; error_description: string };

export async function exchangeToken(db: Db, form: URLSearchParams, now = new Date()): Promise<{ ok: true; body: Awaited<ReturnType<typeof issueTokens>> } | { ok: false; body: TokenError }> {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  if (grant === "authorization_code") {
    const code = form.get("code") ?? "", verifier = form.get("code_verifier") ?? "", redirectUri = form.get("redirect_uri") ?? "";
    if (!code || !verifier) return { ok: false, body: { error: "invalid_request", error_description: "code and code_verifier are required" } };
    // Single use: the code row is consumed atomically before anything else.
    const [row] = await db.update(mcpCodes).set({ usedAt: now.toISOString() })
      .where(and(eq(mcpCodes.codeHash, await sha256b64url(code)), isNull(mcpCodes.usedAt))).returning();
    if (!row || row.expiresAt < now.toISOString()) return { ok: false, body: { error: "invalid_grant", error_description: "Code is invalid, used or expired" } };
    if (row.clientId !== clientId || row.redirectUri !== redirectUri) return { ok: false, body: { error: "invalid_grant", error_description: "Client or redirect URI does not match" } };
    if (!safeEqual(await sha256b64url(verifier), row.codeChallenge)) return { ok: false, body: { error: "invalid_grant", error_description: "PKCE verification failed" } };
    return { ok: true, body: await issueTokens(db, row.clientId, row.userEmail, now) };
  }
  if (grant === "refresh_token") {
    const hash = await sha256b64url(form.get("refresh_token") ?? "");
    // Rotation: the old refresh token is revoked as it is used.
    const [old] = await db.update(mcpTokens).set({ revokedAt: now.toISOString() })
      .where(and(eq(mcpTokens.tokenHash, hash), eq(mcpTokens.kind, "refresh"), isNull(mcpTokens.revokedAt))).returning();
    if (!old || (old.expiresAt && old.expiresAt < now.toISOString()) || (clientId && old.clientId !== clientId)) return { ok: false, body: { error: "invalid_grant", error_description: "Refresh token is invalid or expired" } };
    return { ok: true, body: await issueTokens(db, old.clientId, old.userEmail, now) };
  }
  return { ok: false, body: { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token" } };
}

export async function issuePersonalToken(db: Db, userEmail: string, label: string) {
  const token = random("mcpp_");
  await db.insert(mcpTokens).values({ tokenHash: await sha256b64url(token), kind: "personal", userEmail: userEmail.toLowerCase(), label: label.slice(0, 80) });
  return token;
}

export async function revokeGrant(db: Db, userEmail: string, by: { tokenId?: string; clientId?: string }, now = new Date()) {
  const cond = by.tokenId ? eq(mcpTokens.id, by.tokenId) : eq(mcpTokens.clientId, by.clientId ?? "__none__");
  await db.update(mcpTokens).set({ revokedAt: now.toISOString() }).where(and(cond, eq(mcpTokens.userEmail, userEmail.toLowerCase()), isNull(mcpTokens.revokedAt)));
}

/** Bearer check for /api/mcp. Returns the member's full scope (every mandate they belong to), or null. */
export async function verifyMcpToken(db: Db, header: string | null, now = new Date()): Promise<UserScope | null> {
  const token = header?.match(/^Bearer\s+(mcp[tp]_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const [row] = await db.select().from(mcpTokens).where(and(eq(mcpTokens.tokenHash, await sha256b64url(token)), isNull(mcpTokens.revokedAt)));
  if (!row || row.kind === "refresh" || (row.expiresAt && row.expiresAt < now.toISOString())) return null;
  const members = await db.select().from(mandateMembers).where(eq(mandateMembers.email, row.userEmail));
  if (!members.length) return null;
  await db.update(mcpTokens).set({ lastUsedAt: now.toISOString() }).where(eq(mcpTokens.id, row.id));
  const mandateIds = members.map(m => m.mandateId), ownerOf = members.filter(m => m.role === "owner").map(m => m.mandateId);
  return { kind: "user", userId: members[0].userId ?? `mcp:${row.userEmail}`, email: row.userEmail, mandateIds, ownerOf, memberOf: mandateIds, ownerOfAll: ownerOf };
}
