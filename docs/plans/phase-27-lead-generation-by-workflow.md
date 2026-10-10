# Phase 27 — Lead generation by workflow

Status: **proposed 2026-10-10, awaiting approval.** Builds on prospecting playbooks (lib/radar/playbooks.ts), segments
(lib/segments.ts), scans and Apollo people search (0 credits). Quick fixes already shipped in 85f695e: investors searched
by how they invest, one term per sector, "Mayor's Office", ministry titles split.

## 1. Problem

Leads come from 25 generic audiences. Each produces one LinkedIn/Apollo search with sector words, so the people found
are not tied to the work that needs them: the sponsor of a project in Discover, the lenders for a capital need, the
arrangers for a bond, the consortium partners for a funding application. The user has to translate each need into a
search by hand.

## 2. What changes

### 2.1 Audience matrix (replaces one-search-per-segment)
Every search is built from **role × sector × geography**, with role sets curated per workflow:

| Workflow (where the need appears) | Roles searched (examples) |
|---|---|
| Engage: diagnostic for a project sponsor | CEO, Head of Development, CFO, Project Director at the sponsor organisation |
| Capital: equity | Investment Director, Partner, Head of Real Assets at funds matching the sector and ticket |
| Capital: senior debt / project finance | Project Finance Director, Head of Infrastructure Finance at lenders active in the country |
| Capital: bonds (green, sustainability-linked, municipal) | Treasurer / Head of Funding at issuers; DCM / Sustainable Finance at arrangers; second-party-opinion analysts; trustees |
| Capital: blended finance | Investment Officer at DFIs; programme managers at concessional and guarantee facilities; technical-assistance facility leads |
| Capital: grants / philanthropy | Programme Officer, Director of Programmes at foundations funding the theme |
| Funding applications (consortium) | BD / Partnerships at universities, NGOs, engineering firms eligible for the call |
| Energy | Head of Origination, Grid Connections Manager at IPPs, utilities, transmission operators |
| Land and real estate | Head of Land, Development Director, Estate Manager |
| Agriculture and food | Head of Sourcing, Agronomy Director, cooperative managers, processors |
| Water, waste, infrastructure | Director of Public Works, Utility Director, PPP unit heads |
| Nature and carbon | Programme Directors at conservation organisations (partners, not outreach targets for community bodies) |

Sector vocabulary per sector (energy, land, agriculture, water, waste, built environment, nature) and instrument
vocabulary per capital type (equity, debt, bond, blended, grant) are separate lists, so "blended finance" never
pollutes an energy developer search.

### 2.2 Leads attached to the record that needs them
- **Project** (Stakeholders tab): "Find decision makers" for each missing party role (sponsor, offtaker, lender,
  EPC…), pre-filled from the project's sector and country.
- **Capital need**: "Find capital providers" by instrument and ticket; results feed Capital partners, not outreach.
- **Bond** (Capital → Bonds): issuer, arranger, SPO, trustee searches.
- **Funding application**: consortium partner search by eligibility criteria.
- **Opportunity queue item**: sponsor contact search (the "Identify the sponsor's contact channel" next action).
Each result is a suggestion with the reason it matched; a person accepts it into Network, adds it to a list or
enrols it in a sequence. Nothing is contacted automatically; every message still needs approval.

### 2.3 Guardrails kept
- Community bodies, Indigenous organisations and their members are never added to outreach sequences or prospecting
  campaigns (Steward rule); they appear in Steward → Community with governance context instead.
- Sanctions and non-circumvention checks run before outreach or introductions, as today.
- Apollo enrichment spends credits only on accepted people, within the existing budget guard.

## 3. Build
1. `lib/leads/matrix.ts`: role sets per workflow, sector and instrument vocabularies, region lists; one function builds
   LinkedIn, Sales Navigator, Google and Apollo queries from (workflow, sector, instrument, geography, organisation).
2. Playbook pages switch to the matrix (the 25 audiences remain as presets).
3. "Find …" actions on project Stakeholders, capital needs, bonds, funding applications and queue items, each opening
   Prospecting pre-filled and returning suggestions to the record.
4. New presets: bond issuers, arrangers, SPO providers, trustees; guarantee and concessional facilities; IPPs and
   transmission operators; cooperatives and processors.
5. Tests: query construction (no instrument terms in non-capital searches; quoting; capitalisation), community exclusion
   from outreach, suggestion acceptance flow.

## 4. Acceptance
For one project, one capital need, one bond and one funding application, the "Find …" action returns people in the
right roles at the right kind of organisation, with the reason shown, and accepting a suggestion adds them to Network
without contacting anyone.
