import { env } from "cloudflare:workers";
import type { GoogleConfig } from "./accounts";

export function googleConfig(): (GoogleConfig & { appBaseUrl: string }) | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    appBaseUrl: env.APP_BASE_URL,
  };
}
