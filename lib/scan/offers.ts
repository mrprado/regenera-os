// Audience-to-offer catalogue (phase 15 §6 of the extended specification): AUDIENCE → PROBLEM → BUYER → BUYING EVENT →
// EVIDENCE → ENTRY OFFER → DELIVERABLE → COMMERCIAL MODEL → NEXT STEP. One audience can have several motions: an EPC can
// BUY origination support, DELIVER as a partner on a client project, or INTRODUCE a developer; each has its own buyer,
// qualification and economics. Pricing is never written here: each offer points to a service in the workspace's services
// catalogue (Clients → Services & pricing), whose bands and list price are the approved source. Proof is limited to
// disclosure-authorized case records; with none recorded, documents say so instead of inventing one.
import { audience } from "./audiences";

export const MOTIONS = {
  client: "Buys a Regenera engagement",
  delivery_partner: "Delivers alongside Regenera on a client's project",
  introducer: "Introduces clients or projects (referral)",
  capital: "Capital relationship (mandate screening; no regulated activity)",
  public_programme: "Public programme or procurement",
} as const;
export type Motion = keyof typeof MOTIONS;

export type Offer = {
  key: string; audience: string; motion: Motion; name: string;
  problem: string; buyerRoles: string[]; buyingEvents: string[]; evidenceOfNeed: string[];
  qualification: string[]; disqualifiers: string[];
  entryOffer: string; deliverables: string[]; serviceKey: string | null; commercialModel: string;
  proposalTemplate: string | null; specialistReview: string[]; nextStep: string;
};

const O = (o: Offer) => o;
export const OFFERS: Offer[] = [
  O({ key: "epc_origination", audience: "epc_engineering", motion: "client", name: "EPC origination pilot",
    problem: "Backlog depends on projects reaching the EPC late, through bid lists, with no early sponsor relationship.",
    buyerRoles: ["VP / Director of business development (economic buyer)", "Preconstruction or estimating lead (technical reviewer)", "CEO or COO for pilot approval"],
    buyingEvents: ["New ISO or country entry", "Backlog gap or lost bids disclosed", "BD or estimating hiring"],
    evidenceOfNeed: ["Stated target markets and technologies", "Recent wins / losses or backlog statements", "Hiring for origination"],
    qualification: ["Technologies and scope the EPC actually delivers", "Markets it can mobilize in", "Contract-size range", "Named buyer who can approve a pilot", "Budget path for a fixed-fee pilot"],
    disqualifiers: ["No capacity in the next 12 months", "Only public tenders through a fixed bid list", "Conflict with an existing Regenera mandate in the same market"],
    entryOffer: "45-day origination pilot: pre-qualified project list from public interconnection queues and sponsor identification",
    deliverables: ["Pre-qualified project list with evidence", "Sponsor identification for priority projects", "Weekly pursuit report"],
    serviceKey: "market_intel", commercialModel: "Fixed pilot fee from the services catalogue; any award-linked fee is potential only and needs counsel review.",
    proposalTemplate: "epc_origination", specialistReview: ["Counsel review for any success-linked fee"], nextStep: "30-minute scoping call to confirm markets, technologies and size range" }),
  O({ key: "epc_delivery_partner", audience: "epc_engineering", motion: "delivery_partner", name: "EPC as delivery partner",
    problem: "Regenera clients need credible delivery options early, before design and capital decisions lock in.",
    buyerRoles: ["Head of preconstruction (partner lead)", "BD director"], buyingEvents: ["A Regenera client project needs an EPC view"],
    evidenceOfNeed: ["A live client project with matching technology and geography"],
    qualification: ["Verified credentials for the technology", "Coverage in the project's jurisdiction", "Bonding / insurance capacity where relevant"],
    disqualifiers: ["Unverified credentials", "Conflict with the client's procurement rules"],
    entryOffer: "Partner Network invitation for specific client projects", deliverables: ["Partner profile on record", "Project-specific capability statement"],
    serviceKey: null, commercialModel: "No fee to Regenera from the partner unless a referral agreement is signed (counsel template).",
    proposalTemplate: "joint_delivery", specialistReview: ["Referral agreement through counsel"], nextStep: "Capability call and partner profile" }),
  O({ key: "epc_introducer", audience: "epc_engineering", motion: "introducer", name: "EPC introducing a developer",
    problem: "EPCs meet developers whose projects stall on site, grid or capital questions outside the EPC's scope.",
    buyerRoles: ["BD director (introducer)"], buyingEvents: ["Developer client with a stalled or unready project"],
    evidenceOfNeed: ["Named developer and project"], qualification: ["Introducer's relationship with the developer", "Developer consent to be introduced"],
    disqualifiers: ["Introduction would conflict with the developer's own advisers"], entryOffer: "Referral arrangement", deliverables: ["Introduction record with attribution"],
    serviceKey: null, commercialModel: "Referral fee only under a signed referral agreement.", proposalTemplate: null, specialistReview: ["Referral agreement through counsel"], nextStep: "Agree referral terms before the introduction" }),
  O({ key: "developer_diagnostic", audience: "renewable_developers", motion: "client", name: "Project diagnostic (site, grid, land)",
    problem: "A project's site, interconnection or land position is uncertain, and capital will not move until it is resolved.",
    buyerRoles: ["Head of development (economic buyer)", "Project manager (champion)", "Grid / interconnection lead (technical reviewer)"],
    buyingEvents: ["Queue filing, restudy or withdrawal", "Permitting or land-use conflict", "Capital raise or sell-down"],
    evidenceOfNeed: ["Queue record or permit filing", "Public statements about the project"],
    qualification: ["A named project with a location", "The decision the developer must make", "Timing of that decision", "Budget path for a fixed-fee diagnostic"],
    disqualifiers: ["No project-level decision pending", "Project already through financial close"],
    entryOffer: "Project / site screening", deliverables: ["Screening memo", "Initial risk list", "Required studies list"],
    serviceKey: "project_screening", commercialModel: "Fixed fee from the services catalogue band.", proposalTemplate: "developer_diagnostic", specialistReview: [], nextStep: "Scoping call on one named project" }),
  O({ key: "real_estate_site_diagnostic", audience: "real_estate_developers", motion: "client", name: "Site and watershed diagnostic",
    problem: "A site decision (acquisition, entitlement, phasing) depends on water, terrain and territorial constraints that are not yet evidenced.",
    buyerRoles: ["Head of development (economic buyer)", "Acquisitions lead (champion)", "Design / engineering lead (technical reviewer)"],
    buyingEvents: ["Land acquisition", "Entitlement application", "Green-finance requirement"],
    evidenceOfNeed: ["Named site", "Public filings or announcements"], qualification: ["A named site or boundary", "The pending decision", "Timing", "Budget path"],
    disqualifiers: ["Brokerage-only activity", "No site under consideration"], entryOffer: "Site intelligence screen", deliverables: ["Site screening brief"],
    serviceKey: "site_intel_screen", commercialModel: "Fixed fee from the services catalogue band.", proposalTemplate: "site_diagnostic", specialistReview: ["Topographic / hydrological specialists if field work is needed"], nextStep: "Site boundary and decision call" }),
  O({ key: "capital_mandate_screening", audience: "funds_asset_managers", motion: "capital", name: "Mandate brief and screening record",
    problem: "Deployment against a stated mandate is slowed by unscreened, unready project flow.",
    buyerRoles: ["Partner / investment director (economic buyer)", "Associate (champion)"], buyingEvents: ["Fund close", "New strategy", "Deployment pressure"],
    evidenceOfNeed: ["Published strategy or mandate", "Fund close announcement"], qualification: ["Written mandate criteria (geography, sector, stage, ticket, instruments)", "Source and date of the mandate"],
    disqualifiers: ["Mandate outside Regenera's sectors", "Request implies regulated placement activity"], entryOffer: "Mandate definition session and screening record",
    deliverables: ["Written mandate criteria", "Screening record of matching projects"], serviceKey: "capital_strategy",
    commercialModel: "Advisory fee from the services catalogue; no success fee on capital without counsel review and a licensed intermediary where required.",
    proposalTemplate: "capital_screening", specialistReview: ["Counsel: no regulated securities activity"], nextStep: "Mandate definition session" }),
  O({ key: "family_office_mandate", audience: "family_offices", motion: "capital", name: "Mandate definition session (family office)",
    problem: "An impact or real-asset allocation exists in principle but has no written criteria to screen against.",
    buyerRoles: ["CIO (economic buyer)", "Head of impact (champion)"], buyingEvents: ["New allocation", "Succession", "Investment hire"],
    evidenceOfNeed: ["Stated allocation or programme"], qualification: ["Evidenced strategy (never inferred from the name)", "Decision process", "Budget path"],
    disqualifiers: ["No direct or fund investments in real assets"], entryOffer: "Mandate definition session", deliverables: ["Written mandate", "Screening criteria"],
    serviceKey: "portfolio_advisory", commercialModel: "Advisory fee from the services catalogue.", proposalTemplate: "capital_screening", specialistReview: ["Counsel: investor classification is not assessed by the OS"], nextStep: "Mandate session" }),
  O({ key: "lender_screening", audience: "banks_lenders", motion: "capital", name: "Bankable-project screening brief",
    problem: "Project-finance desks see unready projects and spend diligence on ones that fail early.", buyerRoles: ["Project finance director (economic buyer)", "Associate (champion)"],
    buyingEvents: ["New infrastructure-debt desk", "Green-loan framework"], evidenceOfNeed: ["Published lending appetite"], qualification: ["Stated sectors, geographies and ticket"],
    disqualifiers: ["Retail-only lending"], entryOffer: "Screening brief on mandate-fit projects", deliverables: ["Screening brief"], serviceKey: "capital_strategy",
    commercialModel: "Advisory fee or partner arrangement; no placement fees without counsel review.", proposalTemplate: "capital_screening", specialistReview: ["Counsel"], nextStep: "Lending criteria call" }),
  O({ key: "dfi_screening", audience: "dfis_mdbs", motion: "capital", name: "Screening briefing on mandate-fit projects",
    problem: "Country strategies need investable, screened projects.", buyerRoles: ["Investment officer", "Sector lead"], buyingEvents: ["New facility or call", "Country strategy update"],
    evidenceOfNeed: ["Published facility or call"], qualification: ["Facility criteria", "Eligible applicant types"], disqualifiers: ["Facility closed or ineligible geography"],
    entryOffer: "Screening briefing", deliverables: ["Pipeline brief"], serviceKey: null, commercialModel: "Relationship; fees come from the sponsor-side engagement.", proposalTemplate: null, specialistReview: [], nextStep: "Introductory briefing" }),
  O({ key: "industrial_resource_diagnostic", audience: "industrial_resource_clients", motion: "client", name: "Waste and resource systems diagnostic",
    problem: "Waste, water or energy flows carry cost and risk that an intervention could change.", buyerRoles: ["Plant director (economic buyer)", "Sustainability lead (champion)", "Operations engineer (technical reviewer)"],
    buyingEvents: ["Cost pressure", "Disclosure requirement", "Closure or expansion"], evidenceOfNeed: ["Disclosure or permit data"], qualification: ["Named facility", "Flows and costs available", "Budget path"],
    disqualifiers: ["No facility-level decision"], entryOffer: "Project / site screening", deliverables: ["Screening memo"], serviceKey: "project_screening",
    commercialModel: "Fixed fee from the services catalogue band.", proposalTemplate: "developer_diagnostic", specialistReview: [], nextStep: "Facility data call" }),
  O({ key: "landowner_options", audience: "landowners_agriculture", motion: "client", name: "Productive-landscape diagnostic",
    problem: "The landholding's options (production, restoration, development) are not compared on evidence.", buyerRoles: ["Owner (economic buyer)", "Estate manager (champion)"],
    buyingEvents: ["Succession", "Degradation or drought", "Carbon interest"], evidenceOfNeed: ["Boundary and tenure evidence"], qualification: ["Boundary", "Ownership / tenure evidence", "Objective"],
    disqualifiers: ["Tenure disputed without a path to resolution"], entryOffer: "Site intelligence screen", deliverables: ["Options brief"], serviceKey: "site_intel_screen",
    commercialModel: "Fixed fee from the services catalogue band.", proposalTemplate: "site_diagnostic", specialistReview: ["Land / tenure counsel where rights are unclear"], nextStep: "Boundary and objectives session" }),
  O({ key: "municipal_programme", audience: "municipalities_authorities", motion: "public_programme", name: "Municipal systems diagnostic / programme concept",
    problem: "A public service failure or development priority needs a funded, procurable programme.", buyerRoles: ["Director of public works (economic buyer)", "Planning director (champion)", "Procurement office (procurement reviewer)"],
    buyingEvents: ["Tender or procurement notice", "Service failure", "New development plan"], evidenceOfNeed: ["Official notice or plan"], qualification: ["Procurement route", "Budget or funding path", "Decision body"],
    disqualifiers: ["No lawful procurement route for the engagement"], entryOffer: "Programme concept", deliverables: ["Programme concept note", "Funding pathway"], serviceKey: "funding_scan",
    commercialModel: "Per the procurement route; fees as tendered or from the services catalogue.", proposalTemplate: "public_programme", specialistReview: ["Procurement rules review"], nextStep: "Confirm the procurement route" }),
  O({ key: "referral_partner", audience: "legal_advisory_partners", motion: "introducer", name: "Partner Network (legal / advisory)",
    problem: "The partner's clients reach project decisions outside the partner's scope.", buyerRoles: ["Partner (introducer)"], buyingEvents: ["Client mandate with a project decision"],
    evidenceOfNeed: ["Practice area"], qualification: ["Practice fit", "Conflicts cleared"], disqualifiers: ["Conflict with an existing Regenera client"],
    entryOffer: "Partner Network invitation", deliverables: ["Referral agreement"], serviceKey: null, commercialModel: "Referral fee only under a signed referral agreement.",
    proposalTemplate: "joint_delivery", specialistReview: ["Counsel template"], nextStep: "Partner call" }),
  O({ key: "architect_joint", audience: "architects_planners", motion: "delivery_partner", name: "Joint territorial concept",
    problem: "A masterplan needs territorial evidence (water, terrain, systems) the practice does not produce.", buyerRoles: ["Principal"], buyingEvents: ["Masterplan win", "Competition shortlist"],
    evidenceOfNeed: ["Named project"], qualification: ["Project with a site", "Fee split agreed"], disqualifiers: ["No site-level project"], entryOffer: "Joint territorial concept",
    deliverables: ["Joint scope"], serviceKey: "site_intel_assess", commercialModel: "Subcontract or joint fee per agreed scope.", proposalTemplate: "joint_delivery", specialistReview: [], nextStep: "Project call" }),
];

export const offersFor = (audienceKey: string) => OFFERS.filter(o => o.audience === audienceKey);
export const offer = (key: string) => OFFERS.find(o => o.key === key) ?? null;
/** Every offer references a known audience (tested). */
export const offerAudienceValid = (o: Offer) => audience(o.audience) !== null;
