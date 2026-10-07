# Regenera OS â€” integrated current-build demo

The October 5 **Operating clarity** redesign is now applied across the shared application theme, Command, navigation, project context, forms, and tables. `DESIGN.md` is the active presentation specification. All 101 legacy menu destinations remain; the design audit inventories 176 screen components, 615 original selects and 36 skill sources. New menu labels preserve old work-area keys and paths.

This extends the existing Regenera OS React/Vinext application, rather than the earlier standalone scaffold.

## Baseline

Repository: `mrprado/regenera-os`. Base: supplied October 2 production source `2566e77e0febb7e2b915c0a2844b63826a23f4d3`; GitHub main was still `36bb3c6` when retrieved. Preserves the white Command/sidebar design, Regeneration lens, original navigation, Project 360, Atlas, commercial delivery, capital, data providers, community governance, and portal guards. Includes the reconciled October 2 scan filters, sorting, pagination and review-state retention.

The current live production revision was not independently queried. Production has not been modified or deployed.

## Run

Requires Node.js 24 for the portable preview:

```powershell
npm ci --ignore-scripts
npm run build
node scripts/preview-integrated.mjs
```

Open `http://127.0.0.1:4311/demo` and choose **Explore as founder**. The preview runs the actual compiled Worker and original React UI/server actions with a local SQLite-backed D1 adapter. Hosted Sites uses native D1/R2. Preview data persists under ignored `.sites-runtime/integrated-preview/`; no production credentials or databases were copied.

## Walkthrough

1. Command retains the existing layout and adds an **Integrated project operating layer** panel.
2. Open the Mexico solar project's **Operating context** tab. Original project tabs remain available.
3. Explore Project memory, Relationships, Claims audit, Institutional readiness, Development scenarios, Intelligence missions, Decision Room, Period close, Specialist agents, and Track Record.
4. Run Claims Auditor as the fictional founder. It proposes a reconciliation in the existing approval queue.
5. Return to `/demo`, choose the fictional reviewer, and approve the exact proposal. The canonical claim, audit entry, proposal state and project memory commit together. Requesters cannot self-approve.
6. Begin period review and propose close. Conflicting claims block close; approved snapshots are immutable, and reopening preserves revisions.
7. Follow the same project into existing Atlas, capital, parties, documents, community rights, and delivery workflows.

All identities use `@example.test`; organizations, events, sites, figures and scenarios are fictional. Readiness scores are internal heuristics, not certifications. Existing founder statistics continue to exclude test records.

## Architecture

Migration **0050_project_context** adds context records, evidence-backed edges, reporting periods and snapshots; generated Drizzle metadata/journal are included. Prior migrations remain intact. Projects, parties, claims/evidence, decisions, capital requirements, tasks, and proposals remain canonical: no second CRM or claims registry.

Specialists have a 200-record limit and one pending proposal per specialty. New actions require project-scoped non-AI evidence and a different human workspace owner. Database batches commit writes, memory, audit and proposal state atomically. Follow-up tasks use the existing task table, and repeated confirmation cannot duplicate them.

Views reuse existing tokens, UI modules, permissions and scope. Missions persist definitions; live execution stays in existing provider engines and is disabled in the demo. Scenarios are labelled modelled estimates. Environmental screening remains tied to actual sources and existing Atlas capabilities.

## Safety

Demo entry requires `ISOLATED_DEMO=true` and `APP_ENV=demo`, and refuses any database containing another workspace. External discovery, job execution and outbound sending are disabled. Production authentication, membership, portal, KYC and knowledge guards remain intact.

**Do not run `npm run deploy` from this demo checkout:** that retained repository script targets the existing production Worker. Use the Sites workflow for this registered private demo. Its manifest requests separate logical D1/R2 bindings and contains no credentials.

## Verification and hosting status

Full React/Vinext build, TypeScript, focused lint, canonical-record/scoping/approval/close/idempotency tests, HTTP rendering of original Command plus all ten contextual views, and an actual React memory-form round-trip have been verified. Native D1/Vitest startup remains restricted on this Windows host; focused integration tests use a SQLite-backed D1-compatible adapter. Visual regression and full accessibility audits remain unverified.

Private Sites registration is complete. Publication remains blocked: automatic approval review rejected input to the publishing helper because sandbox approval is disabled. No hosted URL is claimed. Resume source push, packaging, version save and private deployment for the same `.openai/hosting.json` project ID when the approval path becomes available; do not recreate the Site.

## Integrity corrections — October 6
Claim reconciliation now creates an evidence-linked successor and retains the historical statement. Approvals bind to full reviewed target/evidence records and fail closed for changed inputs or expired proposals. All effects and approval state share one atomic batch; concurrent closes can apply only once per period revision. Migration 0051 makes snapshot period/revision unique. Existing duplicate snapshots cause migration failure intentionally: investigate and preserve their audit history before migration; do not silently discard snapshots. Pre-fix pending proposals lack version bindings and must be recreated.

Regression verification: nine context tests cover historical claims, intervening edits, evidence edits, concurrent distinct closes, immutable snapshots, repeat approval, permissions, and rollback. These use SQLite through a D1-compatible adapter; production-native D1 and deployment checks remain separate launch gates.

## Atlas contents panel and build (October 6)

See docs/atlas-explore.md: build diagnosis (spawn EPERM came from the Codex sandbox; the build succeeds as the normal user), panel structure, filter semantics, tests and remaining limits.
