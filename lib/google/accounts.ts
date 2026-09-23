import { eq, and } from "drizzle-orm";
import type { Db } from "@/db";
import { oauthAccounts } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { refreshAccessToken, type MailboxRole, type TokenResponse } from "./oauth";

export type GoogleConfig = { clientId: string; clientSecret: string; encryptionKey: string };

export async function saveGoogleAccount(db: Db, cfg: GoogleConfig, role: MailboxRole, email: string, tokens: TokenResponse, now = new Date()) {
  const [existing] = await db.select().from(oauthAccounts).where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.mailboxRole, role)));
  const accessTokenEnc = await encryptSecret(tokens.access_token, cfg.encryptionKey);
  // Google omits refresh_token on re-consent sometimes; keep the stored one in that case.
  const refreshTokenEnc = tokens.refresh_token ? await encryptSecret(tokens.refresh_token, cfg.encryptionKey) : existing?.refreshTokenEnc ?? null;
  const values = {
    provider: "google",
    mailboxRole: role,
    email,
    accessTokenEnc,
    refreshTokenEnc,
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    scopes: tokens.scope,
    warmupStartedOn: existing?.warmupStartedOn ?? (role === "sending" ? now.toISOString().slice(0, 10) : null),
    updatedAt: now.toISOString(),
  };
  if (existing) await db.update(oauthAccounts).set(values).where(eq(oauthAccounts.id, existing.id));
  else await db.insert(oauthAccounts).values(values);
}

/** Returns a usable access token for the mailbox, refreshing (and re-encrypting) if within 60s of expiry. */
export async function getAccessToken(db: Db, cfg: GoogleConfig, role: MailboxRole, now = new Date(), fetchImpl: typeof fetch = fetch) {
  const [acct] = await db.select().from(oauthAccounts).where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.mailboxRole, role)));
  if (!acct) throw new Error(`The ${role} mailbox is not connected`);
  if (new Date(acct.accessTokenExpiresAt).getTime() - now.getTime() > 60_000) {
    return { accessToken: await decryptSecret(acct.accessTokenEnc, cfg.encryptionKey), email: acct.email };
  }
  if (!acct.refreshTokenEnc) throw new Error(`The ${role} mailbox needs to be reconnected`);
  const refreshed = await refreshAccessToken({
    refreshToken: await decryptSecret(acct.refreshTokenEnc, cfg.encryptionKey),
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
  }, fetchImpl);
  await saveGoogleAccount(db, cfg, role, acct.email, refreshed, now);
  return { accessToken: refreshed.access_token, email: acct.email };
}
