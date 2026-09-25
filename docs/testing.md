# Testing

`npm test` runs Vitest against a real local D1 (wrangler getPlatformProxy). 33 files cover, among others:
route guard and private-data isolation, sign-in, mandate scoping, outreach safety (idempotency, suppression,
windows), funding, contracts and PDFs, projects (including the first slice of the master spec's critical workflow),
capital (matching, eligibility, ledger, gate, send-time hold), contracts register and obligations, regulatory,
integrations and place (adapter fixtures, registry gate, stale fallback), and global search. External APIs are faked
with fixtures in tests; live checks are done in the browser and recorded in the phase build reports.
