// Client operating layer vocabulary (docs/plans/phase-10-client-os.md). A tenant is a client organization (or
// Regenera itself); it owns one or more workspaces (the `mandates` table), which remain the data-isolation boundary.

export const REGENERA_TENANT_ID = "tenant_regenera";

export const ORG_TYPES = {
  regenera: "Regenera", family_office: "Family office", fund: "Fund", investment_manager: "Investment manager", infrastructure_investor: "Infrastructure investor",
  institutional_owner: "Institutional asset owner", developer: "Developer", real_estate_developer: "Real estate developer", master_developer: "Master developer",
  renewable_developer: "Renewable-energy developer", project_sponsor: "Project sponsor", epc: "EPC", operator: "Operator", agricultural_operator: "Agricultural operator",
  farmland_fund: "Farmland fund", natural_capital_fund: "Natural-capital fund", conservation_org: "Conservation organization", municipality: "Municipality",
  investor: "Investor", bank: "Bank", consultant: "Consultant", advisory_client: "Advisory client", ngo: "NGO", university: "University",
  government_agency: "Government agency", utility: "Utility", landowner: "Landowner", community_org: "Community organization",
} as const;
export type OrgType = keyof typeof ORG_TYPES;

export const TENANT_STATUSES = { prospect: "Prospect", onboarding: "Onboarding", active: "Active", suspended: "Suspended", offboarding: "Offboarding", offboarded: "Offboarded" } as const;
export const SUPPORT_TIERS = { standard: "Standard", priority: "Priority", enterprise: "Enterprise" } as const;
/** Response / resolution targets in business hours per tier and priority (configurable per tenant later; shown with the tier). */
export const SLA_HOURS: Record<keyof typeof SUPPORT_TIERS, Record<"critical" | "high" | "normal" | "low", { respond: number; resolve: number }>> = {
  standard: { critical: { respond: 8, resolve: 40 }, high: { respond: 16, resolve: 80 }, normal: { respond: 24, resolve: 120 }, low: { respond: 40, resolve: 200 } },
  priority: { critical: { respond: 2, resolve: 16 }, high: { respond: 4, resolve: 40 }, normal: { respond: 8, resolve: 80 }, low: { respond: 24, resolve: 120 } },
  enterprise: { critical: { respond: 1, resolve: 8 }, high: { respond: 2, resolve: 24 }, normal: { respond: 4, resolve: 40 }, low: { respond: 8, resolve: 80 } },
};

export const UNIT_KINDS = {
  investment_company: "Investment company", fund: "Fund", holdco: "HoldCo", spv: "SPV", asset: "Asset", business_unit: "Business unit", subsidiary: "Subsidiary",
  division: "Regional division", project_company: "Project company", department: "Department", portfolio: "Portfolio", controlled_entity: "Controlled entity",
} as const;

/**
 * User types. OS users sign in to the operating environment; external people never do: they use the portal surface
 * (own table, own sessions, explicit grants), so the two permission models are never mixed.
 */
export const USER_TYPES = {
  regenera_internal: { label: "Regenera internal", surface: "os", note: "Operates across the client workspaces they are granted." },
  client_admin: { label: "Client admin", surface: "os", note: "Manages their organization: users, teams, modules within the entitlement, profile." },
  client_user: { label: "Client user", surface: "os", note: "Uses the modules their organization licenses." },
  read_only: { label: "Read only", surface: "os", note: "Views; every change is refused server-side." },
  external_collaborator: { label: "External collaborator", surface: "portal", note: "Portal: assigned projects, documents and requests only." },
  investor: { label: "Investor portal user", surface: "portal", note: "Portal: approved opportunities and data rooms only." },
  broker: { label: "Broker / introducer", surface: "portal", note: "Portal: registered introductions and attribution only." },
  technical_partner: { label: "Technical partner", surface: "portal", note: "Portal: assigned studies, tasks and files." },
} as const;
export type UserType = keyof typeof USER_TYPES;
export const OS_USER_TYPES = ["regenera_internal", "client_admin", "client_user", "read_only"] as const;
export type OsUserType = (typeof OS_USER_TYPES)[number];
/** Portal kind used for each external user type (lib/portal/vocab.ts PORTAL_KINDS). */
export const PORTAL_KIND_FOR: Record<Exclude<UserType, OsUserType>, string> = { external_collaborator: "partner", investor: "capital", broker: "broker", technical_partner: "partner" };
const RANK: Record<OsUserType, number> = { regenera_internal: 4, client_admin: 3, client_user: 2, read_only: 1 };
export const strongest = (types: OsUserType[]): OsUserType | undefined => types.sort((a, b) => RANK[b] - RANK[a])[0];

export const PERSONAS = {
  general: "General", executive: "Executive", investment_committee: "Investment committee", development: "Development manager", analyst: "Analyst",
  asset_manager: "Asset manager", legal: "Legal", capital: "Capital team",
} as const;
export type Persona = keyof typeof PERSONAS;

export const TEAM_KINDS = {
  executive: "Executive", investment_committee: "Investment Committee", development: "Development", capital: "Capital", acquisitions: "Acquisitions", technical: "Technical",
  legal: "Legal", finance: "Finance", sustainability: "Sustainability", asset_management: "Asset Management", operations: "Operations", other: "Other",
} as const;

/** Licensable modules. `clients` is Regenera-internal and can never be entitled to a client. */
export const MODULES = {
  command: "Command", atlas: "Atlas", projects: "Projects", land: "Land systems", built: "Built environment", energy: "Energy", infrastructure: "Infrastructure & connectivity",
  nature: "Nature", capital: "Capital", markets: "Markets", network: "Relationships", deals: "Deals", intelligence: "Intelligence", documents: "Documents",
  automations: "Automations", reporting: "Reporting", api: "API access", clients: "Clients (Regenera internal)",
} as const;
export type ModuleKey = keyof typeof MODULES;
export const CLIENT_MODULES = (Object.keys(MODULES) as ModuleKey[]).filter(m => m !== "clients");

/** Plan templates. Contracts can deviate: entitlements are rows per tenant, and `custom` starts empty. */
export const PLANS: Record<"core" | "professional" | "enterprise" | "custom", { label: string; modules: ModuleKey[] }> = {
  core: { label: "Core", modules: ["command", "atlas", "projects", "documents", "reporting", "automations"] },
  professional: { label: "Professional", modules: ["command", "atlas", "projects", "documents", "reporting", "automations", "capital", "deals", "network", "intelligence", "land", "energy", "nature"] },
  enterprise: { label: "Enterprise", modules: CLIENT_MODULES },
  custom: { label: "Custom (contract-defined)", modules: [] },
};
export type PlanKey = keyof typeof PLANS;

/** Route prefix → module. Longest prefix wins; routes not listed (org admin, help, support) need no module.
 *  `clients` doubles as the Regenera-internal gate: platform administration (settings) is never a client module. */
export const ROUTE_MODULES: [string, ModuleKey][] = [
  ["/settings", "clients"],
  ["/today", "command"], ["/notifications", "command"],
  ["/map", "atlas"],
  ["/projects", "projects"], ["/systems", "projects"], ["/community", "projects"],
  ["/land", "land"], ["/power", "energy"], ["/assets", "projects"],
  ["/capital", "capital"], ["/funding", "capital"],
  ["/benchmarks", "markets"],
  ["/people", "network"], ["/companies", "network"], ["/partners", "network"], ["/relationships", "network"], ["/network", "network"], ["/lists", "network"],
  ["/prospecting", "network"], ["/scans", "network"], ["/objectives", "network"], ["/sequences", "network"], ["/queue", "network"], ["/inbox", "network"], ["/searches", "network"],
  ["/deals", "deals"], ["/contracts", "deals"], ["/mandates", "deals"], ["/pursuits", "deals"], ["/approvals", "deals"],
  ["/triggers", "intelligence"], ["/intelligence", "intelligence"], ["/workbench", "intelligence"], ["/knowledge", "intelligence"],
  ["/documents", "documents"], ["/tasks", "automations"], ["/playbooks", "automations"], ["/workflows", "automations"], ["/meetings", "automations"],
  ["/reports", "reporting"],
  ["/commercial", "clients"], ["/clients", "clients"], ["/portals", "deals"], ["/capacity", "clients"], ["/specialists", "clients"],
  ["/connect/mcp", "api"],
  // Landing pages (phase 15 §5): each needs its group's main module; Operations mixes modules and filters inside.
  ["/overview/mandates", "deals"], ["/overview/projects", "projects"], ["/overview/systems", "projects"], ["/overview/capital", "capital"],
  ["/overview/deals", "deals"], ["/overview/relationships", "network"], ["/overview/intelligence", "intelligence"], ["/overview/clients", "clients"],
];

export function moduleForPath(path: string): ModuleKey | null {
  const p = path.split("?")[0];
  let best: [string, ModuleKey] | null = null;
  for (const r of ROUTE_MODULES) if ((p === r[0] || p.startsWith(`${r[0]}/`)) && (!best || r[0].length > best[0].length)) best = r;
  return best?.[1] ?? null;
}

export const ONBOARDING_STEPS = {
  organization: { label: "Organization", items: ["Identity", "Structure", "Branding"] },
  users: { label: "Users", items: ["Invite team", "Assign roles"] },
  workspace: { label: "Workspace", items: ["Modules", "Units, currency, timezone", "Reporting"] },
  data: { label: "Data", items: ["Projects", "Contacts", "Assets", "GIS", "Documents", "Financial data"] },
  integrations: { label: "Integrations", items: ["Email", "Calendar", "Drive", "CRM / ERP / accounting", "GIS / data providers"] },
  workflows: { label: "Workflows", items: ["Project stages", "Approvals", "Risk taxonomy", "Investment process", "Reporting"] },
  go_live: { label: "Go live", items: ["Confirm permissions", "Validate imports", "Training", "Launch"] },
} as const;
export type OnboardingStep = keyof typeof ONBOARDING_STEPS;

export const OFFBOARDING_STEPS = {
  termination: "Identify termination date", freeze: "Freeze new access where needed", export: "Export client data", support: "Close support items",
  transfer: "Transfer ownership", integrations: "Revoke integrations", deactivate: "Deactivate accounts", archive: "Archive records",
  retention: "Retention / deletion actions (per configured policy only)", final_report: "Final report",
} as const;

export const UNIT_SYSTEMS = { metric: "Metric (ha, m², km, t)", imperial: "Imperial (acres, sq ft, miles, short tons)" } as const;
export const LANGUAGES = { en: "English", es: "Español", pt: "Português", fr: "Français" } as const;
export const ORG_INVITE_FLASH = "os_invite_flash";

export function hasModule(modules: readonly string[] | "all" | undefined, m: ModuleKey | null) {
  if (!m) return true;
  if (modules === undefined || modules === "all") return true;
  return modules.includes(m);
}

/** Pure (no database): used by server guards and by the client-side navigation alike. */
export const pathAllowed = (modules: readonly string[] | "all" | undefined, path: string) => hasModule(modules, moduleForPath(path));
