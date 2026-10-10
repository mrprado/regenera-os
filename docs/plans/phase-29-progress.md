# Phase 29 progress

Plan: [phase-29-commercial-lifecycle.md](phase-29-commercial-lifecycle.md). Approved 2026-10-10.

## 29A: foundation and the Scenario B slice (done, 2026-10-10, not deployed)

### Behaviour that now works

- **Relationship roles** (`relationship_roles`)
  - People and organizations can hold several overlapping labels.
  - Client and former client are set only from engagements (`deriveClientRoles`); setting them by hand is refused.
- **Commercial pipeline on opportunities** (`deals.commercial_stage`, `pipeline_stage_history`)
  - Stages: Need identified → Discovery → Scope agreed → Proposal → Negotiation → Signed, plus Lost, Deferred and Withdrawn.
  - Scope agreed needs a Qualified decision.
  - Proposal and Negotiation need a sent proposal version.
  - Closing, moving back and reopening need a reason.
  - An owner can override a gate with a reason; the override is marked in the history.
  - Signed comes only from recording an agreement.
  - Board moves sync the commercial stage and history. If another module changes the board stage, the board stage wins, so the two never drift.
- **Versioned proposals** (`offer_proposals`, `offer_proposal_versions`)
  - A draft version is editable. Sending it freezes it with a SHA-256 content hash; any later change is a new version.
  - Acceptance needs the decider's name and evidence. Expired versions cannot be accepted.
  - Fee structures: fixed, retainer, milestone, hourly.
  - A draft service offer blocks sending.
- **Record agreement**: one action, safe to repeat. It:
  - registers an executed contract;
  - creates the engagement from the accepted version (later edits never change it);
  - runs the conflict check;
  - instantiates the delivery template;
  - supersedes the other open versions;
  - marks the opportunity Signed;
  - derives the client role.
- **Delivery templates** (`delivery_templates`)
  - Versioned; six starter drafts: solar diagnostic, readiness, land and infrastructure, capital screening, AI implementation, monitoring retainer.
  - Instantiation copies milestones, deliverables, client requests and tasks. Editing a template creates a new version and leaves live engagements unchanged.
- **Deliverables** (`engagement_deliverables`)
  - Internal completion needs evidence or an artifact.
  - Deliverables marked for client review must go through it before acceptance, which records who accepted and how.
  - A revision request bumps the version.
  - Blocked work needs a reason and the party it waits on.
  - Dependencies are checked.
  - A milestone closes when all of its deliverables are accepted.
- **Client requests** (`client_requests`)
  - Flow: open → submitted → accepted, or sent back with what is missing.
- **Change requests** (`change_requests`)
  - Approval needs the client's evidence. It adds deliverables, fee and timeline to the engagement; the accepted proposal version is never edited.
- **Payments** (`payments`)
  - Every payment has evidence. A provider payment id is recorded once, so a repeated webhook or click returns the existing row.
  - Refunds and credits are their own kinds.
  - Invoice paid amount and status are derived from the payment rows.
  - The old `recordPayment` now goes through this path, and the engagement form asks for evidence.
- **Owner economics** (`ownerEconomics`)
  - Per currency: proposed, contracted, invoiced, collected, outstanding (and overdue), delivery cost, margin, recurring per month.
  - No probability weighting and no currency conversion; margin is hidden until costs are recorded.
  - Shown on the Commercial overview. The weighted-pipeline figure was removed there.
- **Defects fixed in the existing Commercial overview**:
  - Receivables, by-service and by-client totals were added across currencies; they are now reported per currency.
  - The unused MRR, ARR and pipeline scalars that mixed currencies were removed.

### Screens

- **Opportunity page**: a Commercial pipeline panel (stage strip, next stage's conditions, move with reason, evidence and owner override, history) and Proposals (list, and a draft-from-services form with a template choice).
- **`/commercial/proposals/[id]`**: edit the draft, see send blockers, record as sent, record acceptance or decline, record the agreement, see the version history.
- **Engagement page**: a delivery plan (milestones, deliverables with one action per step and secondary actions folded, client requests, change requests). The older JSON deliverables list is shown only on engagements that have one.
- **Commercial page**:
  - New Proposals and Delivery templates tabs.
  - The Services tab has an Offer column (owners approve, return to draft).
  - The Overview opens with "Regenera fees by stage".
- **Navigation**: Proposals and Delivery templates added under Engage (lib/nav.ts).

### Validation

- **Scenario B integration test** (`tests/integration/lifecycle.test.ts`, synthetic `TEST` records): passes. It covers every gate above, payment deduplication, change requests and per-currency economics.
- **Existing tests**: `tests/integration/commercial.test.ts` was updated for evidence-backed payments and per-currency receivables and passes. Route guard and nav inventory pass.
- **Static checks**: typecheck is clean. Lint has no errors, and none of its warnings are in the new files.
- **Browser** (local preview, owner session):
  - Steps completed: move to Discovery → draft proposal from a service with the solar template → send blocked until the fee, validity and offer were approved → approve the offer → record as sent → record acceptance → record agreement → engagement with 3 milestones, 3 deliverables and 4 client requests → start a deliverable → overview shows USD 12,000 contracted.
  - Two issues found and fixed: a duplicated notice, and an oversized checkbox.

### Migration

- `drizzle/0064_icy_rhodey.sql` is additive only. It adds new tables and nullable or defaulted columns on `deals`, `engagements` and `services`.
- Existing services become `offer_status = draft` and must be approved before they go on a sent proposal. Existing engagements and creating an engagement from services are unaffected.

### Outstanding dependencies

- No payment provider. Manual reconciliation with evidence is the supported path; a provider is a paid service and needs approval.
- Readiness assessment, capital match and introduction steps of Scenario B run in their existing modules. They are linked through the project, and joining them to the engagement is part of 29E.
- Intake, relationship pipeline and partner flows: 29B. Client workspace: 29C. Communications and next actions: 29D. Intelligence connections, export and restore: 29E.

## 29B: intake, attribution, relationships and partners (done, 2026-10-10, not deployed)

- **Intake.**
  - New public forms: advisory (`/intake/advisory`), AI implementation (`/intake/ai_implementation`) and referral (`/intake/referral`).
  - Every form records consent (respond only, or respond and send updates), "how did you hear", campaign tags (`utm_*`), the landing page and the page that sent the visitor. No visitor tracking.
  - The same person sending the same content within 24 hours returns the same submission instead of a new one.
  - Each new submission creates a review task.
- **Conversion** matches the person by email and the organization by work domain, then by exact name. It never merges on fuzzy names. It then:
  - records the original source with campaign, landing page and consent;
  - sets the relationship role (sponsor, capital partner, technical or referral partner, or prospect);
  - starts the relationship at Identified;
  - for project, advisory and AI enquiries, creates an opportunity at Need identified with a qualification task;
  - for partner enquiries, creates a potential partnership;
  - for referrals, creates the referred person with the referrer as introducer and a task to confirm they agree to be contacted.

  A failed conversion keeps the submission unconverted and shows the error on Portals → Intake.
- **Record a contact** (Network → Relationships): for events, LinkedIn, personal network and informal introductions.
  - Keeps the source and the referrer, and requires a next action, which also becomes a task.
  - Matches an existing person by email.
  - Never creates a client or a paid opportunity.
- **Relationship panel** on person and organization pages: overlapping roles (client roles come from engagements), stage, next action or the reason there is none, source, and history.
  - Closed and dormant need a reason; other stages need a next action or a reason.
- **Partnerships** on organization pages.
  - Capability verified needs evidence; a proposed arrangement must be described.
  - Agreed needs a contract or agreement evidence; Active only after Agreed.
  - No fee is assumed: terms are only what is recorded.
- **Introductions** on organization pages.
  - Sharing materials needs a recorded authorization.
  - An open introduction between the same parties for the same purpose and project is refused.
  - Recording an outcome closes it.
- **Migration** `0065_superb_karnak.sql`, additive only: intake columns, `partnerships` and `relationship_introductions`.
- **Validation.**
  - `tests/integration/network.test.ts` passes: Scenario A, Scenario C, intake duplicates, attribution, domain matching and failure capture.
  - The portal and site-intake tests, route guard and nav inventory pass.
  - Typecheck is clean.
  - Browser: the advisory form renders with campaign and landing captured, and the organization page shows the Relationship, Partnership and Introductions panels.

## 29C: client workspace (done, 2026-10-10, not deployed)

- **New portal account type "Client"** and a grant type "Engagement".
  - Invite a client under Portals → Users, then grant the engagement under Portals → Access.
  - A grant is refused when the engagement belongs to another workspace.
- **`/portal/client`**: an overview with the client's next steps, deliverables, what we need, invoices and messages.
  - The overview covers the agreed scope (the accepted version), milestones and deliverable progress, and items waiting on the client.
  - Proposed changes can be approved or declined there.
- **Client-facing fields only.**
  - Not shown: internal notes, cost rates, margins, conflict and price-override notes, partner costs, draft or scheduled invoices, other engagements.
  - Internal blockers are shown only when they wait on the client.
- **Client actions**: accept a deliverable or request a revision (only while it is with them for review), answer a request, and approve or decline a change.
  - Each action re-checks the live grant and workspace on the server and is written to the portal access log, denials included.
  - The client's name and the portal are recorded as the evidence.
- **Branding**: the portal header names the client's organization. Tenant logo and accent (already in `tenants.branding`) are not applied yet.
- **Validation.**
  - `tests/integration/client-portal.test.ts` passes. It covers Scenario D and isolation: another client, a cross-workspace grant and a revoked grant are all refused, and internal fields are absent from the view.
  - Portal tests and route guard pass. Typecheck is clean.
  - The client page has not been opened in a browser: that needs a client portal session, which was not created locally.

## 29D: follow-through, meetings and completion (done, 2026-10-10, not deployed)

- **Next actions on Today** (`lib/lifecycle/attention.ts`, fed into Command's attention list under "Next action and follow-through"). Fixed rules (`RULES`), nothing scored. It lists:
  - open opportunities with no next action and no open task;
  - overdue next actions;
  - proposals waiting more than 10 days, and expired proposals;
  - relationships with no next action and no stated reason, overdue follow-ups, and quiet relationships (no meaningful contact in 90 days);
  - partnerships with no next action;
  - overdue introduction follow-ups;
  - client documents that are overdue, or submitted and waiting for review;
  - deliverables with the client for more than 7 days, and overdue deliverables;
  - active engagements with no open work;
  - renewals or ends within 60 days.
- **Meeting follow-up** (opportunity page → "Record a meeting and its follow-up").
  - Records notes and decisions. Actions become tasks; each needs an owner and a date, and the first one becomes the opportunity's next action.
  - Updates the last meaningful contact on the relationship.
  - The follow-up email is a draft that passes the style validator into the approval queue and is never sent from here.
  - A suggested stage change is a task to review, not a move.
- **Completing an engagement** (engagement page → "Complete this engagement").
  - Needs the outcome and the client's acceptance evidence.
  - Open deliverables and client requests either get finished or are recorded with a reason (open requests are then cancelled).
  - Unpaid invoices create collection tasks and are never marked paid.
  - Records lessons and a continuation, and derives the former-client role.
  - The relationship stays active, with a review task.
  - Case-study permission and referral requests are created only when ticked.
- **Migration** `0066_military_meltdown.sql`, additive only: `engagement_closeouts`.
- **Validation.**
  - `tests/integration/followthrough.test.ts` passes, covering detection, meeting follow-up and completion. Route guard passes. Typecheck is clean.
  - Local Today shows the new items, and the opportunity page shows the meeting panel.

## 29E: intelligence connections, Steward decisions, export and recovery (done, 2026-10-10, not deployed)

- **Conflicting extracted values.**
  - The entity merge (`lib/crm/entities.ts`, used by scans, imports, Apollo and identity enrichment) fills empty fields only.
  - A disagreement with a held value is now queued in `field_reviews` with both values, their sources, confidence and retrieval date. Only one pending row is kept per record, field and value.
  - Under Intelligence → "Data conflicts to review" (`/intelligence/reviews`): accepting writes the value with its source and the reviewer; keeping leaves the record unchanged. Nothing is overwritten automatically.
- **Expired funding.**
  - Matching already refused closed or past-deadline calls, and a nightly job closes them.
  - A project's match list now also hides a call whose deadline passed before that job ran.
- **Steward findings** (`steward_findings`, project Steward tab → "Stewardship findings").
  - Ten dimensions, among them water, ecology, land-use history, soil, community, heritage, traditional knowledge, custodianship and consent, management and monitoring.
  - Each finding has evidence, affected parties, uncertainty (unknown by default), what it means for the project and the required action.
  - A material finding needs an owner and a review date. It creates a task for the owner and is listed on the project's Stewardship readiness until it is resolved.
  - Monitoring needs a review date; resolving needs evidence and closes the task.
- **Owner exports.**
  - `/api/export/commercial` and `/api/export/relationships` return JSON for the owner's workspaces only, and each download is audited. Linked from the Commercial overview.
- **Backup and restore.**
  - Nightly R2 backups include every schema table automatically, so all phase 29 tables are included.
  - Restoring into a fresh, migrated database is tested in `tests/integration/intel.test.ts`; it passed in this run.
  - The procedure (`scripts/restore-backup.mjs` into a separate database, never production) is in docs/DEPLOY.md.
- **Migration** `0067_oval_liz_osborn.sql`, additive only: `field_reviews` and `steward_findings`.
- **Validation.**
  - `tests/integration/intelligence-review.test.ts` passes.
  - Existing entity, scan, import, funding, origination, integrity, outreach, send, radar and intel (backup and restore) tests pass: 124 tests.
  - Route guard and nav inventory pass. Typecheck is clean, and lint is clean on the changed files.
  - Local pages render: Data conflicts, Steward findings, Stewardship readiness, the export link and the export download.

## Scenario coverage (synthetic records only)

| Scenario | Where it is proven |
|---|---|
| A: casual relationship | `tests/integration/network.test.ts` |
| B: solar developer, intake to paid delivery | `tests/integration/lifecycle.test.ts` and `network.test.ts` (intake). Readiness, capital matches and introductions use their existing modules |
| C: partnership | `tests/integration/network.test.ts` |
| D: AI implementation | `tests/integration/client-portal.test.ts` (delivery, client acceptance, support change) |
| E: failures and permissions | Covered across files: duplicate submission (`network`), duplicate payment (`lifecycle`), failed conversion kept (`network`), expired funding (`intelligence-review`), conflicting extraction (`intelligence-review`), client isolation (`client-portal`), restricted knowledge kept from AI (`steward-analyst`), changed proposal keeps accepted scope (`lifecycle`). A reply stopping a sequence is covered by the existing outreach tests |

## Not done, and why

- **Payment provider.** Not added: it is a paid service and needs owner approval. Payments are recorded by hand with evidence; provider ids are already deduplicated.
- **E-signature provider.** Not added. Agreements are recorded with signed evidence.
- **Tenant logo and accent in the client portal.** Not applied yet; the header shows the client's name.
- **Live AI meeting extraction into the new follow-up form.** Not connected. The existing extraction in lib/flow/meetings remains, and the new form is manual.
- **Client portal in a browser.** Not opened: it needs a client portal session, which was not created locally.
