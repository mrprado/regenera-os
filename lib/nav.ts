// Navigation map (docs/plans/phase-10-client-os.md §3). One definition feeds the sidebar, the Systems flyout, the
// menu search and Cmd+K, and tests/unit/nav-inventory.test.ts checks that every page route is reachable from it.
// URLs never change here: consolidation is visual only, so bookmarks and deep links keep working.
import { pathAllowed } from "@/lib/tenancy/vocab";

export type NavLeaf = { label: string; href: string; keywords?: string };
export type NavSection = { label?: string; items: NavLeaf[] };
export type NavGroup = { key: string; label: string; icon: string; href?: string; sections: NavSection[]; internal?: boolean; mega?: boolean };

export const NAV: NavGroup[] = [
  { key: "command", label: "Command", icon: "house", href: "/today", sections: [] },
  { key: "atlas", label: "Atlas", icon: "earth", href: "/map", sections: [] },
  {
    key: "mandates", label: "Mandates", icon: "target", sections: [{ items: [
      { label: "Live mandates", href: "/mandates", keywords: "mandate portfolio origination epc capital funding offtake land delivery floor" },
      { label: "New mandate", href: "/mandates?new=epc_origination", keywords: "create mandate builder" },
      { label: "Pursuits", href: "/pursuits", keywords: "epc pursuit rfp rfq bid bafo award capital raise" },
      { label: "Pursuit board", href: "/pursuits?view=board&type=epc", keywords: "kanban" },
      { label: "Approvals", href: "/approvals", keywords: "approve outreach introduction nda bid term sheet decision gate" },
      { label: "Desks & economics", href: "/mandates/desks", keywords: "desk p&l mrr arr margin capacity staffing seats" },
    ] }],
  },
  {
    key: "projects", label: "Projects", icon: "landmark", sections: [{ items: [
      { label: "All projects", href: "/projects" },
      { label: "Pipeline board", href: "/projects?view=board", keywords: "stages kanban" },
      { label: "Opportunities & screening", href: "/projects?stage=opportunity" },
      { label: "Active development", href: "/projects?stage=development" },
      { label: "Construction", href: "/projects?stage=construction" },
      { label: "Operating assets", href: "/projects?stage=operations" },
      { label: "Seeking capital", href: "/projects?capital=1" },
      { label: "Blocked", href: "/projects?blocked=1", keywords: "constraints issues" },
      { label: "Land pipeline", href: "/land", keywords: "acquisition parcels land candidates" },
      { label: "Community & rights", href: "/community", keywords: "fpic consent knowledge tek" },
    ] }],
  },
  {
    key: "systems", label: "Systems", icon: "sprout", mega: true, sections: [
      { label: "Land systems", items: [{ label: "Land pipeline", href: "/land", keywords: "acquisition" }, { label: "Land & agriculture capacity", href: "/systems", keywords: "soils water agriculture forestry agroforestry" }] },
      { label: "Built environment", items: [{ label: "Built environment intelligence", href: "/intelligence/built?tab=fit", keywords: "construction materials technologies solution stack" }, { label: "Settlement & community systems", href: "/systems", keywords: "housing hospitality masterplan" }] },
      { label: "Energy", items: [{ label: "Power & large loads", href: "/power", keywords: "solar wind bess grid ppa interconnection data centers" }, { label: "Tech & cost benchmarks", href: "/benchmarks", keywords: "capex lcoe" }] },
      { label: "Infrastructure & connectivity", items: [{ label: "Large loads & grid", href: "/power", keywords: "transmission substations data centers" }, { label: "Infrastructure capacity", href: "/systems", keywords: "water roads logistics" }] },
      { label: "Nature", items: [{ label: "Community & rights", href: "/community", keywords: "biodiversity restoration" }, { label: "Nature & capital transition", href: "/capital/alignment", keywords: "natural capital carbon" }, { label: "System capacity & interventions", href: "/systems" }] },
    ],
  },
  {
    key: "capital", label: "Capital", icon: "banknote", sections: [{ items: [
      { label: "Capital partners", href: "/capital", keywords: "investors mandates lps funds" },
      { label: "Private investors", href: "/capital?tab=private" },
      { label: "Capital opportunities", href: "/capital?tab=opportunities", keywords: "capital match readiness" },
      { label: "Introductions", href: "/capital?tab=introductions" },
      { label: "Bonds & notes", href: "/capital?tab=bonds", keywords: "debt" },
      { label: "Capital structures", href: "/capital/structures", keywords: "stack spv blended" },
      { label: "Funding pathways", href: "/capital/funding-pathways" },
      { label: "Capital alignment", href: "/capital/alignment", keywords: "nature transition 30:1" },
    ] }, { label: "Funding", items: [
      { label: "Funding opportunities", href: "/funding", keywords: "grants tenders calls public blended finance incentives" },
      { label: "Funding calendar", href: "/funding?tab=calendar", keywords: "deadlines" },
      { label: "Bids & applications", href: "/funding?tab=bids", keywords: "proposal application workspace" },
      { label: "Applicants", href: "/funding?tab=applicants", keywords: "prospects origination eligibility" },
      { label: "Funding origination", href: "/funding?tab=origination", keywords: "funnel funding-originated revenue" },
      { label: "Awards & post-award", href: "/funding?tab=awards", keywords: "award reporting milestones" },
      { label: "Funders", href: "/funding?tab=funders" },
      { label: "Bid library", href: "/funding?tab=library", keywords: "boilerplate narratives" },
      { label: "Funding practice economics", href: "/funding/economics", keywords: "scenario margin staffing" },
    ] }],
  },
  {
    key: "deals", label: "Deals", icon: "kanban", sections: [{ items: [
      { label: "All deals", href: "/deals", keywords: "opportunities pipeline" },
      { label: "Deal table", href: "/deals?view=table" },
      { label: "Capital mandates", href: "/deals?path=capital_mandate" },
      { label: "Project diagnostics", href: "/deals?path=project_diagnostic" },
      { label: "Contracts & term sheets", href: "/contracts", keywords: "nda agreements" },
      { label: "Data rooms", href: "/portals?tab=rooms", keywords: "portal nda" },
      { label: "Introducers & fees", href: "/portals?tab=brokers", keywords: "brokers referrals" },
    ] }],
  },
  {
    key: "relationships", label: "Relationships", icon: "network", sections: [{ items: [
      { label: "People", href: "/people", keywords: "contacts" },
      { label: "Organizations", href: "/companies", keywords: "companies" },
      { label: "Partner network", href: "/partners" },
      { label: "Ecosystem network", href: "/network", keywords: "epc suppliers operators epd" },
      { label: "Specialists", href: "/specialists", keywords: "bench sme experts rates" },
      { label: "Relationship graph", href: "/relationships" },
      { label: "Lists", href: "/lists" },
      { label: "Prospecting", href: "/prospecting", keywords: "apollo search" },
      { label: "Saved searches", href: "/searches" },
      { label: "Sequences", href: "/sequences", keywords: "outreach" },
      { label: "Approval queue", href: "/queue", keywords: "drafts" },
      { label: "Inbox", href: "/inbox", keywords: "replies" },
    ] }],
  },
  {
    key: "intelligence", label: "Intelligence", icon: "radar", sections: [{ items: [
      { label: "Analyst workbench", href: "/workbench", keywords: "analysis issue tree evidence memo ic diligence research question" },
      { label: "Signals & triggers", href: "/triggers", keywords: "intelligence" },
      { label: "All current signals", href: "/triggers?tab=signals" },
      { label: "Watch & theses", href: "/intelligence", keywords: "watchlists" },
      { label: "Built environment", href: "/intelligence/built", keywords: "construction materials modular mass timber low carbon concrete suppliers proptech market map procurement rfp" },
      { label: "Email intelligence", href: "/intelligence/mail", keywords: "gmail inbox correspondence threads commitments introductions relationship history" },
      { label: "Data catalogue", href: "/intelligence/data", keywords: "wri aqueduct global forest watch resource watch datasets providers provenance licence" },
      { label: "Tech & cost benchmarks", href: "/benchmarks", keywords: "comps" },
      { label: "Reports & forecast", href: "/reports", keywords: "metrics weekly" },
      { label: "Lessons & case records", href: "/reports?tab=cases", keywords: "learning" },
    ] }],
  },
  {
    key: "clients", label: "Clients", icon: "briefcase", internal: true, sections: [{ items: [
      { label: "Accounts", href: "/clients", keywords: "tenants client health organizations" },
      { label: "Commercial overview", href: "/commercial", keywords: "arr mrr pipeline revenue" },
      { label: "Engagements", href: "/commercial?tab=engagements", keywords: "mandates workstreams deliverables" },
      { label: "Services & pricing", href: "/commercial?tab=services", keywords: "catalog" },
      { label: "Billing", href: "/commercial?tab=billing", keywords: "invoices" },
      { label: "Partners & vendors", href: "/commercial?tab=partners" },
      { label: "Accounts & tools", href: "/commercial?tab=accounts" },
      { label: "Corporate entities", href: "/commercial?tab=entities" },
      { label: "Portal users", href: "/portals?tab=users" },
    ] }],
  },
  {
    key: "operations", label: "Operations", icon: "check", sections: [{ items: [
      { label: "Actions & tasks", href: "/tasks" },
      { label: "Capacity", href: "/capacity", keywords: "utilization allocation team cost rates hiring" },
      { label: "Playbooks", href: "/playbooks", keywords: "workflows" },
      { label: "Documents", href: "/documents" },
      { label: "Document generator", href: "/documents/generator" },
      { label: "Contracts", href: "/contracts" },
      { label: "Reports", href: "/reports" },
      { label: "Notifications", href: "/notifications", keywords: "alerts" },
      { label: "Portal requests & updates", href: "/portals?tab=requests" },
    ] }],
  },
];

export const SETTINGS_NAV: NavLeaf[] = [
  { label: "Organization", href: "/org", keywords: "users teams roles modules security branding api" },
  { label: "Connections", href: "/settings/connections" },
  { label: "Integrations", href: "/settings/integrations", keywords: "data sources health" },
  { label: "Data providers", href: "/intelligence/data?tab=health", keywords: "api health sync failures licence review" },
  { label: "Sending", href: "/settings/sending" },
  { label: "Workspaces", href: "/settings/mandates", keywords: "entities mandates" },
  { label: "Members", href: "/settings/members" },
  { label: "Jobs", href: "/settings/jobs" },
  { label: "Claude", href: "/settings/claude", keywords: "prompts ai" },
  { label: "Extension", href: "/settings/extension" },
  { label: "Demo data", href: "/settings/demo" },
  { label: "Product governance", href: "/settings/product", keywords: "backlog technical debt product debt requests roadmap" },
  { label: "API & MCP", href: "/connect/mcp", keywords: "tokens" },
];

export type NavUser = { modules?: readonly string[] | "all"; internal: boolean };

/** The navigation this user may use: modules they are entitled to; Regenera-internal groups only for staff. */
export function navFor(u: NavUser): NavGroup[] {
  return NAV.filter(g => !g.internal || u.internal).map(g => ({
    ...g,
    sections: g.sections.map(s => ({ ...s, items: s.items.filter(i => pathAllowed(u.modules, i.href)) })).filter(s => s.items.length),
  })).filter(g => (g.href ? pathAllowed(u.modules, g.href) : g.sections.length > 0));
}

export const settingsFor = (u: NavUser) => (u.internal ? SETTINGS_NAV : SETTINGS_NAV.filter(i => i.href === "/org" || (i.href === "/connect/mcp" && pathAllowed(u.modules, i.href))));

/** Flat list for menu search and Cmd+K: "Systems › Energy › Power & large loads". */
export function flatNav(u: NavUser) {
  const out: { label: string; path: string; href: string; keywords: string }[] = [];
  for (const g of navFor(u)) {
    if (g.href) out.push({ label: g.label, path: g.label, href: g.href, keywords: "" });
    for (const s of g.sections) for (const i of s.items) out.push({ label: i.label, path: [g.label, s.label, i.label].filter(Boolean).join(" › "), href: i.href, keywords: i.keywords ?? "" });
  }
  for (const i of settingsFor(u)) out.push({ label: i.label, path: `Settings › ${i.label}`, href: i.href, keywords: i.keywords ?? "" });
  return out;
}
