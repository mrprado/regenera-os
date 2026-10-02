import { env } from "cloudflare:workers";
import type { AiConfig } from "@/lib/ai/run";
import type { ApolloConfig } from "@/lib/sources/apollo";

export function aiConfig(): AiConfig | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return { apiKey: env.ANTHROPIC_API_KEY, monthlyBudgetUsd: Number(env.AI_MONTHLY_BUDGET_USD ?? 50) };
}

export function apolloConfig(): ApolloConfig | null {
  if (!env.APOLLO_API_KEY) return null;
  return { apiKey: env.APOLLO_API_KEY, monthlyCreditBudget: Number(env.APOLLO_MONTHLY_CREDIT_BUDGET ?? 50) };
}

/** Esri World Imagery via a free ArcGIS Location Platform key (referrer-restricted, safe in the browser). */
export function mapConfig() {
  return { esriKey: env.ESRI_API_KEY ?? null };
}

export function siteConfig(): { baseUrl: string; token: string } | null {
  if (!env.SITE_EXPORT_TOKEN) return null;
  return { baseUrl: env.SITE_BASE_URL ?? "https://regenera.bio", token: env.SITE_EXPORT_TOKEN };
}

/** Outbound email policy: outside production only allow-listed test domains can receive mail. */
export function sendPolicy() {
  return {
    production: env.APP_ENV === "production",
    allowedDomains: (env.SEND_ALLOWED_DOMAINS ?? "").split(",").map(d => d.trim().toLowerCase()).filter(Boolean),
    postalAddress: env.COMPANY_POSTAL_ADDRESS ?? null,
  };
}

/** Phase 2 outreach settings (docs/plans/phase-2.md defaults). */
export function outreachConfig() {
  const baseUrl = env.APP_BASE_URL ?? "https://os.regenera.bio";
  return {
    appBaseUrl: baseUrl,
    bookingUrl: env.BOOKING_URL ?? null,
    primaryDomain: "regenera.bio",
    sendingDomain: env.SENDING_DOMAIN ?? null,
    unsubscribe: env.UNSUBSCRIBE_SIGNING_SECRET ? { secret: env.UNSUBSCRIBE_SIGNING_SECRET, baseUrl } : null,
    caps: {
      primary: Number(env.PRIMARY_DAILY_CAP ?? 25),
      sendingCeiling: Number(env.SENDING_DAILY_CAP ?? 40),
      warmupStartedOn: env.SENDING_WARMUP_STARTED ?? null,
    },
    resend: env.RESEND_API_KEY && env.RESEND_FROM && env.NOTIFY_EMAIL ? { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM, to: env.NOTIFY_EMAIL } : null,
  };
}
