# Phase 29 — Inquiry to paid, delivered work (commercial lifecycle)

Status: **proposed, awaiting approval** (2026-10-10). Source: the owner's commercial-operations brief of 2026-10-10.

Goal: an inquiry becomes qualified, scoped, agreed, delivered, accepted, invoiced and paid work, with a record of every
important step and less manual coordination. Proven first with one end-to-end vertical slice (Scenario B, solar developer
diagnostic) on synthetic test records, then widened.

## 1. What already exists (audit, 2026-10-10)

The OS already has most of the parts. The gap is that they are **not joined into one journey**, and a few money and
permission rules are weaker than the brief requires.

| Capability | Evidence in the repository | Missing behaviour | Proposed change | Depends on | Acceptance check |
|---|---|---|---|---|---|
| Service catalogue | `services` (db/commercial.ts): family, inputs, deliverables, workflow, billing type, price band, margin, portal access; `ensureServices` seeds | No buyer problem, qualification criteria, exclusions, payment-schedule options, version or approved/draft state; seeded prices could read as approved offers | Add `problem`, `qualification`, `exclusions`, `paymentOptions`, `status` (draft/approved/retired), `version`; seeded rows start **draft** with no price shown as an offer | — | A draft service cannot be put on a proposal sent to a client |
| People and organizations | `contacts`, `organizations`, `party_profiles` (one org, several roles), `account_coverage`, `entity_aliases`, `merges` | No many-to-many relationship classification for **people**; no rule for when "client" applies | New `relationship_roles` (entity person/org, role from the brief's ten, basis, source, since/until). **Client / former client are derived** from engagements, never set by hand | — | Meeting, proposal or shared material does not make anyone a client (Scenario A) |
| Source and referrer | `attributions` (original vs influence, channel, introducer), `intake_submissions` with IP hash and rate limit | No UTM, landing page, self-reported source or consent on intake; no manual capture for events, LinkedIn, informal introductions | Extend intake payload capture; new "Record an introduction" form writing contact + attribution + next action | relationship roles | Informal introduction keeps referrer; duplicate submission creates nothing new (Scenario E) |
| Intake | `app/(public)/intake/[kind]`: project, capital, broker, partner; `submitIntake` with zod and rate limit; conversion to project/capital/broker | No advisory or AI-implementation intake; no dedupe by email+kind window; no qualification task; no routing to the right pipeline | Add `advisory` and `ai_implementation` kinds; idempotency key; conversion creates or **matches** org and contact (domain, email), project when relevant, a commercial opportunity, and a qualification task | services | Scenario B steps 1–3 |
| Commercial opportunities | `deals` (stage, value, fee type, next action, `stageChangedAt`), `opportunity_qualifications` (evidence per field + human decision) | Deal stages mix relationship and delivery (`lead … active … churned`); no stage history table; `probability` used as a forecast; no proposal versions | New `pipeline_stage_history` (any pipeline, from→to, reason, evidence, by). Commercial pipeline stages as in the brief (Need → Discovery → Scope agreed → Proposal → Negotiation → Signed; Lost/Deferred/Withdrawn/Reopened with reason). Old deal stages map, not rewritten; weighted pipeline removed from owner views | stage history | Signed requires an accepted proposal version; Lost requires a reason |
| Relationship pipeline | `deals.stage` partly, `relationship_reviews`, `relationships` (metadata) | No separate relationship stage | `relationship_stage` on relationship roles row: Identified → Connected → Engaged → Qualified → Active, plus nurture/dormant/closed | relationship roles | Scenario A: moves to nurture with no paid engagement |
| Proposals | `generated_documents` (drafts), `contracts` + `contract_versions`, `esign_envelopes`; intel `proposals` is AI change proposals (unrelated) | No versioned commercial proposal with scope, assumptions, exclusions, fees, schedule, validity, acceptance | New `proposals` → named `offer_proposals` + `offer_proposal_versions` (immutable once sent). Accept = locks the version; later edits create a new version | services, opportunities | A changed proposal does not overwrite accepted scope (Scenario E) |
| Agreements | `contracts`, versions, obligations, register, PDF, counsel gates | Not created from an accepted proposal | "Record agreement" from accepted version → contract with signed evidence (manual confirmation, or e-sign when configured) | proposals | Scenario B agreement step |
| Engagements | `engagements` (scope, deliverables JSON, payment schedule JSON, change orders JSON, team, renewal, SLA) | Status conflates sales and delivery; deliverables have no owner, dependency, version, client review or acceptance; change orders edit JSON in place | Engagement is created **on Signed** and only holds delivery states (onboarding, active, waiting on client, on hold, complete, closed). New `engagement_deliverables`, `engagement_milestones`, `client_requests`, `change_requests` tables; JSON columns kept read-only for old rows | agreements | Internal "done" ≠ client accepted; blocked needs reason and party |
| Workflow templates | `services.workflow`, `playbooks` + versions | No versioned delivery template that instantiates milestones, deliverables, requests, tasks | `delivery_templates` + versions; instantiation copies into engagement rows; editing a template never touches live engagements | engagements | Six starter templates as **drafts** (solar diagnostic, readiness, land and infrastructure, capital screening, AI implementation, monitoring retainer) |
| Invoices and payments | `invoices` (status, paidAmount), `recordPayment` adds to paidAmount | No payment records, evidence, refunds/credits, provider idempotency; no provider | New `payments` (invoice, amount, currency, method, evidence, provider id **unique**, reconciled by); invoice paid status derived from payments; refunds and credits as negative rows with reason. No payment provider is added (paid service: needs approval); integration shows "not configured" | — | Duplicate webhook/provider id creates no duplicate payment; no "paid" without evidence |
| Owner economics | `commercialOverview` | **Sums pipeline, receivables and MRR across currencies**; weighted pipeline from stage probabilities | Report per currency; separate proposed / contracted / invoiced / collected / delivery cost / margin / recurring; project capital and investor commitments never added to Regenera revenue | payments | Two currencies show two totals, no blended number |
| Client workspace | `(portal)` with sponsor, capital, partner, broker, stakeholder; `portal_grants` (project, capital opp, data room, document, package, deal), document requests, project updates, messages | Clients cannot see an engagement, its milestones, deliverables, requests, decisions or invoices; cannot accept or request revisions | Add `engagement` grant entity and a **Client** portal view; uploads to client requests; accept / request revision on deliverables; invoices read-only. Server-side grant checks on every read and file | engagements | A client cannot open another client's engagement, file or invoice (tested) |
| Partners and introductions | `commercial_partners`, `partners`, capital `introductions`, `referral_agreements`, `commission_schedules`, mail introductions | Partner pipeline stages; introduction record lacks authorization to share and materials; no duplicate guard across modules | Partnership pipeline on relationship roles (technical/referral partner); one `introductions` path with authorization, materials, outcome; unique open introduction per parties+subject | relationship roles | Scenario C: partner never counted as paying client |
| Communications and meetings | `activities`, `messages` (approval-gated), `replies`, `meeting_briefs`, `meeting_notes`, calendar sync, mail-intel (owner only) | Message states lack delivered/cancelled distinction in places; no post-meeting proposals (notes → actions → follow-up draft → stage suggestion) | Post-meeting review form producing tasks, a follow-up draft (approval queue) and a suggested stage change for review | pipelines | Clicking send never shows "sent" without provider evidence (existing rule, re-tested) |
| Next actions and follow-ups | `tasks`, sequences with stop on reply, digest, `commercialAttention` | No "every active record has a next action or a reason" check | Next-action check across opportunities, capital discussions, partnerships, engagements; Today lists records with none | pipelines | Each active record shows a next action or a stated reason |
| Intelligence ingestion | sources registry, `provider_calls`, `source_cache`, `claims`/`claim_evidence`, `doc_extractions`, `entity_aliases`, `merges`, `ontology_matches`, Steward source records | Already largely built in phases 19–28; review queue for conflicting extracted values is per-module | Pass 4 only connects: extracted facts that conflict with analyst-verified values go to one review queue; verified values are never overwritten | — | Conflicting extraction enters review (Scenario E) |
| Capital matching | `capital_matches`, `funding_project_matches`, fit evidence, programmes | Expired sources not excluded everywhere; candidate vs verified vs introduction-authorized separate in places only | Uniform match states; expired or past-deadline sources excluded from current matching | — | Expired funding source excluded (Scenario E) |
| Steward to decisions | `stewardship_obligations`, Steward assessments, care actions, gaps on Capital tab (28D) | Findings lack decision implication, affected parties, owner and review date in one record | `steward_findings` linking place, project, evidence, implication, action, owner, review date, status; feeds project readiness and engagement deliverables | — | A material finding without an owner and review date cannot be marked resolved |
| Jobs, audit, export | `jobs` (claim safety, retries), job health, `audit_log`, `ai_runs`, R2 nightly backup | No documented, tested restore; no owner data export for commercial records | Export (CSV/JSON per area, owner only); restore procedure in docs/DEPLOY.md, verified against local D1 | — | Restore of a backup into local D1 succeeds and row counts match |

## 2. Stages

Each stage is built, tested and committed before the next. Deploy only on the owner's word.

**29A — Foundation and the Scenario B slice**
- `relationship_roles`, `pipeline_stage_history`, services draft/approved fields.
- Commercial opportunity stages and transitions (evidence for Signed/Lost), mapping from old deal stages.
- `offer_proposals` + immutable versions; accept → agreement (contract) → engagement.
- Engagement delivery tables (milestones, deliverables, client requests, change requests) and template instantiation.
- `payments` with unique provider id and evidence; invoice status derived.
- Per-currency owner economics; weighted pipeline removed from owner views.
- Scenario B end to end in an integration test (synthetic records only).

**29B — Intake, attribution and relationships**
- Advisory and AI-implementation intake; UTM, landing page, consent; idempotency.
- Org/contact matching on conversion; qualification task and routing.
- Manual introduction capture; relationship pipeline; client derived from engagements.
- Scenarios A and C.

**29C — Client workspace**
- Engagement grant and client view: milestones, deliverables, requests, decisions, invoices.
- Upload, accept, request revision; isolation tests; branding config per tenant.
- Scenario D.

**29D — Communications, next actions and retention**
- Post-meeting review → tasks, follow-up draft, suggested stage change.
- Next-action check on Today; renewal and relationship review on completion; lessons capture.
- Case-study and referral request only with permission.

**29E — Intelligence connections and recovery**
- One review queue for conflicting extracted facts; uniform match states with expiry exclusion.
- `steward_findings` feeding readiness and deliverables.
- Owner export and a tested restore.
- Scenario E complete.

## 3. Interface (no new sidebar areas)

- **Engage**: tabs Opportunities (list/board, same data), Proposals, Engagements, Invoices.
- **Network**: relationship roles and pipeline on person and organization pages; Partners tab.
- **Projects**: unchanged spine, with engagements and Steward findings linked.
- **Settings**: Services and Templates (admin); integrations states.
- **Today**: attention, revenue (per currency), relationships to move, projects that can advance, prepared drafts, failures.
- Portal: a Client view beside the existing sponsor/capital/partner/stakeholder views.
- Design system, UX laws and the dark mode apply.

## 4. Rules kept

- Unknown is never zero.
- No invented prices: draft services show "price not set".
- Nothing is sent without an approved messages row.
- No payment provider and no paid service without approval.
- No stage probability presented as a forecast.
- Currencies are never blended without a stated basis.
- Clients see only granted records, enforced on the server, including files and search.
- Restricted knowledge never reaches AI without permission.
- Synthetic fixtures only in tests; nothing fictional in production.
- Migrations additive; old JSON columns kept.

## 5. Not in this phase

- Payment provider integration (Stripe or similar): needs owner approval as a paid service.
- E-signature provider beyond the existing envelopes table.
- Website visitor identification (not offered).
- Per-client code forks.
