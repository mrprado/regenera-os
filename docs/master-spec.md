# Regenera OS: Canonical Master Build Specification

Received from Prado on 2026-09-24. **Supersedes all previous Regenera OS specifications** (docs/SPEC.md and the
phase plans remain the record of what was built). Lists are compressed onto lines; nothing is omitted.
Audit and gap map: docs/audit-2026-09.md. Plan: docs/plans/phase-6.md.

Global Project Development · Capital · Origination · Engineering · Place · Sustainability · Regulatory · Contract ·
Intelligence · Execution Operating System. Consolidate into one coherent relational operating system; do not treat
earlier prompts as separate requirements that create duplicate features.

## I. Mission
Internal operating infrastructure of Regenera. Not simply a CRM, investor database, project tracker, sustainability
dashboard, GIS, task manager, funding database, engineering system, document repository, construction platform or AI
research interface; it combines the relevant functions around complex physical projects.
**Definition:** a global project origination, development, capital, regulatory, engineering, ecological-intelligence
and execution operating system for physical assets and living systems.
Flow: DISCOVER (opportunities, projects, sponsors, developers, land, capital, funding, technologies, partners) →
UNDERSTAND (place, systems, economics, technical requirements, stakeholders, regulation, risks) → SCOPE (what must
happen to make a project viable) → MATCH (projects with capital, funding, developers, engineers, EPCs, suppliers,
strategic partners) → STRUCTURE (pathway, commercial model, contracts, capital stack) → DE-RISK (land, permitting,
technical, environmental, regulatory, commercial, financial, execution) → FUND (development, construction, operating
capital) → EXECUTE (engineering, procurement, construction, commissioning, operations) → MONITOR (financial,
technical, environmental, social outcomes) → LEARN (projects, markets, relationships, external intelligence).

## II. Non-negotiable principles
Every project knows its place. Every requirement knows its jurisdiction. Every fact knows its source. Every source
knows its date and freshness. Every relationship knows its context. Every funding source knows its eligibility. Every
capital source knows its mandate. Every investor classification knows its jurisdiction. Every material knows its
provenance where available. Every contract knows its parties, obligations and lifecycle. Every permit knows its
authority and expiry. Every constraint has an owner and resolution pathway. Every action advances something. Every
match explains why. Every regulatory conclusion exposes its evidence and reviewer. Every AI output distinguishes
verified fact from inference. Every external integration respects its license. **Complex backend. Simple interface.**

## III. Audit first
Do not begin by rebuilding the UI. Audit framework, repo structure, routes, authentication, authorization, database,
migrations, schemas, APIs, components, design system, sidebar, Today, Projects, Pipeline, prospecting, investors,
capital, funding, contacts, organizations, LinkedIn workflows, email workflows, intelligence, research, matching,
tasks, documents, GIS, integrations, background jobs, deployment, security. Classify: already exists; exists but needs
improvement; missing; duplicated; should be consolidated; should not be built yet. Preserve useful functionality.

## IV. Core data ontology (reuse existing models; no duplicate databases)
User, Project, ProjectStage, ProjectRequirement, ProjectReadiness, Milestone, Constraint, Organization, Person,
Relationship, Opportunity, Prospect, Outreach, Activity, Action, Decision, Geography, Jurisdiction, Regulation,
Permit, License, Standard, EngineeringRequirement, Study, DesignPackage, Material, MaterialProduct, EPD,
BillOfQuantity, Supplier, ProcurementPackage, Bid, Contract, ContractObligation, CapitalProfile,
PrivateCapitalProfile, InvestorQualification, CapitalMandate, FundingOpportunity, ProjectCapitalRequirement,
CapitalOpportunity, CapitalTranche, CapitalStackItem, CapitalMatch, Commitment, FundingEvent, IntelligenceSignal,
Risk, InsuranceRequirement, EnvironmentalAssessment, SystemAssessment, Outcome, Document, Source, SourceRecord,
Integration, IntegrationSync, Verification, AuditLog.

## V. Relationship graph
PROJECT ↔ PLACE ↔ SYSTEMS ↔ ORGANIZATIONS ↔ PEOPLE ↔ SPONSORS ↔ DEVELOPERS ↔ CAPITAL ↔ PRIVATE INVESTORS ↔ FUNDING ↔
INSTRUMENTS ↔ REGULATION ↔ CONTRACTS ↔ ENGINEERING ↔ MATERIALS ↔ SUPPLIERS ↔ INTELLIGENCE ↔ RISKS ↔ ACTIONS ↔
DOCUMENTS ↔ OUTCOMES. The graph is the system; navigation is a way of viewing it.

## VI. Primary UI
TODAY · ORIGINATION (Prospecting, Opportunities, Outreach) · PROJECTS (Projects, Pipeline) · CAPITAL (Funding,
Capital Partners, Mandates) · INTELLIGENCE (Intelligence, Network, Map) · SECONDARY (Actions, Documents, Search,
Settings). Do not expose every entity in navigation.

## VII. Today
Answers: what changed, what needs me, what is blocked, what capital is needed, what funding became available, who
needs follow-up, what regulatory deadline matters, what external signal changed, what next. Sections: Needs
attention, Projects, Capital, Funding, Origination, Relationships, Regulatory, Intelligence, Systems/Place, Next
actions. No vanity metrics.

## VIII. Global search
Cmd/Ctrl+K over projects, people, organizations, private investors, capital partners, funding programs, mandates,
opportunities, intelligence, actions, contracts, documents, jurisdictions, regulations, materials, suppliers.
Eventually structured natural-language queries ("Solar developers Mexico >50 MW", "Private investors interested in
infrastructure", "Funding for watershed restoration LATAM", "EPCs for 100 MW solar Africa", "Projects requiring
development capital", "Permits expiring next 90 days", "Contracts requiring action this month").

## IX. Project digital record
One canonical persistent record. Identity: name, description, asset class, sector, subsector, technology, country,
state/province, municipality, coordinates, polygon, sponsor, developer, SPV/ProjectCo, capacity, CAPEX, stage,
status, Regenera mandate, Regenera role, project owner, origination source. Tabs (progressive disclosure): Overview,
Development, Place, Systems, Engineering, Materials, Environmental & Social, Commercial, Capital, Regulatory,
Partners, Procurement, Contracts, Risk, Documents, Activity, Decisions, Outcomes.

## X. Lifecycle
Opportunity, Screening, Diagnostic, Project Readiness, Development, Structuring, Capital Alignment, Diligence,
Financial Close, Engineering, Procurement, Construction, Commissioning, COD, Operations, Repowering, Exit,
Decommissioning. Sector-specific configurations allowed.

## XI. Readiness
Dimensions: land, technical, engineering, environmental, permitting, grid/interconnection, commercial, financial,
capital, legal, stakeholder, procurement, construction, operations. Statuses: Unknown, Not Started, Early, In
Progress, Substantially Ready, Ready, Blocked, Not Applicable. No fake precision.

## XII. Constraint engine
Categories: land, water, ecology, permitting, environmental, engineering, grid, technical, commercial, offtake,
feedstock, capital, legal, regulatory, government, community, EPC, OEM, materials, supply chain, logistics, labor,
tax, currency, data. Fields: project, description, category, severity, evidence, owner, resolution action, deadline,
dependencies, status. Important constraints surface on Today.

## XIII. Place intelligence (Place Profile per geolocated project)
Land (ownership, tenure, zoning, current use, soils, topography, slope, geology, contamination, agricultural
quality). Water (watershed, aquifer, surface water, groundwater, floodplain, water stress, quality, drainage).
Climate (temperature, precipitation, solar, wind, drought, flood, wildfire, cyclone, heat, sea-level/coastal).
Ecology (land cover, forest, wetland, habitat, protected areas, species, connectivity, critical-habitat indicators).
Human (population, communities, settlements, economic activity, indigenous/community considerations, cultural
heritage). Infrastructure (roads, rail, ports, airports, grid, transmission, substations, pipelines, water, waste,
telecom).

## XIV. Systems model
Land, Water, Energy, Ecology, Food/Production, Built Environment/Infrastructure, Community/Human systems; Capital
overlays them. Relationships such as land → drainage → watershed → engineering → CAPEX → financing. Not isolated ESG
categories.

## XV. GIS
Point, line, polygon, GeoJSON, WKT/PostGIS; PostgreSQL/PostGIS "where compatible". Layers: projects, land, roads,
rail, ports, transmission, substations, water, watersheds, protected areas, forest, land cover, population, climate,
solar, wind, suppliers, infrastructure, hazards. Do not rebuild ArcGIS.

## XVI. Engineering
Jurisdiction, code, design basis, technology, capacity, performance assumptions. Studies: survey, topography,
geotechnical, hydrology, flood, seismic, resource, grid, traffic/logistics, sector studies. Design: concept,
feasibility, pre-FEED, FEED, 30%, 60%, 90%, IFC, as-built. Disciplines: civil, structural, electrical, mechanical,
process, geotechnical, hydrology, fire, controls, grid. Each requirement: jurisdiction, authority, source, standard,
version, effective date, last verified, reviewer. AI never certifies engineering compliance.

## XVII–XIX. Materials, circularity, embodied carbon
BoQ fields: material, category, specification, quantity, unit, manufacturer, supplier, origin, distance, transport,
cost, lead time, availability, recycled/biobased/virgin content, EPD, embodied carbon, water impact, hazard/toxicity,
certification, service life, reuse, recyclability, end-of-life. Compare cost, carbon, water, performance, durability,
availability, schedule, local sourcing, circularity, supply-chain risk. Circularity hierarchy: avoid, reduce, reuse,
reclaim, recycle, recover, dispose; track design for disassembly, modularity, material passports, take-back,
recycled content, reuse, construction waste, excavated-material reuse, end-of-life recovery; future industrial
symbiosis. Embodied carbon stages A1-A3, A4, A5, B, C, D. Never invent EPD data; store EPD, manufacturer, product,
PCR, geography, validity, declared unit, GWP, verification.

## XX. Environmental & social
ESIA, biodiversity, critical habitat, water, air, noise, light, waste, hazardous materials, GHG, climate resilience,
labor, OHS, community H&S, land acquisition, resettlement, indigenous peoples, cultural heritage, stakeholder
engagement, grievance mechanisms, supply-chain E&S, decommissioning. Distinguish host-country law from lender/investor
standards (IFC Performance Standards, IFC/WBG EHS Guidelines, World Bank ESF, Equator Principles, DFI/ECA/lender
requirements). Mitigation hierarchy: avoid, minimize, restore, offset/compensate.

## XXI–XXII. Commercial and economics
Revenue mechanisms: PPA, offtake, tolling, concession, feedstock, tipping fee, lease, product sale, availability
payment, environmental credit, other. Counterparty: credit, duration, currency, indexation, termination, guarantee,
payment security. Economics: CAPEX, OPEX, revenue, EBITDA, cash flow, IRR, NPV, DSCR, LLCR, payback, debt sizing;
scenarios base/downside/upside; variables CAPEX, COD delay, interest rate, FX, yield/resource, revenue, offtake,
material cost, carbon price, OPEX.

## XXIII–XXVI. Capital architecture
Instruments: development capital, sponsor equity, seed, preferred equity, project equity, infrastructure equity,
strategic equity, family-office capital, private individual capital, institutional capital, senior debt, project
finance, private credit, mezzanine, bridge, construction debt, bonds, notes, green bonds, sustainability-linked, DFI,
MDB, ECA, government, green bank, guarantee, concessional, catalytic, first-loss, blended, grant, foundation, PRI,
MRI, climate, conservation, carbon, biodiversity, watershed finance, tax incentive, subsidy.
**Project capital requirements:** break capital into requirements (e.g. pre-development $500k, development $1.5M,
sponsor equity $5M, preferred/project equity $30M, senior debt $150M, mezzanine $15M, catalytic $5M). Each: purpose,
stage, target, minimum, maximum, currency, instrument, timing, target close, use of funds, economics, term, security,
seniority, repayment, exit/refinance, regulatory status.
**CapitalTranche:** project, requirement, instrument, target, currency, min/max participation, economics, seniority,
security, eligibility, target investor type, status; multiple simultaneous tranches.
**CapitalOpportunity** (the bridge between PROJECT and CAPITAL): project, issuer, sponsor, requirement, tranche,
instrument, offering, target investors, jurisdictions, regulatory status, approved materials, outreach, investor
matches, interest, commitments, funding.

## XXVII–XXXI. Private capital
Explicitly support private individuals, UHNW relationships, family principals, entrepreneurs, strategic
individuals, family offices, private investment companies, trusts/vehicles, lawful private networks, angel/seed,
professional and institutional investors. **Person ≠ investor classification:** a Person may have a
PrivateCapitalProfile and zero or more InvestorQualification records; never globally label "accredited",
"sophisticated", "professional", "HNW"; classification is jurisdiction-, rule- and time-specific.
PrivateCapitalProfile: person, vehicle, family office, relationship owner/source/strength, introducer, primary and
vehicle jurisdiction, preferred channel, sectors, geographies, asset classes, stages, indicative ticket min/max,
currencies, horizon, income/growth preference, impact interests, direct/co-invest, debt, equity, private credit,
bond/note, infrastructure, real estate, land, development/construction/operating appetite, explicitly known risk
appetite, prior opportunities, prior investments (where appropriately recorded), constraints, last interaction, next
action, last verified. Unknown remains Unknown.
InvestorQualification: person/entity, jurisdiction, classification, definition/version, assessment status,
verification status, method, verified by, date, expiry, evidence reference, restrictions, notes. Statuses: Unknown,
Unassessed, Assessment Required, Self-Certified (where legally valid), Third-Party Verified, Professionally
Verified, Expired, Not Eligible. Never infer from wealth, title, profession or experience.
Journey: Identified, Profiled, Qualification Required, Qualified, Relationship Building, Opportunity Matched,
Compliance Review, Approved for Outreach, Presented, Interested, Materials Provided, Meeting, Diligence, IOI, Soft
Circle, Commitment, Subscription, Funded, Active Investor, Reporting, Maturity/Exit. Distinguish conversation,
interest, IOI, soft circle, commitment, executed subscription, funded.

## XXXII–XXXIV. Bonds, roles, capital formation
DebtSecurity/BondProgram: issuer, program, instrument, currency, principal, issue size, minimum denomination, coupon
and type, maturity, frequency, seniority, security, guarantee, use of proceeds, ISIN, listing/venue, trustee, paying
agent, arranger, placement agent, counsel, jurisdictions, offering restrictions, eligible recipients, offering
documents, risk disclosures, subscription process, status. Accommodate RA-ESG and future third-party issuers without
hardcoding RA-ESG. Every opportunity identifies project, issuer, sponsor, developer, Regenera role, arranger,
placement/distribution party, counsel, financial advisor, jurisdiction; Regenera is never automatically issuer,
placement agent, broker or advisor. Capital formation per project: target, identified, matched, outreach approved,
interested, IOI, committed, funded; no double counting; multiple investors per tranche.

## XXXV–XXXVII. Funding, capital partners, matching
FundingOpportunity: provider, program, country eligibility, sector, technology, sponsor eligibility, stage,
instrument, ticket, currency, tenor, pricing, co-financing, sponsor equity, E&S requirements, local content,
deadline, application process, restrictions, official source, published date, last verified, status.
CapitalProfile: org/person, capital type, ticket min/max, geographies, sectors, technologies, stages, instrument,
risk, return, tenor, currency, impact, E&S, local content, relationship owner/strength, last contact, next action,
mandates, projects, source, last verified.
Matching: project ↔ capital, private investor, funding program, developer, sponsor, EPC, engineer, OEM, supplier,
government program, advisor; capital mandate ↔ projects. Transparent, always show why. Dimensions: geography,
sector, technology, stage, ticket, instrument, risk, return, impact, eligibility, jurisdiction, regulatory status.
Separate COMMERCIAL ALIGNMENT from REGULATORY ELIGIBILITY.

## XXXVIII–XLIII. Origination, prospecting, relationships, introductions, outreach
Two engines: project origination and capital origination; find projects, sponsors, developers, landowners,
governments, utilities, infrastructure owners, investors, private investors, family offices, funds, lenders, DFIs,
foundations, strategics, EPCs, engineers, technology providers. Pipeline: discovered, qualified, contacted, engaged,
meeting, opportunity, diligence, mandate, active, closed/lost. Prospecting filters: entity type, geography, sector,
stage, instrument, ticket, relationship, source, jurisdiction, qualification, outreach status, last contact, next
action; thesis-based lists. Relationship graph: person → organization → family office → vehicle → advisor →
introducer → investor → sponsor → project → co-investor; answer who can introduce us, who introduced this person,
who knows this sponsor, who co-invested with whom, which relationship connects this project to capital.
Introduction: from, to, date, context, project, opportunity, permission/status, notes; if compensation is
associated, flag COMPENSATION / REGULATORY REVIEW REQUIRED. Outreach types: relationship outreach, project
introduction, investment communication, financial promotion, approved offering communication (not equivalent).
Integrate email/LinkedIn; don't rebuild them; store communication as Activity linked to person, organization,
project, opportunity, capital opportunity. Material delivery audit: investor, opportunity, document, version, date,
channel, sender, approval status, acknowledgment.

## XLIV–XLVIII. Regulatory
Jurisdiction matrix: project, ProjectCo, sponsor, Regenera entity, investor, lender, issuer, EPC, equipment origin,
offtaker. Project regulation: corporate, foreign investment, land, planning, zoning, building, engineering, energy,
generation, grid, transmission, water, waste, environmental, labor, H&S, tax, customs, imports, local content,
currency, data/privacy, community, indigenous rights, cultural heritage, decommissioning; statuses Unknown,
Researching, Applicable, Not Applicable, Counsel Review, Required, Submitted, Approved, Expired.
Securities/capital regulation tracked separately: instrument, issuer, offering and investor jurisdiction, investor
classification, exemption, private placement, general solicitation, financial promotion, broker/intermediary
activity, placement, investment advice, compensation, KYC, AML, sanctions, beneficial ownership, source of funds,
cross-border marketing. Never claim "SEC compliant", "FCA compliant" or equivalent; store review, reviewer, date,
evidence, conditions. Compliance gate before investment-specific outreach: match → regulatory check → recipient
classification → approved material → authorized channel → outreach; states CLEAR, REVIEW REQUIRED, HOLD, APPROVED,
NOT PERMITTED; no autonomous regulated outreach. KYC/AML via specialist providers; track status (entity
verification, beneficial ownership, sanctions, PEP, AML, source of funds, qualification, NDA, data room access)
rather than retaining sensitive documents.

## XLIX–LII. Contracts (first-class)
Categories: Corporate (SHA, operating agreement, JV, SPV documents, board resolutions, authorities). Regenera
commercial (NDA, mutual NDA, advisory, consulting, development services, project origination, capital advisory,
strategic partnership, referral/introduction, retainer, success-fee arrangement, MoU, LOI, term sheet; compensation
linked to securities/capital transactions triggers regulatory review). Land (purchase, lease, option, easement, right
of way, concession, land access, surface rights, community land). Development (development, co-development, sponsor,
municipal, government, PPP/concession). Energy/commercial (PPA, offtake, tolling, feedstock, tipping fee,
interconnection, grid connection, transmission, fuel supply, product sale). Engineering (engineering services, owner's
engineer, FEED, technical advisory). Procurement/construction (RFI, RFQ, RFP, EPC, EPCM, construction, supply,
equipment purchase, framework, BoP, logistics, warranty). Operations (O&M, asset management, service, maintenance).
Financing (loan, credit, facility, intercreditor, security, guarantee, pledge, mortgage, account control, hedging,
common terms). Equity (subscription, SPA, SHA, investment, preferred equity, JV). Bonds/notes (offering memorandum,
subscription, indenture, trust deed, agency, paying agency, security documents, guarantee, bond terms, investor
representation letter). Environmental/community (environmental commitments, restoration, community benefit,
stakeholder, offset/compensation). Insurance (policies, certificates, broker correspondence, claims).
Contract model: title, type, project, parties, counterparties, jurisdictions, governing law, execution/effective/
expiration dates, renewal, status, value, currency, payment terms, term, conditions precedent/subsequent,
representations, warranties, covenants, reporting obligations, deliverables, milestones, performance requirements,
insurance requirements, security, guarantees, indemnities, liability caps, liquidated damages, termination rights,
default events, change control, assignment, confidentiality, dispute resolution, arbitration/forum, notices, key
contacts, related documents, amendments, approvals, source file. Don't replace lawyers: extract and organize.
ContractObligation: contract, party responsible, obligation, category, due date, recurring, frequency, evidence
required, owner, status, completion, source clause, risk if missed. Today surfaces obligations due, covenants,
renewals, expirations, notices, milestones, reporting. Lifecycle: draft, internal review, counterparty review, legal
review, negotiation, approved, signature, effective, active, amended, renewal, expired, terminated, archived; version
history; never overwrite executed versions.

## LIII–LXI. Documents, procurement, supply chain, EPC network, construction, operations, risk, insurance, tax
Documents: corporate, land, technical, engineering, environmental, permitting, commercial, financial, capital, legal,
tax, EPC, government, studies, maps, construction, operations; track version, owner, status, confidentiality,
project, counterparty, approval, effective date, expiry; prefer Drive/reference integrations over duplicate storage.
Procurement pipeline: need, RFI, RFQ/RFP, bid, clarification, technical and commercial evaluation, BAFO, selection,
negotiation, award, manufacturing, logistics, delivery; compare technical, cost, schedule, warranty, performance,
LDs, bankability, track record, local content, materials, carbon, financing support. Supply chain: supplier,
factory, country, product, capacity, lead time, Incoterms, transport, port, tariffs, customs, local content, political
risk, certifications, warranty, bankability, supplier risk. EPC/engineering network: jurisdictions, licenses,
technologies, project sizes, track record, completed assets, bonding, insurance, balance sheet, warranty, local
presence, references, performance; match to projects. Construction (owner/developer control tower, not Procore or
Primavera): NTP, mobilization, engineering, procurement, civil, equipment, installation, interconnection, testing,
commissioning, COD; monitor schedule, budget, change orders, claims, HSE, quality, milestones, payments, punch list,
performance tests. Operations: production, availability, revenue, OPEX, maintenance, warranty, environmental
compliance, covenants, debt service, DSCR, insurance, incidents, community, ecological outcomes. Risk categories:
country, political, currency, regulatory, permitting, land, environmental, social, climate, technology, engineering,
construction, supply chain, materials, commercial, offtake, feedstock, capital, interest, FX, tax, counterparty, force
majeure, cyber, insurance, reputation; each with evidence, likelihood, impact, mitigation, owner, trigger, status,
residual exposure. Insurance: CAR, DSU, property, BI, GL, professional, environmental liability, marine cargo,
political risk, credit, cyber, other. Tax/structuring: ProjectCo, HoldCo, SPV, jurisdiction, withholding, VAT,
customs, depreciation, credits, incentives, transfer pricing, repatriation, FX controls, treaties; professional
verification required.

## LXII–LXVII. Intelligence, field notes, provenance, freshness, outcomes
Signal types: policy, regulation, capital, funding, energy, commodity, technology, engineering, materials, climate,
land, water, biodiversity, agriculture, infrastructure, real estate, conservation, country risk, supply chain. Signal
fields: source, date, geography, sector, system, projects affected, capital and development implication,
risk/opportunity, action. Flow: signal → interpretation → implication → project → counterparty → action. Field Notes
(public) ↔ signal ↔ project ↔ geography ↔ system ↔ capital.
**Provenance (non-negotiable):** source type, organization, URL/document, publication, retrieved, effective and
expiry dates, jurisdiction, confidence, verification, verified by, last verified. Source types: government,
regulator, multilateral, utility, sponsor, developer, engineer, counsel, API, research, Regenera, media,
social/discovery. AI inference is never silently converted into verified fact. Tiers: 1 government/regulator/official
authority/utility; 2 multilateral/scientific/peer reviewed; 3 professional/technical/commercial; 4 reputable
secondary; 5 discovery/social/AI. Temporal: observed, published, effective, expires, last verified, next
verification; surface stale funding programs, investor mandates, classifications, regulations, permits, pricing,
contracts, technical assumptions, contacts. Outcomes with evidence: financial (revenue, returns, asset value,
financing, OPEX), infrastructure (MW, MWh, waste processed, water treated, buildings, infrastructure), ecological
(land restored, habitat, water, soil, carbon, biodiversity), social (jobs, training, local procurement, community
infrastructure, participation).

## LXVIII–LXXIV. Integrations
Integration registry: provider, dataset, category, coverage, base URL, authentication, env var, license, commercial
use, attribution, caching rights, redistribution rights, rate limit, refresh, last/next sync, status, schema
version, adapter version, errors, data quality, source tier. Pipeline: external source → adapter → raw/staging →
validation → normalization → provenance → canonical data → application; never scatter API calls in UI components.
Adapter interface: search, fetch, fetchByGeometry, fetchByCountry, fetchByDate, normalize, validate, sync,
healthCheck; rate limiting, retry, backoff, caching, pagination, logging, schema validation, license metadata.
Catalog: map/geography (OSM, Overpass, Nominatim per usage policy, Natural Earth); earth observation (Copernicus Data
Space, Sentinel, STAC, OData, openEO); climate (NASA POWER, NOAA, Open-Meteo where appropriate, national met
services); geology/hazards (USGS, national surveys, earthquake, landslide, volcanic, flood, wildfire, drought, heat,
cyclone, coastal); energy (NLR/NREL APIs, PVWatts V8, NSRDB, Wind Toolkit, EIA, ENTSO-E where permitted, ISO/RTO,
national regulators, IRENA and Ember where permitted); water (USGS Water, national authorities, watersheds,
groundwater, quality, flood, stress); biodiversity (GBIF, Global Forest Watch where permitted, Protected Planet and
IUCN/IBAT license required, national registries); environment (EPA Envirofacts and facility data, OpenAQ subject to
licensing, national registries); materials (Building Transparency/EC3, EPD providers, manufacturer and regional EPD
systems; free development access ≠ commercial rights); economic (World Bank Indicators, IMF, OECD, Eurostat, national
statistics); trade (UN Comtrade, customs, tariffs); corporate (GLEIF, SEC EDGAR, Companies House, national registries,
OpenCorporates only where licensed); funding (Grants.gov, USAspending, SAM.gov, EU Funding & Tenders, TED, World Bank
procurement/project feeds, regional development banks, national grants); development finance (World Bank, IFC, MIGA,
IDB, IDB Invest, ADB, AfDB, EBRD, EIB, CAF, DFC, national development banks, green banks); climate/nature funding
(GCF, GEF, Adaptation Fund, CIF, government, conservation, watershed, restoration, philanthropic programs);
agriculture (FAOSTAT, World Bank, national, soil, crop/weather); research (OpenAlex, Crossref, Semantic Scholar);
regulation (SEC, FCA, EUR-Lex, European Commission, national securities and energy regulators, environmental
agencies, planning/building, tax, customs, labor/H&S; no fake global regulation API); standards metadata only (IEC,
IEEE, ISO, NFPA, ASTM, ASCE, API, AWWA, national; respect copyright); financial markets (FRED, Federal Reserve, ECB,
Bank of England, central banks, EIA, official commodity/energy, carbon markets).
Licensing per source: free, commercial, attribution, caching, redistribution, key, rate limit, license URL,
restrictions; feature states ENABLED, DEVELOPMENT_ONLY, LICENSE_REQUIRED, DISABLED; public API ≠ unrestricted
commercial API. Fallback: official API → bulk dataset → RSS/feed → downloadable file → manual verified entry →
licensed provider; no unauthorized scraping as core infrastructure. Failure: cache, retry, backoff, timeout,
last-known-good, health status; show "Source unavailable — displaying data synchronized [date]". Refresh: weather and
hazards frequent; energy markets hourly/daily; funding daily; regulation daily/weekly; investor mandates event-driven
and periodic verification; country indicators, biodiversity periodic; project records event-driven; contracts
event/deadline-driven.

## LXXV–LXXVII. AI and automation
Agents: origination, funding, matching, project, regulatory, contract, engineering, materials, place, environmental,
intelligence, diligence, relationship, risk. AI cites sources, shows confidence, distinguishes verified/inferred,
never fabricates, never certifies engineering, never gives final legal compliance sign-off, never autonomously
performs regulated solicitation. Questions to support eventually: what changed overnight; what to work on today;
which projects need funding; what funding became available; which private investors fit a development tranche;
which institutions fit senior debt; what projects fit investor X's mandate; which developers to contact; outstanding
permits; critical path; contracts expiring this quarter; obligations due; missing engineering information;
environmental constraints at a site; embodied-carbon drivers; supplier concentration risk; regulation changes;
meeting prep; approved-context follow-up. Automation: new funding → match projects; mandate change → rematch;
project reaches Capital Alignment → match queue; qualification expires → hold regulated outreach; permit nearing
expiry → alert; obligation due → alert; regulation change → affected projects; signal → affected projects; meeting
completes → follow-up; unresolved constraint → Today; document received → readiness review. No autonomous regulated
solicitation.

## LXXVIII–LXXXIII. Security, roles, private data, audit, data quality, entity resolution
RBAC, least privilege, server-side authorization, secure auth and sessions, encrypted secrets, rate limits,
CSRF/XSS/SQLi protection, secure uploads, private storage, backup/recovery, audit logs; enhanced protection for
private investor data; never expose private data through public routes. Roles: Admin, Partner, Project Developer,
Capital, Origination, Analyst, Technical, Compliance, Advisor, External Sponsor/Investor/Engineer, Read Only
(external portals not now). Data minimization; sensitive fields (qualification evidence, financial information, KYC,
investment history, subscription data, private notes) get enhanced controls; no unnecessary wealth information. Audit
who, what, when, old, new, entity, reason; especially capital, qualification, regulatory, compliance, contracts,
project stages, documents, permissions. Field states: known, unknown, estimated, sponsor-provided, API-derived,
verified, stale, conflicting; missing information is intelligence. Entity resolution: normalize names, domains,
emails, LEIs, corporate identifiers, addresses; manual merge.

## LXXXIV–LXXXVIII. Design, responsiveness, exports, public/private, portals
Regenera identity: forest green, white/warm neutral, restrained gold, charcoal/black, precise typography, subtle
borders, compact tables, maps, strong hierarchy; no generic SaaS, neon, heavy gradients, huge cards, emoji,
gamification or meaningless charts; institutional, financial, technical, ecological, calm, precise. Desktop full;
tablet fully functional; mobile for Today, actions, contacts, project summary, meeting intelligence, notifications.
Controlled exports: project brief, diagnostic, readiness report, capital requirement, capital stack, funding match
report, investor match report, regulatory matrix, permit matrix, contract register, obligation register, risk
register, materials report, E&S report, project status report. Public: website, Field Notes, approved case studies;
everything else private, strictly separated. Future portals (not a priority): sponsor, capital partner, private
investor (only legally/operationally approved opportunities), technical partner.

## LXXXIX–C. Professional boundary, roadmap, tests, principle
The OS supports and does not replace counsel, broker-dealers/regulated intermediaries, investment advisers,
engineers of record, environmental and tax professionals, auditors, insurers, investment committees; it identifies,
researches, organizes, flags, routes, tracks, documents and verifies sign-off.
Roadmap: 0 audit; 1 canonical data foundation (project, organization, person, relationship, geography,
jurisdiction, source, document, activity, action, requirement, integration registry); 2 commercial engine
(origination, prospecting, outreach, projects, capital, private capital, funding, mandates, matching); 3 capital
sophistication (requirements, tranches, capital opportunities, private investor profiles, qualifications,
bonds/notes, capital formation); 4 project development (readiness, constraints, milestones, critical path,
decisions); 5 regulatory (jurisdiction matrix, project and capital regulation, compliance gates); 6 contracts
(registry, obligations, lifecycle, alerts, document linkage); 7 place; 8 engineering; 9 materials; 10 E&S; 11
procurement; 12 execution; 13 advanced finance; 14 AI/automation.
First API priorities after the foundation: OSM/Overpass, World Bank Indicators, GLEIF, SEC EDGAR, Grants.gov,
USAspending, NASA POWER, Copernicus, GBIF, Global Forest Watch (where permitted), USGS Water, EPA, NREL PVWatts,
OpenAlex, Crossref, Eurostat, UN Comtrade, Companies House, regulator adapters, national grid/energy adapters,
development finance feeds, funding feeds. Restricted integrations stay adapters until rights exist.
Credentials: never hardcoded; .env.example with names only; document provider, signup, credential, scopes, rate
limits, license, setup; without credentials build adapter and tests, disable production integration, show
"Integration ready — credential required."
Testing: unit, schema, normalization, errors, rate limits, fixtures, health checks; critical workflow test: create
project → add location → place profile → add sponsor → diagnostic → constraints → capital requirements → development
tranche → discover funding → match capital → match private investor → regulatory gate → approve outreach state →
track communication → create contract → track obligation → update readiness → display Today.
Observability for admin: integration health, sync status, latency, last success, failures, freshness, jobs, data
quality. Performance: no API calls on page load; background sync, queues, caching, normalization, incremental sync,
geospatial and search indexes, materialized views where useful.
Docs to create and maintain: regenera-os-architecture, data-model, integrations, integration-licensing,
source-provenance, project-lifecycle, capital-model, private-capital-model, regulatory-model, contracts-model,
engineering-model, materials-model, place-model, security, permissions, ai-governance, build-roadmap, deployment,
testing.
Success tests: Today (within ~60 seconds: what changed, projects moved/blocked, where capital is needed and which
tranche now, new funding, matching private and institutional capital, sponsors/developers to contact, follow-ups,
regulatory reviews, permits due, contracts and obligations requiring action, missing engineering information,
environmental issues, supply-chain/material risks, what to do today). Project (what, where, who owns/sponsors/
develops, Regenera's role, systems, buildability, engineering, materials, E&S, permits, contracts existing and
missing, obligations, blockers, capital now and later, funding programs, fitting private investors and institutions,
who can engineer/build/supply, regulatory pathway, risks, what next). Capital relationship (who, how we know them,
introducer, interests, explicitly known ticket, instruments, jurisdictions, qualification status, opportunities
shown, material versions sent, interest, commitments, funded, reporting owed, next action, projects that fit).
Final principle: do not maximize feature count; optimize for better projects, capital alignment, origination,
decisions, compliance, execution and institutional memory. At every decision ask whether it helps Regenera
originate, understand, structure, fund, de-risk, develop or execute better projects.

## Prado's notes with the spec
- Contracts are first-class: a project becomes real through rights and obligations (e.g. "the PPA requires X by
  November 15, the sponsor owns that obligation, clause Y is the evidence, and it is on the critical path").
  Procurement terms can carry E&S obligations into suppliers and contractors (World Bank procurement framework).
- Private capital is structurally equal to institutional capital; legal classification is a separate,
  jurisdiction-specific record (US accredited-investor status has specific qualification routes; it is not "wealthy").
  SEC 506(b) and 506(c) differ on solicitation and investor conditions; FCA financial-promotion rules reach email,
  websites and social media.
- Lender requirements are separate from legal permission to build (IFC: 8 Performance Standards and EHS Guidelines;
  World Bank ESF: 10 Environmental and Social Standards).
- Freeze the conceptual architecture; audit what exists before changing the sidebar or database again.

## 2026-09-25 — focused reference additions

`land-intelligence-addendum.md` extends Place/GIS with parcel identity and assembly, boundary measurements,
layer inspection, buildable-area scenarios, survey/deed evidence, field/offline workflows and controlled parcel
briefs. Reuse existing projects, parties, contracts, documents, sources, constraints and actions; do not create
parallel landowner, project or document models. Provider coverage is jurisdiction-specific.

`lucky-futures-gap-review.md` records the narrower discovery additions: linked map directory, existing-topic
filters, richer place context and curated resource views. Neither reference replaces Regenera's OS architecture.
See `architecture-audit-2026-09-25.md` for implementation status and remaining phases.
