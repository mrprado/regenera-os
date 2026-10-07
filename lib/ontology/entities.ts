// Canonical entity types (Regenera ontology v1.0). Each maps to the table that holds it, so every screen, import,
// connector, automation and AI agent names the same thing the same way. Roles are attributes, not entities:
// an investor is an organization with the investor role, and a fund is managed by an organization.

export type EntityDef = { label: string; table: string; group: "physical" | "commercial" | "evidence" | "workflow"; note: string };

export const ENTITIES = {
  project: { label: "Project", table: "projects", group: "physical", note: "The spine. Stage = tracker stage; gate = ontology gate (lib/ontology/states)." },
  site: { label: "Site", table: "projects (lat/lng/geometry) + site_features", group: "physical", note: "Where a project sits; boundary and features." },
  parcel: { label: "Parcel", table: "land_controls (parcel_ref) + land_candidates", group: "physical", note: "Land unit; control is recorded per parcel." },
  infrastructure_asset: { label: "Infrastructure asset", table: "site_features + queue_projects", group: "physical", note: "Plants, lines, substations, roads, ports." },
  grid_node: { label: "Grid node", table: "grid_connections (point of interconnection)", group: "physical", note: "Substation or POI a project connects to." },
  equipment: { label: "Equipment", table: "equipment + project_equipment", group: "physical", note: "Make and model, manufacturer, lead time, warranty." },
  observation: { label: "Observation", table: "place_facts + field_observations + project_attributes", group: "evidence", note: "A measured or retrieved value at a place and time, with source." },
  organization: { label: "Organization", table: "organizations (+ network_profiles)", group: "commercial", note: "Roles: developer, EPC, investor, offtaker, utility, advisor, government …" },
  person: { label: "Person", table: "contacts", group: "commercial", note: "Works at an organization; relationships are metadata only." },
  fund: { label: "Fund", table: "capital_profiles", group: "commercial", note: "Managed by an organization. Private profiles are owner-only." },
  capital_requirement: { label: "Capital requirement", table: "capital_opportunities", group: "commercial", note: "What a project needs: amount, instrument, timing." },
  commercial_mandate: { label: "Commercial mandate", table: "commercial_mandates", group: "commercial", note: "Regenera's scope of work. Not the `mandates` workspace table." },
  engagement: { label: "Engagement", table: "engagements", group: "commercial", note: "Regenera formally engaged: client, scope, fees, deliverables." },
  deal: { label: "Deal", table: "deals", group: "commercial", note: "Pipeline opportunity before or alongside an engagement." },
  contract: { label: "Contract", table: "contracts", group: "commercial", note: "Agreement register, obligations, parties." },
  transaction: { label: "Transaction", table: "commitments + invoices", group: "commercial", note: "Money committed or billed." },
  permit: { label: "Permit", table: "permits (+ permit_dependencies)", group: "workflow", note: "Authority, status, dependencies, expiry." },
  stakeholder: { label: "Stakeholder", table: "stakeholders (+ communities)", group: "workflow", note: "Influence, interest, position, consent." },
  document: { label: "Document", table: "documents", group: "evidence", note: "Registry entry; storage is a link or R2 key." },
  claim: { label: "Claim", table: "claims", group: "evidence", note: "A statement about any entity, with status and validity dates." },
  evidence: { label: "Evidence", table: "claim_evidence", group: "evidence", note: "Where a claim comes from: document, API, registry, site visit." },
  signal: { label: "Signal", table: "signals + mandate_signals", group: "workflow", note: "An external change: tender, permit, fundraise, hazard." },
  task: { label: "Task", table: "tasks", group: "workflow", note: "Work for a person; AI never closes one on its own." },
  source: { label: "Source", table: "integrations registry + datasets", group: "evidence", note: "Provider, licence, coverage, evidence level." },
} as const satisfies Record<string, EntityDef>;

export type EntityType = keyof typeof ENTITIES;
export const ENTITY_TYPES = Object.keys(ENTITIES) as [EntityType, ...EntityType[]];
