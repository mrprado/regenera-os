Yes. At this point I would consolidate everything into **one canonical Claude Code build specification** and stop layering independent prompts afterward.

One addition I would make to the previous architecture is a formal **Documents, Agreements & Contract Lifecycle engine**. A serious development platform needs to understand not only data and relationships but the legal/commercial instruments that move a project from opportunity to operating asset: NDAs, advisory mandates, development agreements, land agreements, PPAs/offtake, interconnection agreements, EPC/O&M, financing documents, security packages, subscription documents, bond documentation, procurement documents, insurance, permits, community agreements, etc. World Bank procurement itself distinguishes goods, works, consulting and non-consulting services and uses standardized procurement documents, while IFC/World Bank frameworks impose project-specific E&S requirements that can flow into contractors and implementation. :chatgpt-content-reference{index="0"}

For the capital side, keep the regulatory architecture especially strict: SEC exemptions differ materially—for example, 506(b) and 506(c) have different solicitation/investor conditions—and FCA financial-promotion rules can reach emails, websites and social media. :chatgpt-content-reference{index="1"}

Here is the final consolidated prompt.

# REGENERA OS
## CANONICAL MASTER BUILD SPECIFICATION
### Global Project Development · Capital · Origination · Engineering · Place · Sustainability · Regulatory · Contract · Intelligence · Execution Operating System

This specification supersedes ALL previous Regenera OS prompts.

Do not treat earlier prompts as separate requirements that create duplicate features.

Consolidate the architecture into one coherent relational operating system.

---

# PART I — MISSION

Regenera OS is the internal operating infrastructure of Regenera.

It is not simply:

- a CRM;
- an investor database;
- a project tracker;
- a sustainability dashboard;
- a GIS;
- a task manager;
- a funding database;
- an engineering system;
- a document repository;
- a construction platform;
- an AI research interface.

It combines the relevant functions of these systems around complex physical projects.

## CORE DEFINITION

Regenera OS is:

**A global project origination, development, capital, regulatory, engineering, ecological-intelligence and execution operating system for physical assets and living systems.**

It should enable Regenera to:

**DISCOVER**

opportunities, projects, sponsors, developers, land, capital, funding, technologies and partners.

↓

**UNDERSTAND**

place, systems, economics, technical requirements, stakeholders, regulation and risks.

↓

**SCOPE**

what must happen to make a project viable.

↓

**MATCH**

projects with capital, funding, developers, engineers, EPCs, suppliers and strategic partners.

↓

**STRUCTURE**

development pathway, commercial model, contracts and capital stack.

↓

**DE-RISK**

land, permitting, technical, environmental, regulatory, commercial, financial and execution constraints.

↓

**FUND**

development, construction and operating capital.

↓

**EXECUTE**

engineering, procurement, construction, commissioning and operations.

↓

**MONITOR**

financial, technical, environmental and social outcomes.

↓

**LEARN**

from projects, markets, relationships and external intelligence.

---

# PART II — NON-NEGOTIABLE ARCHITECTURAL PRINCIPLES

Every project knows its place.

Every requirement knows its jurisdiction.

Every fact knows its source.

Every source knows its date and freshness.

Every relationship knows its context.

Every funding source knows its eligibility.

Every capital source knows its mandate.

Every investor classification knows its jurisdiction.

Every material knows its provenance where available.

Every contract knows its parties, obligations and lifecycle.

Every permit knows its authority and expiry.

Every constraint has an owner and resolution pathway.

Every action advances something.

Every match explains why.

Every regulatory conclusion exposes its evidence and reviewer.

Every AI output distinguishes verified fact from inference.

Every external integration respects its license.

And:

# COMPLEX BACKEND. SIMPLE INTERFACE.

---

# PART III — AUDIT FIRST

DO NOT begin by rebuilding the UI.

First inspect the entire existing Regenera OS codebase.

Audit:

- framework;
- repository structure;
- routes;
- authentication;
- authorization;
- database;
- migrations;
- schemas;
- APIs;
- components;
- design system;
- sidebar;
- Today;
- Projects;
- Pipeline;
- prospecting;
- investors;
- capital;
- funding;
- contacts;
- organizations;
- LinkedIn workflows;
- email workflows;
- intelligence;
- research;
- matching;
- tasks;
- documents;
- GIS;
- integrations;
- background jobs;
- deployment;
- security.

Identify:

ALREADY EXISTS

EXISTS BUT NEEDS IMPROVEMENT

MISSING

DUPLICATED

SHOULD BE CONSOLIDATED

SHOULD NOT BE BUILT YET.

Preserve useful existing functionality.

---

# PART IV — CORE DATA ONTOLOGY

Design Regenera OS relationally.

Primary canonical entities should include, where appropriate:

User

Project

ProjectStage

ProjectRequirement

ProjectReadiness

Milestone

Constraint

Organization

Person

Relationship

Opportunity

Prospect

Outreach

Activity

Action

Decision

Geography

Jurisdiction

Regulation

Permit

License

Standard

EngineeringRequirement

Study

DesignPackage

Material

MaterialProduct

EPD

BillOfQuantity

Supplier

ProcurementPackage

Bid

Contract

ContractObligation

CapitalProfile

PrivateCapitalProfile

InvestorQualification

CapitalMandate

FundingOpportunity

ProjectCapitalRequirement

CapitalOpportunity

CapitalTranche

CapitalStackItem

CapitalMatch

Commitment

FundingEvent

IntelligenceSignal

Risk

InsuranceRequirement

EnvironmentalAssessment

SystemAssessment

Outcome

Document

Source

SourceRecord

Integration

IntegrationSync

Verification

AuditLog.

Reuse existing models where possible.

Do not create duplicate databases.

---

# PART V — RELATIONSHIP GRAPH

Conceptually:

PROJECT

↔ PLACE

↔ SYSTEMS

↔ ORGANIZATIONS

↔ PEOPLE

↔ SPONSORS

↔ DEVELOPERS

↔ CAPITAL

↔ PRIVATE INVESTORS

↔ FUNDING

↔ INSTRUMENTS

↔ REGULATION

↔ CONTRACTS

↔ ENGINEERING

↔ MATERIALS

↔ SUPPLIERS

↔ INTELLIGENCE

↔ RISKS

↔ ACTIONS

↔ DOCUMENTS

↔ OUTCOMES.

The graph is the system.

Navigation is merely a way of viewing it.

---

# PART VI — PRIMARY UI

Keep global navigation simple.

Suggested architecture:

REGENERA OS

TODAY

ORIGINATION
- Prospecting
- Opportunities
- Outreach

PROJECTS
- Projects
- Pipeline

CAPITAL
- Funding
- Capital Partners
- Mandates

INTELLIGENCE
- Intelligence
- Network
- Map

SECONDARY
- Actions
- Documents
- Search
- Settings

Do NOT expose every database entity in navigation.

---

# PART VII — TODAY

Today is the operating command center.

It should answer:

What changed?

What needs me?

What is blocked?

What capital is needed?

What funding became available?

Who needs follow-up?

What regulatory deadline matters?

What external signal changed?

What should I do next?

Sections:

## NEEDS ATTENTION

## PROJECTS

## CAPITAL

## FUNDING

## ORIGINATION

## RELATIONSHIPS

## REGULATORY

## INTELLIGENCE

## SYSTEMS / PLACE

## NEXT ACTIONS

Avoid vanity metrics.

---

# PART VIII — GLOBAL SEARCH

Implement:

CMD + K

CTRL + K

Search:

Projects

People

Organizations

Private investors

Capital partners

Funding programs

Mandates

Opportunities

Intelligence

Actions

Contracts

Documents

Jurisdictions

Regulations

Materials

Suppliers.

Eventually support structured natural-language queries such as:

"Solar developers Mexico >50 MW"

"Private investors interested in infrastructure"

"Funding for watershed restoration LATAM"

"EPCs for 100 MW solar Africa"

"Projects requiring development capital"

"Permits expiring next 90 days"

"Contracts requiring action this month."

---

# PART IX — PROJECT DIGITAL RECORD

Every project has one canonical persistent record.

## IDENTITY

Name

Description

Asset class

Sector

Subsector

Technology

Country

State/province

Municipality

Coordinates

Polygon

Sponsor

Developer

SPV/ProjectCo

Capacity

CAPEX

Stage

Status

Regenera mandate

Regenera role

Project owner

Origination source.

## PROJECT DETAIL TABS

Overview

Development

Place

Systems

Engineering

Materials

Environmental & Social

Commercial

Capital

Regulatory

Partners

Procurement

Contracts

Risk

Documents

Activity

Decisions

Outcomes.

Use progressive disclosure.

---

# PART X — PROJECT LIFECYCLE

Support:

Opportunity

Screening

Diagnostic

Project Readiness

Development

Structuring

Capital Alignment

Diligence

Financial Close

Engineering

Procurement

Construction

Commissioning

COD

Operations

Repowering

Exit

Decommissioning.

Allow sector-specific lifecycle configurations.

---

# PART XI — PROJECT READINESS

Track:

Land

Technical

Engineering

Environmental

Permitting

Grid/interconnection

Commercial

Financial

Capital

Legal

Stakeholder

Procurement

Construction

Operations.

Statuses:

Unknown

Not Started

Early

In Progress

Substantially Ready

Ready

Blocked

Not Applicable.

Do not create fake precision.

---

# PART XII — CONSTRAINT ENGINE

Constraint categories:

Land

Water

Ecology

Permitting

Environmental

Engineering

Grid

Technical

Commercial

Offtake

Feedstock

Capital

Legal

Regulatory

Government

Community

EPC

OEM

Materials

Supply chain

Logistics

Labor

Tax

Currency

Data.

Fields:

Project

Description

Category

Severity

Evidence

Owner

Resolution action

Deadline

Dependencies

Status.

Important constraints surface automatically on Today.

---

# PART XIII — PLACE INTELLIGENCE

Every geolocated project gets a Place Profile.

## LAND

Ownership

Tenure

Zoning

Current use

Soils

Topography

Slope

Geology

Contamination

Agricultural quality.

## WATER

Watershed

Aquifer

Surface water

Groundwater

Floodplain

Water stress

Water quality

Drainage.

## CLIMATE

Temperature

Precipitation

Solar

Wind

Drought

Flood

Wildfire

Cyclone

Heat

Sea-level/coastal risk.

## ECOLOGY

Land cover

Forest

Wetland

Habitat

Protected areas

Species

Connectivity

Critical-habitat indicators.

## HUMAN

Population

Communities

Settlements

Economic activity

Indigenous/community considerations

Cultural heritage.

## INFRASTRUCTURE

Roads

Rail

Ports

Airports

Grid

Transmission

Substations

Pipelines

Water

Waste

Telecom.

---

# PART XIV — SYSTEMS MODEL

Regenera systems:

LAND

WATER

ENERGY

ECOLOGY

FOOD / PRODUCTION

BUILT ENVIRONMENT / INFRASTRUCTURE

COMMUNITY / HUMAN SYSTEMS.

CAPITAL overlays these systems.

Allow relationships such as:

Land

→ drainage

→ watershed

→ engineering

→ CAPEX

→ financing.

Do not treat these as isolated ESG categories.

---

# PART XV — GIS

Support:

Point

Line

Polygon

GeoJSON

WKT/PostGIS.

Where compatible, use PostgreSQL/PostGIS.

Potential map layers:

Projects

Land

Roads

Rail

Ports

Transmission

Substations

Water

Watersheds

Protected areas

Forest

Land cover

Population

Climate

Solar

Wind

Suppliers

Infrastructure

Hazards.

Do not rebuild ArcGIS.

---

# PART XVI — ENGINEERING

Track:

Applicable jurisdiction

Applicable code

Design basis

Technology

Capacity

Performance assumptions.

## STUDIES

Survey

Topography

Geotechnical

Hydrology

Flood

Seismic

Resource

Grid

Traffic/logistics

Other sector studies.

## DESIGN

Concept

Feasibility

Pre-FEED

FEED

30%

60%

90%

IFC

As-built.

## DISCIPLINES

Civil

Structural

Electrical

Mechanical

Process

Geotechnical

Hydrology

Fire

Controls

Grid.

Each requirement:

Jurisdiction

Authority

Source

Standard

Version

Effective date

Last verified

Reviewer.

AI never certifies engineering compliance.

---

# PART XVII — MATERIALS

Support BoQ.

Fields:

Material

Category

Specification

Quantity

Unit

Manufacturer

Supplier

Origin

Distance

Transport

Cost

Lead time

Availability

Recycled content

Biobased content

Virgin content

EPD

Embodied carbon

Water impact

Hazard/toxicity

Certification

Service life

Reuse

Recyclability

End-of-life.

Compare:

Cost

Carbon

Water

Performance

Durability

Availability

Schedule

Local sourcing

Circularity

Supply-chain risk.

---

# PART XVIII — CIRCULARITY

Hierarchy:

AVOID

REDUCE

REUSE

RECLAIM

RECYCLE

RECOVER

DISPOSE.

Track:

Design for disassembly

Modularity

Material passports

Take-back

Recycled content

Reuse

Construction waste

Excavated-material reuse

End-of-life recovery.

Support future cross-project industrial symbiosis.

---

# PART XIX — EMBODIED CARBON

Support lifecycle stages where applicable:

A1-A3

A4

A5

B

C

D.

Never invent EPD data.

Store:

EPD

Manufacturer

Product

PCR

Geography

Validity

Declared unit

GWP

Verification.

---

# PART XX — ENVIRONMENTAL & SOCIAL

Track:

ESIA

Biodiversity

Critical habitat

Water

Air

Noise

Light

Waste

Hazardous materials

GHG

Climate resilience

Labor

Occupational H&S

Community H&S

Land acquisition

Resettlement

Indigenous peoples

Cultural heritage

Stakeholder engagement

Grievance mechanisms

Supply-chain E&S

Decommissioning.

Distinguish:

HOST COUNTRY LAW

from

LENDER / INVESTOR STANDARDS.

Support:

IFC Performance Standards

IFC/WBG EHS Guidelines

World Bank ESF

Equator Principles

DFI/ECA/lender requirements

where applicable.

Use mitigation hierarchy:

AVOID

MINIMIZE

RESTORE

OFFSET / COMPENSATE.

---

# PART XXI — COMMERCIAL

Track revenue mechanisms:

PPA

Offtake

Tolling

Concession

Feedstock

Tipping fee

Lease

Product sale

Availability payment

Environmental credit

Other.

Counterparty:

Credit

Contract duration

Currency

Indexation

Termination

Guarantee

Payment security.

---

# PART XXII — PROJECT ECONOMICS

Support:

CAPEX

OPEX

Revenue

EBITDA

Cash flow

IRR

NPV

DSCR

LLCR

Payback

Debt sizing.

Scenarios:

Base

Downside

Upside.

Variables:

CAPEX

COD delay

Interest rate

FX

Yield/resource

Revenue

Offtake

Material cost

Carbon price

OPEX.

---

# PART XXIII — CAPITAL ARCHITECTURE

Capital is a primary Regenera capability.

Support:

Development capital

Sponsor equity

Seed capital

Preferred equity

Project equity

Infrastructure equity

Strategic equity

Family-office capital

Private individual capital

Institutional capital

Senior debt

Project finance

Private credit

Mezzanine

Bridge

Construction debt

Bonds

Notes

Green bonds

Sustainability-linked instruments

DFI

MDB

ECA

Government

Green bank

Guarantee

Concessional

Catalytic

First-loss

Blended finance

Grant

Foundation

PRI

MRI

Climate finance

Conservation finance

Carbon finance

Biodiversity finance

Watershed finance

Tax incentive

Subsidy.

---

# PART XXIV — PROJECT CAPITAL REQUIREMENTS

Do not mark a $250M project merely:

"Seeking $250M."

Break capital into requirements.

Example:

Pre-development

$500k

Development

$1.5M

Sponsor equity

$5M

Preferred/project equity

$30M

Senior debt

$150M

Mezzanine

$15M

Catalytic/environmental

$5M

etc.

Each requirement:

Purpose

Stage

Target

Minimum

Maximum

Currency

Instrument

Timing

Target close

Use of funds

Economics

Term

Security

Seniority

Repayment

Exit/refinance

Regulatory status.

---

# PART XXV — CAPITAL TRANCHES

Create CapitalTranche.

Fields:

Project

Capital requirement

Instrument

Target

Currency

Minimum participation

Maximum participation

Economics

Seniority

Security

Eligibility

Target investor type

Status.

A project can contain multiple simultaneous tranches.

---

# PART XXVI — CAPITAL OPPORTUNITY

Create CapitalOpportunity linking:

Project

Issuer

Sponsor

CapitalRequirement

CapitalTranche

Instrument

Offering

Target investors

Jurisdictions

Regulatory status

Approved materials

Outreach

Investor matches

Interest

Commitments

Funding.

This is the bridge between:

PROJECT

and

CAPITAL.

---

# PART XXVII — PRIVATE CAPITAL / UHNW / SOPHISTICATED INVESTOR ARCHITECTURE

The OS must explicitly support:

Private individuals

UHNW relationships

Family principals

Entrepreneurs

Strategic individuals

Family offices

Private investment companies

Trusts/vehicles

Private investment networks where lawful

Angel/seed investors

Professional investors

Institutional investors.

Do NOT treat private capital as an afterthought.

---

# PART XXVIII — PERSON ≠ INVESTOR CLASSIFICATION

Canonical:

Person

may have:

PrivateCapitalProfile

and zero or more:

InvestorQualification records.

Never globally label a person:

"Accredited"

"Sophisticated"

"Professional"

"HNW"

as if these were universal legal classifications.

Investor classification is:

JURISDICTION SPECIFIC

RULE SPECIFIC

TIME SPECIFIC.

---

# PART XXIX — PRIVATE CAPITAL PROFILE

Fields may include:

Person

Associated vehicle

Associated family office

Relationship owner

Relationship source

Relationship strength

Introducer

Primary jurisdiction

Investment vehicle jurisdiction

Preferred channel

Sectors

Geographies

Asset classes

Project stages

Indicative ticket min/max

Currencies

Investment horizon

Income preference

Growth preference

Impact interests

Direct investment

Co-investment

Debt

Equity

Private credit

Bond/note

Infrastructure

Real estate

Land

Development-stage appetite

Construction-stage appetite

Operating-asset appetite

Explicitly known risk appetite

Prior opportunities

Prior investments where appropriately recorded

Constraints

Last interaction

Next action

Last verified.

Unknown remains Unknown.

---

# PART XXX — INVESTOR QUALIFICATION

Create InvestorQualification.

Fields:

Person/entity

Jurisdiction

Classification

Definition/version

Assessment status

Verification status

Method

Verified by

Verification date

Expiry

Evidence reference

Restrictions

Notes.

Statuses:

Unknown

Unassessed

Assessment Required

Self-Certified where legally valid

Third-Party Verified

Professionally Verified

Expired

Not Eligible.

Do not infer qualification from wealth, title, profession or experience unless an approved process permits it.

---

# PART XXXI — PRIVATE CAPITAL INVESTOR JOURNEY

Configurable stages:

Identified

Profiled

Qualification Required

Qualified

Relationship Building

Opportunity Matched

Compliance Review

Approved for Outreach

Presented

Interested

Materials Provided

Meeting

Diligence

IOI

Soft Circle

Commitment

Subscription

Funded

Active Investor

Reporting

Maturity/Exit.

Clearly distinguish:

Conversation

Interest

IOI

Soft circle

Commitment

Executed subscription

Funded.

---

# PART XXXII — BONDS / NOTES

Support DebtSecurity/BondProgram.

Fields:

Issuer

Program

Instrument

Currency

Principal

Issue size

Minimum denomination

Coupon

Coupon type

Maturity

Payment frequency

Seniority

Security

Guarantee

Use of proceeds

ISIN

Listing/venue

Trustee

Paying agent

Arranger

Placement agent

Counsel

Jurisdictions

Offering restrictions

Eligible recipients

Offering documents

Risk disclosures

Subscription process

Status.

Architecture must accommodate RA-ESG-related bond relationships and future third-party issuers without hardcoding RA-ESG.

---

# PART XXXIII — ISSUER / ROLE SEPARATION

Every opportunity clearly identifies:

PROJECT

ISSUER

SPONSOR

DEVELOPER

REGNERA ROLE

ARRANGER

PLACEMENT/DISTRIBUTION PARTY

LEGAL COUNSEL

FINANCIAL ADVISOR

JURISDICTION.

Regenera must NOT automatically be treated as issuer, placement agent, broker or advisor.

---

# PART XXXIV — CAPITAL FORMATION DASHBOARD

Per project:

TARGET

IDENTIFIED

MATCHED

OUTREACH APPROVED

INTERESTED

IOI

COMMITTED

FUNDED.

Avoid double counting.

Support multiple investors per tranche.

---

# PART XXXV — FUNDING UNIVERSE

Create structured FundingOpportunity records.

Fields:

Provider

Program

Country eligibility

Sector

Technology

Sponsor eligibility

Stage

Instrument

Ticket

Currency

Tenor

Pricing

Co-financing

Sponsor equity

E&S requirements

Local content

Deadline

Application process

Restrictions

Official source

Published date

Last verified

Status.

---

# PART XXXVI — CAPITAL PARTNERS

CapitalProfile:

Organization/person where appropriate

Capital type

Ticket min/max

Geographies

Sectors

Technologies

Stages

Instrument

Risk

Return

Tenor

Currency

Impact

E&S

Local content

Relationship owner

Relationship strength

Last contact

Next action

Mandates

Projects

Source

Last verified.

---

# PART XXXVII — MATCHING

Support:

Project ↔ Capital

Project ↔ Private Investor

Project ↔ Funding Program

Project ↔ Developer

Project ↔ Sponsor

Project ↔ EPC

Project ↔ Engineer

Project ↔ OEM

Project ↔ Supplier

Project ↔ Government Program

Project ↔ Advisor

Capital Mandate ↔ Projects.

Use transparent matching.

Dimensions:

Geography

Sector

Technology

Stage

Ticket

Instrument

Risk

Return

Impact

Eligibility

Jurisdiction

Regulatory status.

Always show WHY.

Separate:

COMMERCIAL ALIGNMENT

from

REGULATORY ELIGIBILITY.

---

# PART XXXVIII — ORIGINATION

Two primary engines:

PROJECT ORIGINATION

and

CAPITAL ORIGINATION.

Find:

Projects

Sponsors

Developers

Landowners

Governments

Utilities

Infrastructure owners

Investors

Private investors

Family offices

Funds

Lenders

DFIs

Foundations

Strategics

EPCs

Engineers

Technology providers.

Pipeline:

Discovered

Qualified

Contacted

Engaged

Meeting

Opportunity

Diligence

Mandate

Active

Closed/Lost.

---

# PART XXXIX — PROSPECTING

Preserve/improve existing prospecting.

Filters:

Investor/entity type

Geography

Sector

Project stage

Instrument

Ticket

Relationship

Source

Jurisdiction

Qualification

Outreach status

Last contact

Next action.

Support thesis-based lists.

---

# PART XL — RELATIONSHIP GRAPH

Allow:

Person

→ Organization

→ Family Office

→ Investment Vehicle

→ Advisor

→ Introducer

→ Investor

→ Sponsor

→ Project

→ Co-investor.

Answer:

Who can introduce us?

Who introduced this person?

Who knows this sponsor?

Who has invested alongside whom?

Which existing relationship connects this project to capital?

---

# PART XLI — INTRODUCTIONS

Create Introduction entity:

From

To

Date

Context

Project

Opportunity

Permission/status

Notes.

If compensation is associated:

FLAG:

COMPENSATION / REGULATORY REVIEW REQUIRED.

---

# PART XLII — OUTREACH

Differentiate:

Relationship Outreach

Project Introduction

Investment Communication

Financial Promotion

Approved Offering Communication.

These are not equivalent.

Integrate email/LinkedIn workflows.

Do NOT rebuild Gmail or LinkedIn.

Store communication as Activity linked to:

Person

Organization

Project

Opportunity

CapitalOpportunity.

---

# PART XLIII — MATERIAL DELIVERY AUDIT

Track exactly what each investor received:

Investor

Opportunity

Document

Version

Date

Channel

Sender

Approval status

Acknowledgment where applicable.

---

# PART XLIV — REGULATORY ENGINE

Build a Jurisdiction Matrix.

Capture:

Project jurisdiction

ProjectCo jurisdiction

Sponsor jurisdiction

Regenera entity

Investor jurisdiction

Lender jurisdiction

Issuer jurisdiction

EPC jurisdiction

Equipment origin

Offtaker jurisdiction.

---

# PART XLV — PROJECT REGULATION

Track:

Corporate

Foreign investment

Land

Planning

Zoning

Building

Engineering

Energy

Generation

Grid

Transmission

Water

Waste

Environmental

Labor

H&S

Tax

Customs

Imports

Local content

Currency

Data/privacy

Community

Indigenous rights

Cultural heritage

Decommissioning.

Statuses:

Unknown

Researching

Applicable

Not Applicable

Counsel Review

Required

Submitted

Approved

Expired.

---

# PART XLVI — SECURITIES / CAPITAL REGULATION

Track separately:

Instrument

Issuer

Offering jurisdiction

Investor jurisdiction

Investor classification

Offering exemption

Private placement

General solicitation

Financial promotion

Broker/intermediary activity

Placement

Investment advice

Compensation

KYC

AML

Sanctions

Beneficial ownership

Source of funds

Cross-border marketing.

Never automatically claim:

SEC compliant

FCA compliant

or equivalent.

Store:

Regulatory Review

Reviewer

Date

Evidence

Conditions.

---

# PART XLVII — COMPLIANCE GATE

Before investment-specific outreach:

MATCH

↓

REGULATORY CHECK

↓

RECIPIENT CLASSIFICATION

↓

APPROVED MATERIAL

↓

AUTHORIZED CHANNEL

↓

OUTREACH.

States:

CLEAR

REVIEW REQUIRED

HOLD

APPROVED

NOT PERMITTED.

No autonomous regulated outreach.

---

# PART XLVIII — KYC / AML

Architecture for specialist providers.

Track status rather than unnecessarily retaining highly sensitive documents.

Entity verification

Beneficial ownership

Sanctions

PEP

AML

Source of funds

Investor qualification

NDA

Data room access.

Use specialist providers where appropriate.

---

# PART XLIX — CONTRACT & AGREEMENT ENGINE

This is a first-class component.

Create canonical Contract.

Contract categories may include:

## CORPORATE

Shareholders Agreement

Operating Agreement

Joint Venture Agreement

SPV documents

Board resolutions

Corporate authorities.

## REGNERA COMMERCIAL

NDA

Mutual NDA

Advisory Agreement

Consulting Agreement

Development Services Agreement

Project Origination Agreement

Capital Advisory Agreement

Strategic Partnership Agreement

Referral/Introduction Agreement

Retainer

Success-fee arrangement

MoU

LOI

Term Sheet.

Any compensation linked to securities/capital transactions must trigger regulatory review.

## LAND

Purchase Agreement

Lease

Option

Easement

Right of Way

Concession

Land Access Agreement

Surface Rights

Community Land Agreement.

## DEVELOPMENT

Development Agreement

Co-Development Agreement

Sponsor Agreement

Municipal Agreement

Government Agreement

PPP/Concession Agreement.

## ENERGY / COMMERCIAL

PPA

Offtake Agreement

Tolling Agreement

Feedstock Agreement

Tipping Fee Agreement

Interconnection Agreement

Grid Connection Agreement

Transmission Agreement

Fuel Supply Agreement

Product Sale Agreement.

## ENGINEERING

Engineering Services Agreement

Owner's Engineer Agreement

FEED Agreement

Technical Advisory Agreement.

## PROCUREMENT / CONSTRUCTION

RFI

RFQ

RFP

EPC Contract

EPCM

Construction Agreement

Supply Agreement

Equipment Purchase Agreement

Framework Agreement

BoP Contract

Logistics Agreement

Warranty Agreement.

## OPERATIONS

O&M Agreement

Asset Management Agreement

Service Agreement

Maintenance Agreement.

## FINANCING

Loan Agreement

Credit Agreement

Facility Agreement

Intercreditor Agreement

Security Agreement

Guarantee

Pledge

Mortgage

Account Control

Hedging Agreement

Common Terms Agreement.

## EQUITY

Subscription Agreement

Share Purchase Agreement

Shareholders Agreement

Investment Agreement

Preferred Equity Agreement

JV Agreement.

## BONDS / NOTES

Offering Memorandum

Subscription Agreement

Indenture

Trust Deed

Agency Agreement

Paying Agency Agreement

Security Documents

Guarantee

Bond Terms

Investor Representation Letter where applicable.

## ENVIRONMENTAL / COMMUNITY

Environmental commitments

Restoration agreements

Community Benefit Agreement

Stakeholder agreements

Offset/compensation agreements where applicable.

## INSURANCE

Policies

Certificates

Broker correspondence

Claims.

---

# PART L — CONTRACT DATA MODEL

Each Contract:

Title

Type

Project

Parties

Counterparties

Jurisdictions

Governing law

Execution date

Effective date

Expiration

Renewal

Status

Value

Currency

Payment terms

Term

Conditions precedent

Conditions subsequent

Representations

Warranties

Covenants

Reporting obligations

Deliverables

Milestones

Performance requirements

Insurance requirements

Security

Guarantees

Indemnities

Liability caps

Liquidated damages

Termination rights

Default events

Change control

Assignment

Confidentiality

Dispute resolution

Arbitration/forum

Notices

Key contacts

Related documents

Amendments

Approvals

Source file.

Do not attempt to replace lawyers.

Extract and organize.

---

# PART LI — CONTRACT OBLIGATION ENGINE

Create ContractObligation.

Fields:

Contract

Party responsible

Obligation

Category

Due date

Recurring?

Frequency

Evidence required

Owner

Status

Completion

Source clause

Risk if missed.

Today should surface:

Contract obligations due

Covenants

Renewals

Expirations

Notices

Milestones

Reporting.

---

# PART LII — CONTRACT LIFECYCLE

Draft

Internal Review

Counterparty Review

Legal Review

Negotiation

Approved

Signature

Effective

Active

Amended

Renewal

Expired

Terminated

Archived.

Store version history.

Never overwrite executed versions.

---

# PART LIII — DOCUMENT ENGINE

Documents include:

Corporate

Land

Technical

Engineering

Environmental

Permitting

Commercial

Financial

Capital

Legal

Tax

EPC

Government

Studies

Maps

Construction

Operations.

Track:

Version

Owner

Status

Confidentiality

Project

Counterparty

Approval

Effective date

Expiry.

Prefer Drive/reference integrations over unnecessary duplicate storage.

---

# PART LIV — PROCUREMENT

Pipeline:

Need

RFI

RFQ/RFP

Bid

Clarification

Technical evaluation

Commercial evaluation

BAFO

Selection

Negotiation

Award

Manufacturing

Logistics

Delivery.

Compare:

Technical

Cost

Schedule

Warranty

Performance

LDs

Bankability

Track record

Local content

Materials

Carbon

Financing support.

---

# PART LV — SUPPLY CHAIN

Track:

Supplier

Factory

Country

Product

Capacity

Lead time

Incoterms

Transport

Port

Tariffs

Customs

Local content

Political risk

Certifications

Warranty

Bankability

Supplier risk.

---

# PART LVI — EPC / ENGINEERING NETWORK

Track:

Jurisdictions

Licenses

Technologies

Project sizes

Track record

Completed assets

Bonding

Insurance

Balance sheet

Warranty

Local presence

References

Performance.

Match partners to projects.

---

# PART LVII — CONSTRUCTION

Do not rebuild Procore or Primavera.

Regenera OS is owner/developer control tower.

Track:

NTP

Mobilization

Engineering

Procurement

Civil

Equipment

Installation

Interconnection

Testing

Commissioning

COD.

Monitor:

Schedule

Budget

Change orders

Claims

HSE

Quality

Milestones

Payments

Punch list

Performance tests.

---

# PART LVIII — OPERATIONS

Track:

Production

Availability

Revenue

OPEX

Maintenance

Warranty

Environmental compliance

Covenants

Debt service

DSCR

Insurance

Incidents

Community

Ecological outcomes.

---

# PART LIX — RISK

Categories:

Country

Political

Currency

Regulatory

Permitting

Land

Environmental

Social

Climate

Technology

Engineering

Construction

Supply chain

Materials

Commercial

Offtake

Feedstock

Capital

Interest

FX

Tax

Counterparty

Force majeure

Cyber

Insurance

Reputation.

Each risk:

Evidence

Likelihood

Impact

Mitigation

Owner

Trigger

Status

Residual exposure.

---

# PART LX — INSURANCE

Track applicability:

Construction All Risk

Delay in Start Up

Property

Business Interruption

General Liability

Professional Liability

Environmental Liability

Marine Cargo

Political Risk

Credit Insurance

Cyber

Other.

---

# PART LXI — TAX & STRUCTURING

Track:

ProjectCo

HoldCo

SPV

Jurisdiction

Withholding

VAT

Customs

Depreciation

Tax credits

Incentives

Transfer pricing

Repatriation

FX controls

Treaties.

Professional verification required.

---

# PART LXII — INTELLIGENCE

Types:

Policy

Regulation

Capital

Funding

Energy

Commodity

Technology

Engineering

Materials

Climate

Land

Water

Biodiversity

Agriculture

Infrastructure

Real estate

Conservation

Country risk

Supply chain.

Signal:

Source

Date

Geography

Sector

System

Projects affected

Capital implication

Development implication

Risk/opportunity

Action.

Flow:

SIGNAL

→ INTERPRETATION

→ IMPLICATION

→ PROJECT

→ COUNTERPARTY

→ ACTION.

---

# PART LXIII — FIELD NOTES

Connect public Regenera Field Notes to private intelligence.

Field Note

↔ Signal

↔ Project

↔ Geography

↔ System

↔ Capital.

---

# PART LXIV — SOURCE PROVENANCE

NON-NEGOTIABLE.

Every material fact can store:

Source type

Organization

URL/document

Publication date

Retrieved date

Effective date

Expiry

Jurisdiction

Confidence

Verification

Verified by

Last verified.

Sources:

Government

Regulator

Multilateral

Utility

Sponsor

Developer

Engineer

Counsel

API

Research

Regenera

Media

Social/discovery.

AI inference is never silently converted into verified fact.

---

# PART LXV — SOURCE QUALITY

Tier 1:

Government / regulator / official authority / utility.

Tier 2:

Multilateral / scientific authority / peer reviewed.

Tier 3:

Professional/technical/commercial.

Tier 4:

Reputable secondary.

Tier 5:

Discovery/social/AI.

---

# PART LXVI — TEMPORAL INTELLIGENCE

Store:

Observed

Published

Effective

Expires

Last verified

Next verification.

Surface stale:

Funding programs

Investor mandates

Investor classifications

Regulations

Permits

Pricing

Contracts

Technical assumptions

Contacts.

---

# PART LXVII — OUTCOMES

Financial:

Revenue

Returns

Asset value

Financing

OPEX.

Infrastructure:

MW

MWh

Waste processed

Water treated

Buildings

Infrastructure delivered.

Ecological:

Land restored

Habitat

Water

Soil

Carbon

Biodiversity.

Social:

Jobs

Training

Local procurement

Community infrastructure

Participation.

Evidence required.

---

# PART LXVIII — API / DATA INTEGRATION ARCHITECTURE

Create Integration Registry.

Fields:

Provider

Dataset

Category

Coverage

Base URL

Authentication

Environment variable

License

Commercial use

Attribution

Caching rights

Redistribution rights

Rate limit

Refresh

Last sync

Next sync

Status

Schema version

Adapter version

Errors

Data quality

Source tier.

Architecture:

EXTERNAL SOURCE

↓

ADAPTER

↓

RAW/STAGING

↓

VALIDATION

↓

NORMALIZATION

↓

PROVENANCE

↓

CANONICAL REGNERA DATA

↓

APPLICATION.

Never scatter third-party API calls throughout UI components.

---

# PART LXIX — API ADAPTERS

Common adapter interface:

search()

fetch()

fetchByGeometry()

fetchByCountry()

fetchByDate()

normalize()

validate()

sync()

healthCheck().

Support:

Rate limiting

Retry

Backoff

Caching

Pagination

Logging

Schema validation

License metadata.

---

# PART LXX — INTEGRATION CATALOG

Implement or prepare adapters for the following where technically and legally permitted.

## MAP / GEOGRAPHY

OpenStreetMap

Overpass

Nominatim subject to usage policy

Natural Earth.

## EARTH OBSERVATION

Copernicus Data Space

Sentinel

STAC

OData

openEO.

## CLIMATE / WEATHER

NASA POWER

NOAA

Open-Meteo where appropriate

national meteorological services.

## GEOLOGY / HAZARDS

USGS

national geological surveys

earthquake

landslide

volcanic

flood

wildfire

drought

heat

cyclone

coastal risk.

## ENERGY

NLR/NREL APIs

PVWatts V8

NSRDB where available

Wind Toolkit where available

EIA Open Data

ENTSO-E where credentials/licensing permit

national ISO/RTO/grid data

national energy regulators

IRENA datasets where permitted

Ember datasets where permitted.

## WATER

USGS Water

national water authorities

watershed datasets

groundwater

water quality

flood

water stress.

## BIODIVERSITY

GBIF

Global Forest Watch where permitted

Protected Planet adapter — LICENSE REQUIRED for commercial use where applicable

IUCN/IBAT adapter — LICENSE REQUIRED where applicable

national biodiversity registries.

## ENVIRONMENT

EPA Envirofacts

EPA facility/environmental datasets

OpenAQ subject to licensing

national environmental registries.

## MATERIALS

Building Transparency / EC3 adapter

EPD providers

manufacturer EPDs

regional EPD systems.

Do not assume free development access means commercial production rights.

## ECONOMIC / COUNTRY

World Bank Indicators

IMF datasets/APIs where available

OECD where permitted

Eurostat

national statistics.

## TRADE

UN Comtrade

national customs

tariff data where permitted.

## CORPORATE

GLEIF

SEC EDGAR

UK Companies House

national corporate registries

OpenCorporates only where licensing permits.

## FUNDING

Grants.gov

USAspending

SAM.gov where appropriate

EU Funding & Tenders

TED procurement

World Bank procurement/project feeds

regional development bank feeds

national government grants/incentives.

## DEVELOPMENT FINANCE

World Bank

IFC

MIGA

IDB

IDB Invest

ADB

AfDB

EBRD

EIB

CAF

DFC

national development banks

green banks.

Use APIs/feeds where available; otherwise verified official ingestion.

## CLIMATE / NATURE FUNDING

Green Climate Fund

Global Environment Facility

Adaptation Fund

Climate Investment Funds

government programs

conservation funds

watershed programs

restoration programs

philanthropic programs.

## AGRICULTURE

FAOSTAT

World Bank

national agricultural data

soil datasets where permitted

crop/weather datasets.

## RESEARCH

OpenAlex

Crossref

Semantic Scholar where permitted

relevant technical/scientific sources.

## REGULATION

SEC

FCA

EUR-Lex

European Commission

national securities regulators

energy regulators

environmental agencies

planning/building authorities

tax authorities

customs

labor/H&S authorities.

No fake global regulation API.

## STANDARDS

Track metadata/references for:

IEC

IEEE

ISO

NFPA

ASTM

ASCE

API

AWWA

national standards.

Respect copyright/licensing.

## FINANCIAL MARKETS

FRED

Federal Reserve

ECB

Bank of England

national central banks

EIA

official commodity/energy sources

carbon-market sources where available.

---

# PART LXXI — API LICENSING

For every source store:

Free?

Commercial?

Attribution?

Caching?

Redistribution?

Key?

Rate limit?

License URL?

Restrictions?

Feature state:

ENABLED

DEVELOPMENT_ONLY

LICENSE_REQUIRED

DISABLED.

Never equate:

PUBLIC API

with

UNRESTRICTED COMMERCIAL API.

---

# PART LXXII — FALLBACK WHEN NO API EXISTS

Use:

Official API

↓

Official bulk dataset

↓

Official RSS/feed

↓

Official downloadable file

↓

Manual verified entry

↓

Licensed provider.

Do not make unauthorized scraping core infrastructure.

---

# PART LXXIII — API FAILURE

Use:

Cache

Retry

Backoff

Timeout

Last-known-good

Health status.

Display:

"Source unavailable — displaying data synchronized [date]."

---

# PART LXXIV — REFRESH CADENCE

Weather/hazards:

frequent.

Energy markets:

hourly/daily where appropriate.

Funding:

daily.

Regulation:

daily/weekly.

Investor mandates:

event-driven/periodic verification.

Country indicators:

periodic.

Biodiversity:

periodic.

Project records:

event-driven.

Contracts:

event/deadline-driven.

---

# PART LXXV — AI

AI operates over structured, provenance-backed information.

Potential agents:

Origination Agent

Funding Agent

Matching Agent

Project Agent

Regulatory Agent

Contract Agent

Engineering Agent

Materials Agent

Place Agent

Environmental Agent

Intelligence Agent

Diligence Agent

Relationship Agent

Risk Agent.

AI must:

cite sources

show confidence

distinguish verified/inferred

never fabricate

never certify engineering

never provide final legal compliance sign-off

never autonomously perform regulated solicitation.

---

# PART LXXVI — AI QUESTIONS

Eventually support:

"What changed overnight?"

"What should I work on today?"

"Which projects need funding?"

"What funding became available?"

"Which private investors fit this development tranche?"

"Which institutions fit senior debt?"

"What projects fit Investor X's mandate?"

"What developers should we contact?"

"What permits are outstanding?"

"What is the critical path?"

"What contracts expire this quarter?"

"What obligations are due?"

"What engineering information is missing?"

"What environmental constraints affect this site?"

"What materials drive embodied carbon?"

"What suppliers create concentration risk?"

"What regulations changed?"

"Prepare me for my meeting with X."

"Draft an approved-context follow-up."

---

# PART LXXVII — AUTOMATION

Examples:

New funding

→ match projects.

Investor mandate changes

→ rematch.

Project reaches Capital Alignment

→ create match queue.

Investor qualification expires

→ hold regulated outreach.

Permit nearing expiration

→ alert.

Contract obligation due

→ alert.

Regulation changes

→ identify projects.

Signal appears

→ identify affected projects.

Meeting completes

→ follow-up.

Constraint unresolved

→ Today.

Document received

→ readiness review.

No autonomous regulated solicitation.

---

# PART LXXVIII — SECURITY

Implement:

RBAC

least privilege

server-side authorization

secure auth

encrypted secrets

secure sessions

rate limits

CSRF/XSS/SQLi protection

secure uploads

private storage

backup/recovery

audit logs.

Private investor information receives enhanced protection.

Never expose private OS data through public Regenera routes.

---

# PART LXXIX — USER ROLES

Architect for:

Admin

Partner

Project Developer

Capital

Origination

Analyst

Technical

Compliance

Advisor

External Sponsor

External Investor

External Engineer

Read Only.

Do not necessarily expose external portals now.

---

# PART LXXX — PRIVATE INVESTOR DATA

Apply data minimization.

Sensitive fields should have enhanced controls.

Potentially sensitive:

Qualification evidence

Financial information

KYC

Investment history

Subscription data

Private notes.

Do not collect unnecessary wealth information.

---

# PART LXXXI — AUDIT LOG

Track sensitive changes:

Who

What

When

Old

New

Entity

Reason.

Especially:

Capital

Investor qualification

Regulatory

Compliance

Contracts

Project stages

Documents

Permissions.

---

# PART LXXXII — DATA QUALITY

Fields can carry:

Known

Unknown

Estimated

Sponsor-provided

API-derived

Verified

Stale

Conflicting.

Missing information is intelligence.

Do not hide it.

---

# PART LXXXIII — ENTITY RESOLUTION

Prevent duplicates.

Normalize:

Names

Domains

Emails

LEIs

Corporate identifiers

Addresses.

Support manual merge.

---

# PART LXXXIV — DESIGN

Maintain Regenera identity.

Forest green

White/warm neutral

Restrained gold

Charcoal/black

Precise typography

Subtle borders

Compact tables

Maps

Strong hierarchy.

Avoid:

Generic SaaS

Neon

Excessive gradients

Huge cards

Emoji

Gamification

Meaningless charts.

Feel:

Institutional

Financial

Technical

Ecological

Calm

Precise.

---

# PART LXXXV — RESPONSIVENESS

Desktop:

full operating environment.

Tablet:

fully functional.

Mobile:

Today

Actions

Contacts

Project summary

Meeting intelligence

Notifications.

Do not sacrifice desktop productivity for simplistic mobile layouts.

---

# PART LXXXVI — EXPORTS

Support controlled exports:

Project Brief

Project Diagnostic

Readiness Report

Capital Requirement

Capital Stack

Funding Match Report

Investor Match Report

Regulatory Matrix

Permit Matrix

Contract Register

Obligation Register

Risk Register

Materials Report

E&S Report

Project Status Report.

Respect confidentiality.

---

# PART LXXXVII — PUBLIC / PRIVATE BOUNDARY

PUBLIC:

Regenera website

Field Notes

Approved case studies.

PRIVATE:

Projects

Capital

Private investors

Funding matches

Sponsors

Contacts

Diligence

Regulatory

Contracts

Documents

Outreach

Internal intelligence.

Strictly separate.

---

# PART LXXXVIII — FUTURE PORTALS

Architect for eventual:

PROJECT SPONSOR PORTAL

Submit project

Upload documents

See missing items

Respond to diligence.

CAPITAL PARTNER PORTAL

Submit mandate

View approved opportunities

Request data room.

PRIVATE INVESTOR PORTAL

View only opportunities legally/operationally approved for that user

Documents

Reporting

Portfolio communications.

TECHNICAL PARTNER PORTAL

Qualifications

RFQ/RFP

Documents.

Do not prioritize portal development over internal OS.

---

# PART LXXXIX — PROFESSIONAL BOUNDARY

Regenera OS supports professionals.

It does not replace:

Legal counsel

Broker-dealers / regulated intermediaries

Investment advisers where applicable

Engineers of record

Environmental professionals

Tax professionals

Auditors

Insurance professionals

Investment committees.

System functions:

Identify

Research

Organize

Flag

Route

Track

Document

Verify sign-off.

---

# PART XC — IMPLEMENTATION ROADMAP

## PHASE 0

Audit.

## PHASE 1

Canonical data foundation.

Project

Organization

Person

Relationship

Geography

Jurisdiction

Source

Document

Activity

Action

Requirement

Integration registry.

## PHASE 2

Commercial engine.

Origination

Prospecting

Outreach

Projects

Capital

Private capital

Funding

Mandates

Matching.

## PHASE 3

Capital sophistication.

Capital requirements

Tranches

Capital opportunities

Private investor profiles

Investor qualifications

Bonds/notes

Capital formation.

## PHASE 4

Project development.

Readiness

Constraints

Milestones

Critical path

Decisions.

## PHASE 5

Regulatory.

Jurisdiction matrix

Project regulation

Capital regulation

Compliance gates.

## PHASE 6

Contracts.

Contract registry

Obligations

Lifecycle

Alerts

Document linkage.

## PHASE 7

Place.

GIS

Land

Water

Climate

Ecology

Infrastructure.

## PHASE 8

Engineering.

Studies

Codes

Design

Technical readiness.

## PHASE 9

Materials.

BoQ

EPD

Carbon

Circularity

Supply chain.

## PHASE 10

Environmental/social.

Host-country requirements

Lender standards

Mitigation.

## PHASE 11

Procurement.

EPC

OEM

Supplier

RFP

Bids

Selection.

## PHASE 12

Execution.

Construction

Commissioning

Operations.

## PHASE 13

Advanced finance.

Economics

Scenarios

Blended capital

Sensitivity.

## PHASE 14

AI / automation.

Agents

Monitoring

Alerts

Daily intelligence

Meeting briefs.

---

# PART XCI — FIRST API PRIORITIES

After foundation prioritize:

1. OpenStreetMap / Overpass
2. World Bank Indicators
3. GLEIF
4. SEC EDGAR
5. Grants.gov
6. USAspending
7. NASA POWER
8. Copernicus
9. GBIF
10. Global Forest Watch where permitted
11. USGS Water
12. EPA
13. NLR/NREL PVWatts
14. OpenAlex
15. Crossref
16. Eurostat
17. UN Comtrade
18. Companies House
19. regulator adapters
20. national grid/energy adapters
21. development finance feeds
22. funding feeds.

Restricted/licensed integrations remain adapters until credentials/rights exist.

---

# PART XCII — CREDENTIALS

Never hardcode secrets.

Use environment variables.

Create:

.env.example

containing variable names only.

Document:

Provider

Signup location

Credential

Scopes

Rate limits

License

Setup.

If credentials are unavailable:

build adapter

build tests

disable production integration

show:

"Integration ready — credential required."

---

# PART XCIII — TESTING

For integrations:

Unit tests

Schema tests

Normalization

Errors

Rate limits

Fixtures

Health checks.

Test critical workflow:

Create project

↓

Add location

↓

Generate place profile

↓

Add sponsor

↓

Run diagnostic

↓

Create constraints

↓

Create capital requirements

↓

Create development tranche

↓

Discover funding

↓

Match capital

↓

Match private investor

↓

Run regulatory gate

↓

Approve outreach state

↓

Track communication

↓

Create contract

↓

Track obligation

↓

Update project readiness

↓

Display Today.

---

# PART XCIV — OBSERVABILITY

Admin should see:

Integration health

Sync status

API latency

Last success

Failures

Freshness

Background jobs

Data quality.

---

# PART XCV — PERFORMANCE

Do not call every API on page load.

Use:

background sync

queues

caching

database normalization

incremental sync

geospatial indexes

search indexes

materialized views where useful.

---

# PART XCVI — DOCUMENTATION TO CREATE

Create and maintain:

/docs/regenera-os-architecture.md

/docs/data-model.md

/docs/integrations.md

/docs/integration-licensing.md

/docs/source-provenance.md

/docs/project-lifecycle.md

/docs/capital-model.md

/docs/private-capital-model.md

/docs/regulatory-model.md

/docs/contracts-model.md

/docs/engineering-model.md

/docs/materials-model.md

/docs/place-model.md

/docs/security.md

/docs/permissions.md

/docs/ai-governance.md

/docs/build-roadmap.md

/docs/deployment.md

/docs/testing.md.

Documentation must evolve with implementation.

---

# PART XCVII — SUCCESS TEST: TODAY

Within approximately 60 seconds I should know:

What changed?

What projects moved?

What projects are blocked?

Where is capital needed?

Which tranche needs capital now?

What funding became available?

Which private investors match?

Which institutional capital matches?

Which sponsors/developers should be contacted?

Who needs follow-up?

What regulatory review is required?

Which permits are due?

Which contracts require action?

Which obligations are due?

What engineering information is missing?

What environmental issues matter?

What supply-chain/material risks changed?

What should I do today?

---

# PART XCVIII — SUCCESS TEST: PROJECT

Opening any project should answer:

What is this?

Where is it?

Who owns it?

Who sponsors it?

Who develops it?

What is Regenera's role?

What systems does it interact with?

Can it physically be built?

What engineering is required?

What materials are required?

What environmental/social requirements apply?

What permits are required?

What contracts exist?

What agreements are missing?

What obligations exist?

What is blocking it?

How much capital does it need?

What capital does it need NOW?

What capital will it need later?

What funding programs apply?

Which private investors fit?

Which institutions fit?

Who can engineer it?

Who can build it?

Who can supply it?

What regulatory pathway applies?

What risks exist?

What happens next?

---

# PART XCIX — SUCCESS TEST: CAPITAL RELATIONSHIP

Opening a private investor or capital partner should answer:

Who are they?

How do we know them?

Who introduced them?

What are they interested in?

What ticket range is explicitly known?

What instruments are relevant?

What jurisdictions apply?

What qualification status exists?

What opportunities have been shown?

Which versions of materials were sent?

What interest have they expressed?

What have they committed?

What have they actually funded?

What reporting is owed?

What is the next action?

What projects currently fit?

---

# PART C — FINAL BUILD PRINCIPLE

Do not maximize feature count.

Optimize for:

BETTER PROJECTS

BETTER CAPITAL ALIGNMENT

BETTER ORIGINATION

BETTER DECISIONS

BETTER COMPLIANCE

BETTER EXECUTION

BETTER INSTITUTIONAL MEMORY.

The system should gradually encode how Regenera thinks and operates.

# START NOW

1. Audit the existing codebase.
2. Produce current-state architecture.
3. Map existing features against this specification.
4. Identify duplication.
5. Propose target schema.
6. Propose safe migrations.
7. Produce integration/licensing matrix.
8. Produce regulatory architecture.
9. Produce contract/document architecture.
10. Produce navigation changes.
11. Produce phased implementation plan.
12. Identify the highest-value first milestone.
13. Implement it.
14. Run migrations safely.
15. Run typecheck.
16. Run lint.
17. Run tests.
18. Run build.
19. Fix failures.
20. Document what changed.
21. Continue phase-by-phase without destroying working functionality.

At every decision ask:

**Does this help Regenera originate, understand, structure, fund, de-risk, develop or execute better projects?**

If not, do not add complexity merely because it is technically possible.

### Three things I added that I would consider essential

**Contracts/agreements are now first-class objects.** This matters more than it initially appears. A project becomes real through rights and obligations: land control, interconnection, offtake, development rights, EPC, supply, financing, security, insurance, O&M, community agreements, etc. The OS should eventually be able to tell you not just *“we have a PPA”* but *“the PPA requires X by November 15, the sponsor owns that obligation, clause Y is the evidence source, and it is on the critical path.”* Procurement and contractual requirements can also carry sustainability/E&S obligations into suppliers and contractors. :chatgpt-content-reference{index="2"}

**Private capital is now structurally equal to institutional capital.** A private individual, family principal, bond relationship or UHNW investor can exist as a Person with a PrivateCapitalProfile, while their legal investor classification remains a separate jurisdiction-specific record. That's important because, for example, U.S. accredited-investor status has specific person/entity qualification routes; it isn't synonymous with “wealthy investor.” :chatgpt-content-reference{index="3"}

**Lender requirements are separated from legal permission to build.** A project can satisfy host-country permitting and still fail lender diligence. IFC has eight Performance Standards, and its EHS Guidelines are technical GIIP references with general plus sector-specific guidelines; the World Bank ESF separately contains ten Environmental and Social Standards for applicable projects. :chatgpt-content-reference{index="4"}

I would now **freeze the conceptual architecture** for a while. Give Claude this specification and have it audit what you already built before changing the sidebar or database again. The next useful information will come from seeing where your **existing implementation conflicts with or already satisfies this model**, rather than adding another theoretical layer.