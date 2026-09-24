# Environment, bindings and accounts

Secrets go in the Sites project's secret settings (production) and `.dev.vars` (local, ignored). Never commit them.

## What Prado provides

| Name | Needed by phase | How to get it |
|---|---|---|
| `OS_ALLOWLIST` | 0 | Your sign-in email(s), comma-separated. The ChatGPT account email you will use to open the OS |
| `JOBS_TICK_TOKEN` | 0 | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Same value goes into the scheduler |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 0 | Google Cloud project → OAuth consent screen **Internal** → OAuth client (Web). Redirect URI `https://os.regenera.bio/api/oauth/google/callback` (+ `http://localhost:5180/api/oauth/google/callback` for local). Enable Gmail, Calendar, Drive APIs |
| `TOKEN_ENCRYPTION_KEY` | 0 | Generate 32 random bytes (same command as above) |
| `APP_BASE_URL` | 0 | `https://os.regenera.bio` |
| `ANTHROPIC_API_KEY` | 1 | Anthropic Console; set a monthly spend limit |
| `APOLLO_API_KEY` | 1 | Free Apollo.io account registered with a work email (e.g. alanprado@regenera.bio) → Settings → Integrations → API |
| `APOLLO_MONTHLY_CREDIT_BUDGET` | 1 | Credits per month the OS may spend on enrichment. Default 50; keep it within the free plan's allowance |
| `APOLLO_PLAN` | 1 | `free` (default). Sets the rate limits the OS enforces |
| `SITE_WEBHOOK_SECRET`, `SITE_EXPORT_TOKEN` | 1 | Generate; the same values are set on the regenera.bio Sites project |
| `RESEND_API_KEY`, `RESEND_FROM` | 2 | Existing Resend account the site uses; `RESEND_FROM` e.g. `Regenera OS <os@mail.regenera.bio>` |
| `NOTIFY_EMAIL` | 2 | `alanprado@regenera.bio` |
| `BOOKING_URL` | 2 | `https://calendar.app.google/FDK2Hz8rs3VpZSRp7` |
| `UNSUBSCRIBE_SIGNING_SECRET` | 2 | Generate |
| `COMPANY_POSTAL_ADDRESS` | 2 (before first mass send) | Legal entity postal address |
| `EXTENSION_TOKEN_SECRET` | 3 | Generate |

## Bindings (declared in `.openai/hosting.json`)

| Binding | Kind |
|---|---|
| `DB` | D1 database for the OS (separate from the site's) |
| `BUCKET` | R2 bucket for imports, exports, attachments |

## Accounts checklist

- [ ] Second Sites project created for this repository, D1 and R2 enabled, custom domain `os.regenera.bio`
- [ ] MFA enabled on the ChatGPT account(s) that sign in to the OS
- [ ] Google Workspace confirmed for regenera.bio; secondary sending domain registered with its own mailbox
- [ ] SPF, DKIM, DMARC on both domains (leave `mail.regenera.bio` Resend records intact); warm-up started
- [ ] Google Cloud project with internal OAuth app (above)
- [ ] Scheduler host: free Cloudflare account (one cron Worker) or GitHub repository for Actions
- [ ] Anthropic API account with spend limit
- [ ] Free Apollo.io account (work email) and API key created
- [ ] Google Postmaster Tools for both domains
