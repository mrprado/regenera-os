// Pinnable record types (phase 25). One line per type: the record page it opens and how to recognise that page.
// Kept free of database imports so the header (client) can match the current page.

export const PIN_TYPES = {
  project: { label: "Project", path: "projects", icon: "landmark" },
  deal: { label: "Deal", path: "deals", icon: "kanban" },
  funding_opportunity: { label: "Funding call", path: "funding", icon: "banknote" },
  funding_application: { label: "Funding application", path: "funding/applications", icon: "file" },
  analysis: { label: "Analysis", path: "workbench", icon: "radar" },
  scan_run: { label: "Scan", path: "scans", icon: "search" },
  objective: { label: "Objective", path: "objectives", icon: "target" },
  organization: { label: "Organization", path: "companies", icon: "building" },
  contact: { label: "Person", path: "people", icon: "user" },
  capital_profile: { label: "Capital partner", path: "capital/partners", icon: "banknote" },
  contract: { label: "Contract", path: "contracts", icon: "file" },
  commercial_mandate: { label: "Mandate", path: "mandates", icon: "target" },
  pursuit: { label: "Pursuit", path: "pursuits", icon: "target" },
  engagement: { label: "Engagement", path: "commercial/engagements", icon: "briefcase" },
} as const;
export type PinType = keyof typeof PIN_TYPES;
export const MAX_PINS = 6;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Longest paths first so /funding/applications/x is an application, not a funding call.
const MATCHERS = (Object.entries(PIN_TYPES) as [PinType, (typeof PIN_TYPES)[PinType]][])
  .sort((a, b) => b[1].path.length - a[1].path.length)
  .map(([type, t]) => ({ type, re: new RegExp(`^/${t.path}/(${UUID})(?:/)?$`, "i") }));

/** The record a page shows, when it is a pinnable record page (its own page, not a sub-page). */
export function pinTarget(pathname: string): { type: PinType; id: string } | null {
  for (const m of MATCHERS) { const hit = pathname.match(m.re); if (hit) return { type: m.type, id: hit[1].toLowerCase() }; }
  return null;
}
export const pinHref = (type: PinType, id: string) => `/${PIN_TYPES[type].path}/${id}`;
