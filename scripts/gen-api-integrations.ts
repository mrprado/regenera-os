// Generates docs/API_INTEGRATIONS.md from the integration registry, so the document can never drift from the code.
// Run: npx tsx scripts/gen-api-integrations.ts
import { writeFileSync } from "node:fs";
import { INTEGRATIONS } from "../lib/integrations/registry";
import { PROBES } from "../lib/integrations/adapters";

const STATE: Record<string, string> = { enabled: "Enabled", development_only: "Development only", license_required: "Licence required (off)", disabled: "Disabled" };
const COST = (i: (typeof INTEGRATIONS)[number]) => /paid|subscription|plan|billing/i.test(`${i.license} ${i.notes ?? ""}`) ? "Paid / licensed" : i.commercialUse === "no" ? "Free for non-commercial only" : i.auth === "none" ? "Free (no key)" : "Free with credential";
const esc = (s: string) => s.replace(/\|/g, "\|");
const rows = [...INTEGRATIONS].sort((a, b) => a.category.localeCompare(b.category) || a.provider.localeCompare(b.provider)).map(i =>
  `| ${esc(i.provider)} | ${esc(`${i.dataset} (${i.coverage})`)} | ${i.auth === "none" ? "None" : i.auth} | ${COST(i)} | ${esc(`${i.license}; commercial: ${i.commercialUse}; redistribution: ${i.redistribution}`)} | ${esc(i.rateLimit)} | ${esc(i.refresh)} | ${i.caching === "Required" || i.caching === "Allowed" ? "Cache; stale copy on failure" : "Manual import"} | ${i.envVar ?? "—"} | ${STATE[i.featureState]}${PROBES.includes(i.key) ? " · live Test" : ""}${i.notes ? ` · ${esc(i.notes)}` : ""} |`);

writeFileSync("docs/API_INTEGRATIONS.md", `# API integrations

Generated from lib/integrations/registry.ts (${INTEGRATIONS.length} providers) by scripts/gen-api-integrations.ts. Terms are as
understood when written; entries marked "verify" must be re-checked before production use. A public API is not an
unrestricted commercial licence.

How it works: every call goes through fetchJson (lib/sources/http.ts): the registry gate refuses disabled and
licence-required providers; responses are validated (zod), cached, retried with backoff on 429/5xx (honouring
Retry-After), logged to the provider_calls ledger (health, last success/failure), and a failing source can fall back to
its last cached copy, shown as stale. Credentials are Worker secrets read server-side only; without a credential the
adapter reports "Integration ready: credential required" and nothing is fabricated. CI runs adapters against recorded
fixtures (tests/unit/adapters.test.ts), never live keys. Settings → Integrations shows state, licence, credential
presence, health and a live Test for adapters that have one.

| Provider | Purpose | Authentication | Free / paid / licensed | Licence and commercial use | Rate limits | Refresh | Fallback | Environment | Status |
|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`);
console.log(`wrote ${INTEGRATIONS.length} rows`);
