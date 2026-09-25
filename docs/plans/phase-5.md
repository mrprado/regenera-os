# Phase 5 plan: Funding, matchmaking and service streams

**Status:**
- **Part A (Funding): approved Sep 24, 2026.** Prado asked for global grants, a Funding tab, and anything else the funding side is missing.
- **Parts B to D: proposals for Prado to approve.** Matchmaking, the operator and developer side, and service streams with pricing.

**Ground rules from the live site.** They apply to everything below:
- **Important Notice:** Regenera is not a fund, bank, broker-dealer, registered adviser, placement agent, fund manager, custodian, engineering firm or EPC contractor, and holds no client or investor money.
- **Capital Partners page:** Regenera is "not a public project marketplace". Fit comes before confidential materials. Readiness and mandate fit are separate tests.
- **Introductions** happen only after fit, authority and disclosure conditions are confirmed, and any role and compensation is defined in a written agreement.

The matchmaker role below is built to those rules: a private, mandate-led coordination layer, never a listing site.

---

## A. Funding (approved, built)

**Where it lives.** Prospect → **Funding**, a new sidebar item.
- Everything with money attached goes here: grants, calls for proposals, tenders, prizes, and concessional finance calls.
- The EU TED and World Bank tenders already collected by the trigger engine move here, so tenders stop crowding Triggers.
- Triggers stay for events at organizations.

### Sources: global, free, open data only

All checked Sep 24, 2026 unless marked otherwise:

| Source | What | Access |
|---|---|---|
| Grants.gov | US federal grants and forecasts | Free API, no key |
| EU Funding & Tenders Portal | Horizon Europe, LIFE, Interreg, Global Europe, other EU calls and tenders (many open to non-EU applicants) | Free public search API |
| EU TED | EU public tenders | Already in use |
| World Bank | Procurement notices (global) | Already in use |
| UK Contracts Finder | UK public contracts | Free OCDS JSON |

**Not included:**
- Green Climate Fund, GEF and Adaptation Fund: their feeds turned out not to carry calls (GCF's is empty, GEF's lists staff profiles, the Adaptation Fund's is general news).
- ADB, AfDB and AusTender blocked automated requests (403).
- UN Global Marketplace and UK Find a Grant publish only web pages.
- Devex and Instrumentl are paid.

I'll re-check the blocked ones at build time and add any that publish a feed. SAM.gov (US contracts) needs a free key, which can be added later if wanted.

### Current-data policy

Only opportunities that are open or forecast, with a deadline today or later, are kept. Expired ones are archived, never shown as new.

### What each opportunity carries

- Funder and programme.
- Type: grant, tender, call, prize or concessional finance.
- Amount range and currency, and co-financing required.
- Deadlines, including stages.
- Eligible countries and eligible applicant types.
- Sectors and territorial systems, and the source link.

**Claude's funding read (Haiku):**
- Fit to Regenera's services and focus regions (0 to 100).
- **Route:**
  - *Regenera bids*: a consulting or technical-assistance tender.
  - *Client applies with Regenera's support*: grant strategy and application.
  - *Consortium*: needs partners.
  - *Signal only*.
- Eligibility caveats, and whether a consortium is needed.

### Actions per opportunity

- **Bid.** Creates a deal linked to the opportunity, with the deadline as its close date.
  - A bid-or-not checklist covering eligibility, capacity, partners, co-financing and fit.
  - Tasks back-planned from the deadline.
  - A consortium section pulling partners from the Partner Network.
- **Match.** Lists CRM organizations and (once Part B exists) projects that look eligible: country, applicant type and sector. Each is saved as a prospect, with a draft message offering application support.
- **Watch** or **Dismiss**, with a reason.

### Missing pieces added to the funding side

1. **Funder profiles.** Every funder becomes an organization with its programmes, typical ticket, recurring call calendar, eligibility patterns, and Regenera's win and loss history with it.
2. **Funding calendar.** Deadlines plus forecast recurring calls for the next 12 months, shown in the Funding tab.
   - Deadlines at 14 and 3 days out appear in the daily digest and on Home.
3. **Map layer.** Open opportunities by eligible country, on the existing globe.
4. **Saved funding searches per playbook.** Each playbook's keywords run against every funding source. Its page shows matching opportunities.
5. **Bid library.** Reusable blocks: company profile, CVs, methodology, past performance.
   - Past performance comes only from case records marked disclosure authorized.
   - Claude drafts first-pass proposal sections from the library and the call text. Drafts are edited, never auto-submitted.
6. **Reports.** Bid pipeline and win rate by funder and route, time spent per bid, and value won.

### Tests

- Each source parser returns only open or forecast items.
- De-duplication across sources (the same call appears in several places).
- The fit read validates against its schema (fake model).
- Bid creates the deal with back-planned tasks.
- Match finds eligible organizations by country and type.
- Deadline alerts appear in the digest.

---

## B. Matchmaking (proposed: approve to build)

Today capital mandates and projects exist only as deals with notes. Matchmaking needs them as structured records, using the site's own vocabulary.

1. **Capital mandates.** A record per investor or funder using the site's six parameters:
   - sector focus
   - geography and exclusions
   - ticket range, currency, capacity and timing
   - stage
   - structure (equity, debt, project finance, strategic or blended)
   - requirements (return, risk, impact, technical, counterparty)

   Filled from capital inquiries, the mandate definition session, and funder profiles.
2. **Projects.** A record per sponsor project:
   - sector and territorial system, location on the map, stage
   - capital need and structure sought
   - the five readiness dimensions (control, technical, commercial, institutional, capital) with evidence
   - sponsor authority, and a disclosure level: non-confidential brief, or confidentiality agreement required
   - documents stored in R2, never shared automatically
3. **Match engine, three ways:**
   - **Project ↔ capital mandate.** Mandate fit is tested first, and readiness separately. As the site says, evidence cannot compensate for misalignment.
   - **Project ↔ funding.** Grants and calls the project could use.
   - **Project ↔ partners.** EPC, engineering, law, operators and lenders, from the Partner Network.
4. **Introductions workflow**, following the site's five steps:
   1. Criteria recorded.
   2. Fit and authority tested.
   3. Non-confidential briefing prepared.
   4. Authorized introduction.
   5. Diligence coordinated.

   Both sides' consent to the introduction is recorded. The intro email is drafted into the approval queue. After that, a light diligence tracker holds questions, owners, evidence and decisions.
5. **Funding stack sketch per project** (moved from Part A because it needs project records). Grant plus concessional plus commercial layers, with the co-financing each needs. Built for sponsor conversations, labelled indicative.
6. **Guardrails:**
   - no public listing
   - no securities language
   - disclosure only as authorized
   - every introduction logged with its consent
   - success-based fees on capital raising flagged for counsel before any agreement

## C. Operator and developer side (proposed)

1. **Diagnostic workspace.** For each diagnostic, the site's outputs as working documents: constraint and dependency register, readiness map, priority work plan, decision and responsibility matrix, recommended engagement scope. Claude drafts each from the evidence, and Prado edits.
2. **Development office tracking.** Workstreams, milestones, owners (sponsor, specialists, counterparties), evidence plan, and next decision.
3. **Governance and monitoring.** KPI and reporting cadence per project, and a monthly report draft for the sponsor or capital partner.
4. **Operator matching.** O&M operators and technology providers (existing partner types) matched to projects nearing construction or operation.

## D. Service streams and pricing (proposed: help formulate)

Streams already on the site are grounded in its six engagements and five fee types. The ones marked **new** are candidates to decide on.

| Stream | Client | What they get | Fee model | Notes |
|---|---|---|---|---|
| Project diagnostic | Sponsor | Decision record, readiness map, work plan | One-time fixed | Entry offer |
| Readiness mandate | Sponsor | Gaps resolved, institutional case | Milestone | |
| Development office | Sponsor | Held sequence across specialists and counterparties | Monthly retainer | |
| Capital advisory | Sponsor | Capital requirement framed, mandate-led review coordinated | Retainer, plus a success fee only where counsel confirms | Broker-dealer risk on success fees (US and others) |
| Capital-partner screening | Investor or DFI | Mandate definition session, screened pipeline, screening records | Fixed session, then monthly or per record | Paid by capital, not contingent on investment |
| Governance and monitoring | Sponsor or capital partner | Post-close reporting, KPIs | Monthly retainer | |
| **New: Funding strategy** | Sponsor, municipality | Funding landscape and stack for a project | Fixed | Builds on Part A |
| **New: Application support** | Sponsor, municipality | Grant application prepared with them | Fixed or milestone | Many public funders (US federal rules among them) do not allow contingency fees paid from grant funds. Flag per call |
| **New: Grant management** | Grantee | Reporting and compliance through the grant | Retainer | |
| **New: Regenera as bidder** | Multilaterals, governments | Technical assistance and consulting tenders won directly | Contract value | Part A "Bid" route |
| **New: Consortium coordination** | Lead bidder | Partners assembled, bid managed | Fixed plus milestone | |
| **New: Territorial intelligence** | Governments, SEZs, funds | Territorial diagnostics and data briefs (Systems Intelligence) | Fixed or subscription | Fits the site's Intelligence section |
| Partner Network | Partners refer clients | Referral fee paid by Regenera (10, 15 or 20%) | Cost of sale | Already built |

**In the OS, to run the streams:**
- An offer catalog: stream, engagement, fee type, price band, deliverables and scope template.
- Claude drafts proposals and statements of work from a diagnostic and an offer, with pricing shown as ranges until Prado sets them.
- Engagement milestones and invoices due. Tracking only: no payment processing, and no investor money ever touches Regenera.
- Revenue by stream in Reports.

## What I need from Prado

- **Part A:** built (see the build report below).
- **Parts B, C and D:** approve them all, or pick which to build next.
- **Service streams:** which of the new ones to offer, and price bands for each. Until then, the offer catalog shows the fee type with pricing hidden, matching the site, which states no prices.

## Build report: part A (2026-09-24)

- **Live check:** the first local scan fetched 99 open or forthcoming opportunities (Grants.gov 42, UK Contracts Finder 30,
  World Bank 25, EU Funding & Tenders 2) from 8 of the 70 query and source pairs. The rest rotate in every 2 hours.
- **Data quality found live and fixed:** HTML entities and zero-width characters in titles; Grants.gov's 999,999,999
  "no ceiling" amounts; far-future "until further notice" deadlines (2076), now shown as rolling; loose source search
  results (taxi services, bedding plants), now skipped when the call text names no Regenera service term (35 dropped).
- **Map placement** resumes itself: Nominatim allows one request a second, so the job re-queues until every
  opportunity is placed.
- **Fixed in passing:** Prospecting's Dismiss button was saving results, because React drops name/value on
  function formAction buttons; it is now its own action. identity.enrich no longer retries five times when its
  organization was merged away.
- **Not built:** SAM.gov (needs a free API key; Grants.gov covers US grants); time spent per bid (no time tracking in the OS).
- **Needs ANTHROPIC_API_KEY:** Claude's fit and route read, and proposal drafts. Until then, fit is a keyword estimate.
- **Tests:** tests/integration/funding.test.ts (12): source parsers keep open calls only, cleaning, cross-source dedupe,
  rotation with a failing source, off-topic skip, Claude read, applicant matching, Bid, proposal disclosure rule, digest.

## E. Contracts per engagement (approved 2026-09-24, built)

Every engagement gets its contract in the OS, tied to the deal, so renewals, milestones and signatures are tracked
alongside the pipeline.

- **Kinds:** engagement letter, statement of work, mutual NDA and amendment are drafted from a deal. A partner
  referral agreement is drafted from a partner, at its tier's fee (10, 15 or 20%).
- **Templates** (lib/contracts/templates.ts): scope and deliverables for each of the six engagements, fees from
  the deal's fee type and terms, and the site's "what Regenera is not" notice in every contract. Anything the OS
  cannot fill shows as [TO CONFIRM]. Every template opens with a note saying counsel must review it first.
- **Guardrails:**
  - A contract cannot be marked sent while any [TO CONFIRM] gap or the template note remains.
  - Success fees, fee plus equity, capital advisory, capital screening and investment mandates need an owner to
    record counsel review before the contract can be sent or signed.
  - Success-fee clauses say fees are never taken from investor funds.
  - Referral agreements pay nothing on capital raised.
- **Lifecycle:** draft, sent (the deal moves to Proposal), signed (effective and end dates set, the deal moves to
  Signed), then completed or terminated. Sent and signed text is frozen; changes go through an amendment. Every
  text or terms change is a new version, with history.
- **Money:** milestones per contract (pending, invoiced, paid, waived), and monthly retainers scheduled in one
  click. Tracking only: nothing is charged or collected.
- **Alerts** (Contracts page and daily digest): contracts unsigned after 7 days, renewal notice dates within 45
  days, and milestones due within 7 days or overdue.
- **Where it shows:** the Contracts page, a Contract column on the Deals table, Home (awaiting signature) and
  Reports (contracted value by engagement, paid and outstanding).
- **Not included:** e-signature (DocuSign and similar are paid, so ask first), and file uploads until R2 is
  enabled. The signed copy is a link.
- **Downloads:** every contract and all 15 blank templates (engagement letter and SOW per engagement, NDA, referral
  agreement, amendment) as PDFs, one at a time or all together as a .zip. Each PDF has the Regenera mark and
  wordmark in the header, a title block, numbered sections, two-column signature blocks, and a footer with
  confidentiality, status, version and page numbers.
- **Tests:** tests/integration/contracts.test.ts (8), tests/unit/contract-export.test.ts (4).
