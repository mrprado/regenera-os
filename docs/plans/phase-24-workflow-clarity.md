# Phase 24 — Workflow clarity: case studies, sequencing, navigation and landing pages

Status: **proposed 2026-10-08, awaiting approval**. Presentation and sequencing only: no record, permission boundary,
approval gate, integrity gate or URL is removed. Stack unchanged.

## 1. What the OS is for (the one sentence every screen must serve)

Regenera earns fees by finding regenerative projects that need help, proving they are sound, and getting them to
capital. The OS exists to run that loop, every day, in this order:

| Step | Question the founder asks | Today's pages (scattered) |
|---|---|---|
| 1. Find | What new projects, funding calls and needs appeared? | /origination (under Mandates), /triggers, /funding, /scans, Atlas |
| 2. Qualify | Is it sound, ready and worth our time? | Project → Capital tab (integrity, readiness), /pursuits, /mandates |
| 3. Reach | Who decides, and how do we reach them? | /companies, /people, /prospecting, /sequences, /queue |
| 4. Win | What do we propose, at what price, and is it signed? | /deals, proposals (generated documents), /contracts, /commercial |
| 5. Deliver | What is due, by whom, for which client? | /tasks, /playbooks, /documents, /funding?tab=bids, /capacity |
| 6. Fund | Which capital or funding gets this project financed? | /capital, /funding, /capital/structures, introductions |
| 7. Steward | Is it doing what it promised? | /origination?tab=stewardship, project impact records |

The sidebar today is organised by object type (Mandates, Deals, Network, Capital, Projects, Delivery, Intelligence), not
by this loop, so the user has to know the data model to know where to click.

## 2. Review findings (live site, 2026-10-08)

1. **Four meanings of "opportunity".** Deals (Regenera's fees) were labelled "Opportunities"; the origination queue calls
   each row an "Opportunity"; Capital has "Capital opportunities"; Funding has "Funding opportunities". Command's
   "Add opportunity" creates a deal.
2. **The money engine is hidden.** The origination queue (61 items to review today) is an internal-only item inside the
   Mandates submenu, below "Live mandates" which is empty (0 mandates).
3. **Three approval places.** /approvals (introductions, NDAs, bids), /queue (outreach drafts) and approval tasks in
   /tasks (diagnostic proposals). None links to the others.
4. **Command leads with the slogan, not the work.** The Regeneration lens hero takes the first screen; "Needs your
   decision" is below the map. The ops line shows system telemetry ("358/421 source calls", "102 failed jobs") to the
   founder every morning.
5. **Test records in production priorities.** "[local test] Costa Verde Developments" and "[local test] Minera Sur" are the
   top two items in "Needs your decision" (15 and 14 days overdue).
6. **Raw keys in the UI.** The queue shows `funding_diagnostic` instead of "Funding readiness diagnostic"; entrances
   ("capital first", "market first") are internal jargon.
7. **Next actions without a way to act.** "Answer the eligibility questions with the funder" has no link to the
   questions; the only row action is a stage dropdown + "Set". Drafting the proposal needs a second page (project →
   Capital tab → scroll).
8. **Integrity decision invisible where it matters.** It sits inside the Capital tab of a project with 33 sub-tabs; the
   project header shows stage, capacity, capital, readiness and constraints, but not whether we may pursue it.
9. **Admin mixed into daily work.** Delivery's submenu includes Jobs, AI prompts and API & MCP. Systems and Clients have
   no sidebar entry at all (reachable only by search).
10. **Landing pages list tools, not steps.** Each overview's "Move work forward" repeats the submenu; it does not say
    what to do first, and the counts do not link to the next action. Empty states ("No mandates yet") do not say whether
    the area is needed at all.
11. **Market-pipeline and Atlas site screens mixed with own projects** in the default Projects table ("Site · Bern"
    entries from Atlas screens appear next to client projects).

## 3. Case studies (each run against the current UI; what broke → the rework)

**CS1 — A funding call fits a project (capital first).** Funding engine finds "Waste Management Reform Project"
(Montenegro) → match to MONT-1 → Command brief says "Answer the eligibility questions with the funder".
*Current:* Command → click → project Capital tab → scroll past partner scan, integrity, readiness → funding matches panel
→ questions; bid/no-bid is a separate task in /tasks; application in /funding?tab=bids. 4 pages, no breadcrumb back.
*Rework:* queue row opens a **work card** (drawer) with the match checks, the open questions, integrity state, and the
three buttons that move it: "Mark eligible / ineligible (with basis)", "Bid / no bid", "Draft diagnostic proposal".

**CS2 — Public project with no relationship (project first).** World Bank Namibia solar → project created with claims →
queue says "Identify the sponsor's credible contact channel". *Current:* nothing links from that action to the parties
(Ministry of Finance, NamPower) or to /prospecting. *Rework:* action links to the project's parties with "Find decision
makers" pre-filled for the implementing agency; the item stays in step 3 (Reach) until a contact exists.

**CS3 — Inbound enquiry from regenera.bio.** Webhook creates a lead deal. *Current:* it appears under Command → Incoming →
"New leads", is called a deal, and the next step (discovery call → diagnostic proposal) is not suggested. *Rework:* leads
land in **Today → New leads** with "Qualify (call booked) / Not a fit"; qualifying asks which project it concerns and
creates/links it, then offers the diagnostic proposal.

**CS4 — Sponsor brings a project through the portal.** Portal intake → /portals?tab=intake (internal). *Current:* intake
is a tab of Portals inside Command's submenu; turning it into a screened project is manual. *Rework:* intake appears in
New leads with "Create project and screen" (runs site screen + integrity screen) — the sponsor sees status, never the
integrity reasoning.

**CS5 — Outreach to a decision maker.** Scan → review prospects → enroll in sequence → draft → approve in /queue → reply
in /inbox. *Current:* five areas across Network and Command; approvals for outreach (/queue) are separate from
approvals for introductions (/approvals). *Rework:* one **Approvals** inbox with tabs (Outreach · Introductions & NDAs ·
Proposals · Bids), counts in the sidebar badge; Reach step groups Scans → Prospects → Sequences → Inbox in order.

**CS6 — Proposal to signed engagement.** Diagnostic proposal draft → approval task → send → deal stage → contract →
engagement → invoice. *Current:* proposal is a generated document, the deal is in /deals, the engagement in
/commercial?tab=engagements, the contract in /contracts; the deal page does not show the proposal. *Rework:* the deal
page shows a fixed strip Proposal → Contract → Engagement → First invoice with the current one highlighted and its
button.

**CS7 — Capital introduction for a cleared project.** Capital partner fit → introduction (gated by integrity) → NDA →
data room. *Current:* fit lives on the partner page (owner), introductions on /capital?tab=introductions, NDA in
/approvals, data room in /portals?tab=rooms. Blocked introductions say why only after submitting. *Rework:* the project's
Capital step shows eligible partners with fit and gate state *before* the button; blocked ones are listed greyed with the
reason.

**CS8 — Morning routine.** Founder opens Command. *Current:* hero → brief → telemetry → map → priorities (with test data)
→ links. *Rework:* Command order becomes: (1) Needs your decision (approvals + overdue, test/demo records excluded),
(2) Daily brief, (3) Today's queue (top 5 origination items with their one action), (4) map; telemetry collapses into
one "System: healthy / 2 sources degraded / AI paused" line linking to Settings → Jobs; the lens moves to a collapsed
"About" block.

**CS9 — Stewardship after financing.** Obligations and impact records exist only on the project Capital tab and the
origination Stewardship tab. *Rework:* project Overview shows the next obligation; Today shows overdue ones.

## 4. Proposed changes

### 4.1 Sidebar (labels and grouping only; every URL kept)
```
Today            (Command: decisions, brief, queue)          /today
Atlas                                                        /map
Find             Opportunity queue · Signals · Funding calls · Scans
Qualify          Projects · Pursuits · Mandates
Reach            Organizations · People · Prospects · Sequences · Inbox
Win              Sales pipeline (deals) · Proposals · Contracts
Deliver          Engagements · Tasks · Applications & bids · Documents · Playbooks
Capital          Capital partners · Introductions · Structures · Funding pathways
Steward          Stewardship · Impact records
── Workspace     Intelligence · Clients · Systems
── Admin         Settings (Jobs, AI prompts, Integrations, API & MCP move here from Delivery)
Approvals        single inbox, badge with count (top bar)
```
The seven loop steps are numbered on landing pages (not in the sidebar). nav-inventory test keeps every page reachable.

### 4.2 Vocabulary
- "Deals" → **Sales pipeline** (Regenera's own fees). "Opportunity" is reserved for the **Opportunity queue** row.
- "Capital opportunities" → **Capital needs**; "Funding opportunities" → **Funding calls**.
- Service keys always shown with their catalogue name; entrance labels: "From a funding call", "From a project",
  "From a market thesis".

### 4.3 Landing pages (each /overview/*)
Same template for every area: one-sentence purpose · **"Do this next"** (top 3 records needing action in this area, each
with its button) · the area's steps as a numbered strip with live counts that link to the filtered list · empty state
that says when you would use the area and the one action to start · tools list collapsed below.

### 4.4 Workflow fixes
1. Opportunity queue work card (drawer) with direct actions (CS1), next-action links (CS2), human service names.
2. Single Approvals inbox (CS5) — existing pages stay as tabs.
3. Integrity chip in the project header and in project lists; blocked items explain the reason before any button (CS7).
4. Deal page lifecycle strip Proposal → Contract → Engagement → Invoice (CS6).
5. New leads: Qualify / Not a fit, link to project, then proposal (CS3, CS4).
6. Command reorder and telemetry line (CS8); records named "[local test]" or flagged demo are excluded from priorities.
7. Projects default view = own projects; Market pipeline and Atlas site screens as their own views (already exist as
   tabs: made the filter explicit).
8. "Start here" page (/start, linked from Today and the user menu): the 7-step loop as a diagram, each step linking to
   its area, plus three worked examples (CS1, CS3, CS7) as guided walkthroughs.

### 4.5 Data hygiene (needs your explicit yes — production records)
The "[local test]" organizations and deals in production: archive them (soft, reversible) rather than delete.

## 5. Acceptance
- Every case study above can be completed from its starting screen without using search, with each step's button on
  the screen where the step is described (checked in the browser at desktop and phone widths).
- nav-inventory, route-guard and all existing tests pass; no URL changes; Approvals counts equal the sum of the four
  sources.
- Command's first screen (1280×800) shows decisions and the brief without scrolling.
