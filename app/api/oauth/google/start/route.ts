import { getOsApiUser } from "@/lib/auth";
import { isOwner } from "@/lib/db/scoped";
import { googleConfig } from "@/lib/google/config";
import { authUrl, createState, redirectUri, STATE_COOKIE, zMailboxRole } from "@/lib/google/oauth";

// Guarded: only a signed-in owner can start connecting a mailbox.
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user || !isOwner(user.scope)) return Response.json({ error: "Not authorized" }, { status: 403 });

  const cfg = googleConfig();
  if (!cfg) return Response.json({ error: "Google OAuth is not configured. See docs/ENV.md." }, { status: 503 });

  const mailbox = zMailboxRole.safeParse(new URL(request.url).searchParams.get("mailbox"));
  if (!mailbox.success) return Response.json({ error: "mailbox must be primary or sending" }, { status: 400 });

  const { state, nonce } = await createState(cfg.encryptionKey, mailbox.data, user.userId);
  const secure = cfg.appBaseUrl.startsWith("https://") ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      location: authUrl({ clientId: cfg.clientId, redirectUri: redirectUri(cfg.appBaseUrl), state }),
      "set-cookie": `${STATE_COOKIE}=${nonce}; Path=/api/oauth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    },
  });
}
