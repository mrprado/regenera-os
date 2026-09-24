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
