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
