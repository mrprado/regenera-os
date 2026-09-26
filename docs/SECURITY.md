# Security

## Identity
- Internal: email + password (OS_PASSWORD secret, or the tracker's password checked server-side); sessions are random
  tokens stored only as SHA-256 hashes in D1 (`auth_sessions`), 30 days, revoked on sign-out; cookie `os_session`
  (HttpOnly, SameSite=Lax, Secure in production, path /os). Access
  requires entity membership (`mandate_members`); OS_ALLOWLIST only bootstraps the first owner. Sign-in and sign-out
  check Origin (login CSRF). Identity headers from clients are never trusted.
- Portals: separate `portal_users` table, single-use invite links (14 days), PBKDF2-SHA256 (100k iterations, 16-byte
  salt), minimum 12-character passwords, `portal_session` cookie, 14-day sessions revoked on suspension/revocation.
  Portal code never resolves the internal session (tested).
- Roles: owner and member per entity; owner-only actions include approvals (distribution, introducers, commissions,
  counsel approvals, playbook versions, stage-gate overrides, integration states, demo data).

## Authorization
- Every page, server action and API route guards itself; the route-guard test enumerates every file and fails on any
  unguarded route or action. Anonymous routes (sign-in, invite acceptance, public intake, webhooks, OAuth, MCP) each
  call a named verifier.
- Entity scoping: every query on entity data goes through `lib/db/scoped.ts` (`mandateCondition`); lint blocks direct
  database access elsewhere. This replaces Postgres RLS: enforcement is server-side, never in the browser.
- Portal visibility is explicit (`portal_grants`) and gated (introducer standing, capital compliance gate, NDA,
  distribution approval with audience, jurisdiction, dates and securities rules); portal pages read whitelisted view
  models only (tests/integration/portal.test.ts covers §93–94).
- Private investor data (private profiles, qualifications, KYC) is owner-only and never reaches Ask the OS or MCP
  (tested).

## Data handling
- Secrets: Worker secrets only; names in .env.example; never logged; never sent to the browser. Integration tests use
  fixtures.
- Documents: portals never see a document URL; `/api/portal/doc/[id]` checks access, logs, then redirects (no-store,
  no-referrer). Internal downloads of generated documents are audited.
- Input validation with zod on every action; file imports limited (5 MB, 20k features, GeoJSON/KML/CSV parsed
  server-side); intake has a honeypot and a per-IP rate limit (5/hour, IP stored hashed).
- Audit log: append-only at application level for stage changes, grants, portal access, qualification and KYC
  changes, introducer decisions, commission approvals, contract and counsel approvals, playbook versions, stage-gate
  overrides, AI-proposed changes (confirm-before-write).
- Outreach: nothing is sent without an approved message; portal invitations and replies are never emailed by the OS.
- LinkedIn is never scraped; mobile numbers are never shown.

- Output safety: contract and document text renders as React or escaped PDF/DOCX text, never raw HTML; CSV cells are
  escaped. OAuth tokens are encrypted with TOKEN_ENCRYPTION_KEY. KYC and qualifications keep statuses and evidence
  references, never identity documents.

## Known gaps
MFA; sign-in lockout (removed at Prado's request; re-enable before real client data); the OS shares an origin with the
public site (a subdomain would isolate it); no staging environment; R2 not enabled (signed URLs, backups of files);
two roles only (docs/permissions.md); Sentry registered but off.
