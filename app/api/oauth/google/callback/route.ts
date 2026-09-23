import { audit } from "@/lib/audit";
import { getOsApiUser } from "@/lib/auth";
import { appDb, isOwner } from "@/lib/db/scoped";
import { saveGoogleAccount } from "@/lib/google/accounts";
import { googleConfig } from "@/lib/google/config";
import { exchangeCode, fetchAccountEmail, redirectUri, STATE_COOKIE, verifyState } from "@/lib/google/oauth";

function readCookie(request: Request, name: string): string | undefined {
  const pair = (request.headers.get("cookie") || "").split(";").map(p => p.trim()).find(p => p.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

function back(status: string) {
  return new Response(null, {
    status: 302,
    headers: {
      location: `/settings/connections?google=${encodeURIComponent(status)}`,
      "set-cookie": `${STATE_COOKIE}=; Path=/api/oauth/google; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}

// Anonymous-capable route (SPEC section 23), protected by a signed state bound to this browser and user.
export async function GET(request: Request) {
  const cfg = googleConfig();
  if (!cfg) return back("not_configured");

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const state = await verifyState(cfg.encryptionKey, url.searchParams.get("state") || "", readCookie(request, STATE_COOKIE));
  if (!code || !state) return back("invalid_state");

  // The flow was started by an owner; the same signed-in owner must finish it.
  const user = await getOsApiUser();
  if (!user || user.userId !== state.userId || !isOwner(user.scope)) return back("not_authorized");

  try {
    const tokens = await exchangeCode({ code, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: redirectUri(cfg.appBaseUrl) });
    const email = await fetchAccountEmail(tokens.access_token);
    const db = appDb();
    await saveGoogleAccount(db, cfg, state.mailbox, email, tokens);
    await audit(db, { actor: user.email, action: "google_connected", entity: "oauth_accounts", entityId: state.mailbox, after: { email, scopes: tokens.scope } });
    return back("connected");
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return back("error");
  }
}
