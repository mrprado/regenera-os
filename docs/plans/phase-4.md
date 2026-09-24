# Phase 4 plan: Intelligence and scale

**Status: approved Sep 24, 2026, with two additions from Prado: (a) create RA-ESG and GWCe now, members and sending identity decided later; (b) prospecting playbooks with LinkedIn and Google keyword searches, messages and sequence drafts per partnership, and a Scan now button (item 8).**

**Goal (SPEC section 15).** RA-ESG and GWCe run inside the OS with their own rules.

**Acceptance (SPEC section 26, phase 4):**
- Ask the OS answers pipeline questions correctly on seeded data and confirms before any write.
- The MCP server works from Claude with the same scoping.
- A second mandate is isolated by the scoped data layer.
- A learning-loop proposal is generated from seeded outcomes.

This plan also covers two go-live items from SPEC sections 13 and 26 that no phase has built yet: the nightly R2 backup with a tested restore, and privacy requests (access and erasure).

## Defaults (change any of them by telling me)

| Decision | Default |
|---|---|
| Ask the OS | A Cmd+K command bar (`cmdk`, free and MIT licensed) on every screen. Claude Sonnet 5 answers using read-only tools over your data. Anything that would change data comes back as a proposal card, and nothing is written until you click Confirm |
| MCP server | `/api/mcp` on the same Worker, using the official MCP TypeScript SDK (web-standard Streamable HTTP transport). It has the same tools, the same mandate scoping and the same confirm-before-write rule as Ask the OS |
| MCP sign-in | OAuth 2.1 with PKCE, which is what claude.ai custom connectors expect. The approval screen sits behind your normal Sign in with ChatGPT plus the allowlist. Grants are stored in D1 (no new bindings) and are revocable in Settings. A personal token is also offered, for Claude Code and Claude Desktop |
| Learning loop | Monthly. Once an angle has 50 or more sends in a segment, Claude compares outcomes and proposes changes to angles, subject lines and timing. Nothing changes until you approve. Scoring weights are checked against deals that actually converted, and a change is proposed only with enough data (at least 20 won or lost) |
| Forecasting | Deals get an expected close date. The weighted forecast runs by month for the next 6 months, by practice and fee type. Stage probabilities are calibrated from your own history once each stage has at least 10 closed deals, and use the current defaults until then |
| RA-ESG and GWCe | Created as **investment** mandates, each with its own members, sending identity and fee terms. Manual only: no mass tier, no sequences, no automatic follow-ups (already enforced) |
| Investment-mandate sending | Every touch needs a recorded prior relationship with evidence (SPEC section 13, Reg D 506(b)). Sending stays off for a mandate until an owner ticks "counsel has confirmed the outreach rules" for it |
| LinkedIn | Stays assisted, per the spec's open-decision default. No LinkedIn API |

## Build

1. **Ask the OS:**
   - The command bar (Cmd+K or Ctrl+K) has recent questions and suggested prompts. `POST /api/command` returns a streamed response.
   - **Read tools:** search people, companies, deals, triggers and replies with filters; pipeline and report metrics; a record's timeline; the dossier.
   - **Proposed writes:** add to a list, enroll in a sequence, move a deal stage, set a next action, add a note, draft a follow-up (into the approval queue).
   - Every proposal goes through the same guards as the UI: mandate scope, enrollment guards, house style and the approval queue. Every call is logged to `ai_runs` and the audit log.
2. **MCP server (`/api/mcp`):**
   - Uses the same tool registry as Ask the OS.
   - Writes follow a two-step pattern: a `propose_*` tool returns a proposal id, and `confirm_proposal` executes it only when the user confirms in the chat.
   - OAuth 2.1 metadata, dynamic client registration, and authorization-code flow with PKCE. The consent page runs under the Sites sign-in. Tokens are hashed at rest, short-lived access tokens with refresh.
   - The route-guard test's anonymous list gains the OAuth token and registration endpoints, each with its own check. `/api/mcp` itself requires a valid token.
3. **Learning loop:**
   - A `proposals` table (kind, evidence, proposed change, status) and a monthly job.
   - Angle, subject and timing proposals per segment. Scoring-weight proposals. Won and lost reasons summarized per entry offer (the engagement ladder).
   - A review screen under Reports shows each proposal with its evidence. Approve applies it: segment angle, sequence steps or weights, with a before/after in the audit log. Reject records the reason.
   - **Case evidence:** each won deal prompts a decision record. It stays private until you mark disclosure as authorized.
4. **Forecasting:**
   - New deal columns: `expected_close` and `monthly_value` (for retainers).
   - Stage conversion rates and stage durations come from the stage history (activities of type stage_change).
   - A Forecast tab in Reports shows the next 6 months, weighted, by practice and fee type, with calibrated or default probabilities labelled.
5. **Multi-mandate:**
   - **Settings → Mandates (owner):** create a mandate, set its type, rules, sending identity and fee terms, add members with owner or member roles, and tick the counsel confirmation.
   - **Header mandate switcher:** all mandates, or one. Every query already filters by the member's mandates. The switcher narrows further.
   - **Investment-mandate compose:**
     - A required prior-relationship field: how you know them, since when, and evidence (a meeting, an email thread, an introduction).
     - This is logged with every touch.
     - Blocked until counsel is confirmed.
   - Isolation tests: a member of only RA-ESG sees nothing from Regenera and the reverse, across every list query, Ask the OS, MCP, reports and exports.
6. **Nightly backup and restore:**
   - Every table is exported nightly to R2 as JSON lines (`backups/YYYY-MM-DD/`), keeping 30 days.
   - A restore script loads a chosen night into a scratch local D1 and checks row counts.
   - A monthly restore check runs, and Settings shows the last backup and last check.
7. **Privacy requests (GDPR, LGPD, PECR):**
   - From a person's record: export everything held about them as JSON (access request).
   - Or erase them: the contact is deleted and the address is kept only as a hashed suppression entry, so they are never re-imported and emailed. Activities are anonymized. Every request is logged.
   - Owner only.

8. **Prospecting playbooks and Scan now (added at approval):**
   - **One playbook per segment and potential partnership** (24, covering capital, corporate, public, channel and community). Each lists:
     - who to reach: titles, seniority, company types, sectors and regions
     - the keyword sets aligned to Regenera's services (three practices, six engagements, five sectors, seven territorial systems)
     - one clear message: why Regenera, why now, the entry offer and the ask
   - **Searches built from each playbook:**
     - LinkedIn people search and LinkedIn company search (links you open while signed in to LinkedIn)
     - Google X-ray for LinkedIn profiles and company pages
     - Sales Navigator Booleans
     - Apollo people and company filters
   - LinkedIn and Google cannot be searched automatically: there is no free Google search API for new customers, and LinkedIn is never scraped. They open in your browser, one click each, with an "open all" for a playbook.
   - **Message and sequence drafts per playbook:**
     - A LinkedIn connection note, a first email and follow-ups, written by Claude from the playbook and checked against house style.
     - Kept as editable templates, and turned into a playbook sequence with one click.
     - Personal drafts per person still come from the approval queue as today.
   - **Scan now** (Prospecting page header, owner) runs what can run automatically, straight away:
     - every playbook's Apollo people search (free)
     - the trigger scan across news, tenders and filings
     - the public-list diffs
     - Results appear as "new" on the same page. Apollo company search costs credits, so it runs only per playbook on request.
   - The Searches page becomes **Prospecting**, with tabs: Playbooks, New people, LinkedIn and Google, Public lists.
9. **RA-ESG and GWCe** are created now as investment mandates with no members and sending off. Owners of the Regenera mandate manage mandates (create, rules, members) in Settings → Mandates without seeing inside them. Data stays isolated per membership.

## Tests

- **Ask the OS:** answers from seeded data are correct (counts, filters, the pipeline total). A write is never executed without confirmation. A proposal cannot touch another mandate. The model is faked.
- **MCP:**
  - Initialize, list tools, call a read tool, and the propose-then-confirm write flow, over the web-standard transport.
  - OAuth: PKCE is verified, a wrong verifier is rejected, a revoked grant is rejected, and scoping matches the user's mandates.
- **Learning loop:** a proposal is generated from seeded outcomes with 50 or more sends, and none with fewer. Approve applies the change and records before/after.
- **Forecast:** probabilities calibrate from seeded history, fall back to defaults below the threshold, and monthly bucketing is correct.
- **Multi-mandate:**
  - Isolation across queries.
  - Investment compose requires evidence and counsel confirmation.
  - The mass tier and sequences are refused (already covered, extended to the new mandates).
- **Backup:** export then restore gives identical row counts.
- **Privacy:** export completeness, and erasure leaves no personal data but a working suppression.

- **Playbooks:** every enabled segment gets a playbook with valid LinkedIn, Google and Apollo searches. Message drafts pass house style (fake model). "Use as sequence" creates the sequence once. Scan now queues every playbook search and respects Apollo's free limits.

## What I need from you (answered)

- Approval of this plan, or changes to the defaults above.
- For RA-ESG and GWCe: who should be a member of each, which sending identity (name and mailbox) each uses, and whether I create them now or leave the Mandates screen for you. I would create them without members and with sending off until counsel confirms.
