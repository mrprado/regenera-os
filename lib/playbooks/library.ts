// The initial playbook library (master build instruction §22). Seeded once per entity as version 1, maturity Draft;
// after that the database copy is the source of truth and only changes through approved versions.
import type { CheckSpec, Governance, PlaybookDefinition } from "./types";

type Seed = { key: string; name: string; entityType: "project" | "organization" | "capital_opportunity" | "deal" | "document" | "none"; def: PlaybookDefinition };

const step = (key: string, title: string, governance: Governance = "review", tool?: string, detail?: string) => ({ key, title, governance, tool, detail });
const proof = (id: string, text: string, check: CheckSpec) => ({ id, text, check });
const gov = (autonomous: string[], review: string[], approval: string[], restricted: string[] = []) => ({ autonomous, review, approval, restricted });
const STD_GOV = gov(["retrieve public data", "calculate", "summarise", "generate checklists"], ["readiness assessment", "risk classification", "capital matching", "document extraction"], ["external representation", "investment recommendation"], ["binding offers", "legal determinations"]);

export const PLAYBOOK_LIBRARY: Seed[] = [
  { key: "project-intake", name: "Project intake", entityType: "project", def: {
    purpose: "Turn a new project lead into a project record with location, sponsor and the first facts.", whenToUse: "A sponsor, intake form or signal brings a project.", trigger: "Project created or intake converted",
    inputs: ["Sponsor contact", "Location", "Technology and size", "Capital need as stated"],
    steps: [step("record", "Record identity: name, asset class, technology, capacity, country", "autonomous"), step("sponsor", "Link the sponsor organization (proposed until confirmed)"), step("location", "Set coordinates or boundary"), step("place", "Run the place profile", "autonomous", "place.profile"), step("request", "Send the project information request (sponsor portal)")],
    rules: [{ id: "r1", text: "Sponsor-stated figures are recorded as Sponsor provided, never Verified." }, { id: "r2", text: "No capital need is recorded as a single 'seeking $X'; break it into requirements." }],
    toolbox: [{ kind: "tool", name: "place.profile" }, { kind: "template", name: "Project information request" }, { kind: "subplaybook", name: "project-qualification" }],
    proof: [proof("p1", "Country recorded", { type: "field_present", field: "country" }), proof("p2", "Coordinates recorded", { type: "field_present", field: "lat" }), proof("p3", "Sponsor linked", { type: "party_role", role: "sponsor" }), proof("p4", "Asset class recorded", { type: "field_present", field: "assetClass" })],
    evidence: ["Source of the lead"], governance: STD_GOV } },
  { key: "project-qualification", name: "Project qualification", entityType: "project", def: {
    purpose: "Decide whether Regenera should work on the project.", whenToUse: "After intake, before any mandate.", trigger: "Stage Screening",
    inputs: ["Intake record", "Place profile", "Sponsor screening"],
    steps: [step("readiness", "Record readiness for at least 6 dimensions with evidence"), step("constraints", "Record known constraints with owners"), step("summary", "Summarise readiness", "autonomous", "readiness.summary"), step("decide", "Decide: qualify, watch or decline (decision log)", "approval")],
    rules: [{ id: "r1", text: "Readiness comes from recorded evidence; there is no overall score." }],
    toolbox: [{ kind: "tool", name: "readiness.summary" }, { kind: "subplaybook", name: "sponsor-screening" }],
    proof: [proof("p1", "At least 6 readiness dimensions recorded", { type: "readiness_known", min: 6 }), proof("p2", "Qualification decision logged", { type: "count_at_least", source: "decisions", min: 1, where: { status: "decided" } })],
    evidence: ["Readiness evidence per dimension"], governance: STD_GOV } },
  { key: "sponsor-screening", name: "Sponsor screening", entityType: "organization", def: {
    purpose: "Know who the sponsor is before investing time.", whenToUse: "New sponsor organization.", trigger: "Sponsor linked to a project",
    inputs: ["Organization record", "Beneficial owners", "Track record"],
    steps: [step("relationship", "Check existing relationship", "autonomous", "org.relationship"), step("identity", "Confirm legal entity and registration (GLEIF, registry)"), step("kyc", "Record KYC / sanctions status (owner-only)", "approval"), step("track", "Record track record with sources")],
    rules: [{ id: "r1", text: "Sanctions and PEP status come from a provider or counsel, never from web search alone." }],
    toolbox: [{ kind: "api", name: "GLEIF" }, { kind: "api", name: "SEC EDGAR" }, { kind: "api", name: "Companies House" }],
    proof: [proof("p1", "Country recorded", { type: "field_present", field: "country" }), proof("p2", "KYC reviewed by a person", { type: "manual" })],
    evidence: ["Registry extract", "KYC reference"], governance: STD_GOV } },
  { key: "site-intelligence", name: "Site intelligence", entityType: "project", def: {
    purpose: "Understand the place: resource, hazards, infrastructure, ecology, economy.", whenToUse: "A project has coordinates.", trigger: "Run site intelligence (Atlas or project)",
    inputs: ["Coordinates or polygon"],
    steps: [step("place", "Build the place profile", "autonomous", "place.profile"), step("studies", "Check which studies exist", "autonomous", "study.gaps"), step("read", "Read the facts and record constraints and risks they reveal"), step("unknowns", "List what is unknown")],
    rules: [{ id: "r1", text: "Absence of GBIF occurrences is not absence of species." }, { id: "r2", text: "Public Nominatim is not used for production geocoding." }],
    toolbox: [{ kind: "api", name: "NASA POWER" }, { kind: "api", name: "World Bank Indicators" }, { kind: "api", name: "OpenStreetMap Overpass" }, { kind: "api", name: "USGS" }, { kind: "api", name: "GBIF" }, { kind: "api", name: "PVGIS" }],
    proof: [proof("p1", "Coordinates recorded", { type: "field_present", field: "lat" }), proof("p2", "At least 5 place facts with provenance", { type: "count_at_least", source: "place_facts", min: 5 })],
    evidence: ["Provider, retrieval date and licence per fact"], governance: STD_GOV } },
  { key: "solar-project-screen", name: "Solar project screen", entityType: "project", def: {
    purpose: "Screen a solar project: resource, grid, land, economics.", whenToUse: "Asset class solar.", trigger: "Solar project enters Screening",
    inputs: ["Coordinates", "Capacity", "Grid information"],
    steps: [step("resource", "Resource from PVGIS / NASA POWER", "autonomous", "place.profile"), step("grid", "Record grid readiness with evidence"), step("land", "Record land control"), step("economics", "Run a screening economics case"), step("studies", "Check studies", "autonomous", "study.gaps")],
    rules: [{ id: "r1", text: "Google Solar is for rooftops, not utility-scale screening." }],
    toolbox: [{ kind: "api", name: "PVGIS" }, { kind: "api", name: "NASA POWER" }, { kind: "tool", name: "Economics tab" }],
    proof: [proof("p1", "Capacity recorded", { type: "field_present", field: "capacity" }), proof("p2", "Resource facts recorded", { type: "count_at_least", source: "place_facts", min: 3 }), proof("p3", "Revenue mechanism recorded", { type: "count_at_least", source: "revenue_streams", min: 1 })],
    evidence: ["Resource source", "Grid evidence"], governance: STD_GOV } },
  { key: "data-room-audit", name: "Data room audit", entityType: "project", def: {
    purpose: "Know what is missing before investors look.", whenToUse: "Before opening a capital data room.", trigger: "Stage Capital alignment",
    inputs: ["Project documents", "Open requests"],
    steps: [step("list", "List documents by folder"), step("gaps", "Create requests for missing documents"), step("confirm", "Confirm the room is ready", "approval")],
    rules: [{ id: "r1", text: "Nothing securities-related enters a capital room without a distribution approval." }],
    toolbox: [{ kind: "template", name: "Data room folder list" }],
    proof: [proof("p1", "At least 5 documents registered", { type: "count_at_least", source: "documents", min: 5 }), proof("p2", "No open document requests", { type: "none_open", source: "document_requests", where: { status: ["open", "rejected"] } })],
    evidence: ["Document list"], governance: STD_GOV } },
  { key: "capital-pathway-analysis", name: "Capital pathway analysis", entityType: "project", def: {
    purpose: "Structure the capital need into requirements and tranches with fitting sources.", whenToUse: "Project has a capital need.", trigger: "Capital requirement added",
    inputs: ["CAPEX", "Stage", "Readiness"],
    steps: [step("requirements", "Record requirements by purpose and instrument"), step("tranches", "Define tranches and target investor types"), step("match", "Run capital matching", "review", "capital.match"), step("pathway", "Write the pathway (decision log)", "approval")],
    rules: [{ id: "r1", text: "Commercial fit and legal eligibility stay separate; eligibility is a gate." }],
    toolbox: [{ kind: "tool", name: "capital.match" }],
    proof: [proof("p1", "At least one capital requirement", { type: "count_at_least", source: "capital_requirements", min: 1 }), proof("p2", "At least one capital opportunity", { type: "count_at_least", source: "capital_opportunities", min: 1 })],
    evidence: ["Basis for each target"], governance: STD_GOV } },
  { key: "investor-project-match", name: "Investor–project match", entityType: "capital_opportunity", def: {
    purpose: "Find capital that fits and may legally receive the opportunity.", whenToUse: "A capital opportunity exists.", trigger: "Opportunity created or mandates change",
    inputs: ["Opportunity", "Capital profiles and mandates", "Qualifications"],
    steps: [step("run", "Run matching", "review"), step("review", "Shortlist with reasons"), step("gate", "Compliance gate before any approach", "approval")],
    rules: [{ id: "r1", text: "Never display unexplained percentages; show reasons." }],
    toolbox: [{ kind: "tool", name: "capital matching" }],
    proof: [proof("p1", "Matches computed", { type: "count_at_least", source: "opportunity_matches", min: 1 }), proof("p2", "Gate state recorded", { type: "field_present", field: "gateState" })],
    evidence: ["Match reasons"], governance: STD_GOV } },
  { key: "compliance-screen", name: "Compliance screen", entityType: "project", def: {
    purpose: "Spot regulatory requirements early.", whenToUse: "Before development spend.", trigger: "Stage Development",
    inputs: ["Jurisdiction", "Asset class"],
    steps: [step("matrix", "Record the jurisdiction matrix"), step("host", "Host-law requirements with sources"), step("lender", "Seed lender standards (IFC PS, Equator)"), step("counsel", "Route open questions to counsel", "approval")],
    rules: [{ id: "r1", text: "The OS records reviews; it never declares compliance." }],
    toolbox: [{ kind: "reference", name: "IFC Performance Standards" }, { kind: "reference", name: "Equator Principles" }],
    proof: [proof("p1", "Requirements recorded", { type: "count_at_least", source: "requirements", min: 3 }), proof("p2", "Counsel review confirmed", { type: "manual" })],
    evidence: ["Source per requirement"], governance: STD_GOV } },
  { key: "system-capacity-assessment", name: "System capacity assessment", entityType: "project", def: {
    purpose: "Baseline → dependencies → impacts → thresholds → risks → interventions → capital.", whenToUse: "Nature-dependent or land-intensive projects.", trigger: "Systems tab opened",
    inputs: ["Place profile", "Studies"],
    steps: [step("baseline", "Record system baselines with sources"), step("dependencies", "Record dependencies and impacts"), step("risks", "Translate into risks"), step("interventions", "Propose interventions with costs and funding pathways")],
    rules: [{ id: "r1", text: "No single regeneration score." }],
    toolbox: [{ kind: "reference", name: "TNFD LEAP" }],
    proof: [proof("p1", "Risks recorded", { type: "count_at_least", source: "risks", min: 1 }), proof("p2", "E&S issues recorded", { type: "count_at_least", source: "es_issues", min: 1 })],
    evidence: ["Baseline sources"], governance: STD_GOV } },
  { key: "project-update", name: "Monthly project update", entityType: "project", def: {
    purpose: "Tell sponsors and investors what changed, with evidence.", whenToUse: "Monthly or after a milestone.", trigger: "Monthly",
    inputs: ["Milestones", "Decisions", "Readiness changes"],
    steps: [step("collect", "Collect changes since the last update", "autonomous", "readiness.summary"), step("draft", "Draft the update"), step("approve", "Approve and publish to audiences", "approval")],
    rules: [{ id: "r1", text: "No internal notes or investor names in external updates." }],
    toolbox: [{ kind: "template", name: "Monthly project update" }],
    proof: [proof("p1", "Milestones tracked", { type: "count_at_least", source: "milestones", min: 1 }), proof("p2", "Update approved", { type: "manual" })],
    evidence: ["Milestone evidence"], governance: STD_GOV } },
  ...(["document-intelligence", "investor-research", "investor-qualification", "broker-onboarding", "broker-referral-registration", "partner-qualification", "meeting-preparation", "meeting-followup", "investment-memo"] as const).map(key => ({
    key, name: key.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase()), entityType: (key.startsWith("investor") ? "organization" : key === "investment-memo" ? "project" : key.startsWith("partner") || key.startsWith("broker") ? "organization" : "none") as Seed["entityType"],
    def: {
      purpose: {
        "document-intelligence": "Classify, extract and link a document; claims stay Unverified until reviewed.", "investor-research": "Build a capital profile from public sources with provenance.",
        "investor-qualification": "Record jurisdiction-specific qualification with evidence and expiry.", "broker-onboarding": "Onboard an introducer: role, jurisdictions, licences, agreement, compliance review.",
        "broker-referral-registration": "Review a registered introduction: duplicates, claims, jurisdiction, agreement.", "partner-qualification": "Qualify an EPC, OEM or consultant for the network.",
        "meeting-preparation": "Prepare a meeting: who, history, open items, what to ask.", "meeting-followup": "Record outcomes, create actions, update records.", "investment-memo": "Assemble the investment memo from evidence; approval before sharing.",
      }[key],
      whenToUse: "See purpose.", trigger: "Manual", inputs: [],
      steps: [step("do", "Complete the work"), step("check", "Check the definition of done"), step("approve", "Approve where external", "approval")],
      rules: [], toolbox: [], proof: [proof("p1", "Confirmed by a person", { type: "manual" })], evidence: [], governance: STD_GOV,
    },
  })),
];
