# Security

- **Sign-in:** email + password (OS_PASSWORD secret, or the tracker password checked by the site); sessions are
  random tokens stored only as SHA-256 hashes in D1, 30 days, revoked on sign-out; cookies HttpOnly, Secure,
  SameSite=Lax, path /os. Sign-in and sign-out check Origin. Lockout after failed attempts is off at Prado's request
  (recommended to re-enable before real client data).
- **Authorization:** every page calls `requireOsUser`/`requireOsOwner`, every server action `withOsUser`, every API
  route `getOsApiUser` or its own verifier (tested). Every query on business data is entity-scoped.
- **Sensitive data:** private investor profiles, investor qualifications and KYC status are owner-only, audited on
  every write, and never exposed to Ask the OS or the MCP server (tested). KYC keeps statuses and provider references,
  never identity documents; qualifications keep evidence references, not documents.
- **No identity headers:** nothing trusts client-sendable identity headers (tested).
- **Output safety:** contract text renders as React or escaped PDF text, never raw HTML; CSV cells are escaped.
- **Secrets:** Worker secrets only (`scripts/setup-secrets.mjs`), never in the repository; OAuth tokens encrypted with
  TOKEN_ENCRYPTION_KEY.
- **Audit log:** actor, action, entity, before and after on sensitive changes (capital, qualifications, gate,
  reviews, contracts, lifecycle, permits, integrations, project stages).
- **Known gaps:** the OS shares an origin with the public site (a subdomain would isolate it); no staging
  environment; R2 not yet enabled for backups; two roles only (see docs/permissions.md).
