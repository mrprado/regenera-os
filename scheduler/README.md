# Regenera OS scheduler

The Sites platform has no cron, so this tiny Worker calls `POST /api/jobs/tick` every 5 minutes. It stores nothing and only knows the tick URL and token.

## Deploy (default: free Cloudflare account)

From the `regenera-os` folder:

```bash
npx wrangler login
```

```bash
npx wrangler deploy --config scheduler/wrangler.jsonc
```

```bash
npx wrangler secret put JOBS_TICK_TOKEN --config scheduler/wrangler.jsonc
```

Paste the same `JOBS_TICK_TOKEN` value that is set on the OS Sites project.

Check it: after 5 minutes, **Settings → Jobs** in the OS shows a recent "Last tick", and the amber "Automation is paused" banner disappears.

## Fallback: GitHub Actions

Copy `github-actions.yml` into `.github/workflows/` of any GitHub repository and add `JOBS_TICK_TOKEN` as a repository secret. Runs can be several minutes late, which is acceptable for phase 0 and 1 but not ideal for send windows later.

## Manual

**Settings → Jobs → Run jobs now** runs the same tick under your session.
