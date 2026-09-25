# Deployment

See docs/DEPLOY.md for commands and secrets. Summary: `npm run deploy` builds, applies D1 migrations to
`regenera-os-d1` and deploys the Worker with routes `regenera.bio/os*` and the MCP well-known paths, a 5-minute cron,
the ASSETS binding and `workers.dev` off. Migrations are additive; take a D1 Time Travel restore point before any
risky one. Pending for production: Workers Paid (CPU), secrets, R2, and optionally a staging database.
