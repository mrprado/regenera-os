// Atlas work objectives. An objective SUGGESTS evidence layers, record types and a basemap and links the existing workflows;
// it never changes business classifications, creates or edits records, or runs a consequential action. Suggested layers are
// added only when the person applies them, on top of anything they enabled themselves.
export type Objective = {
  id: string; label: string; base?: string; layers: string[]; records: string[];
  note: string; actions: { label: string; href: string }[];
};

export const OBJECTIVES: Objective[] = [
  { id: "portfolio", label: "Review portfolio", base: "light", layers: [], records: ["projects", "deals", "organizations"],
    note: "Projects, opportunities and partners by recorded stage.", actions: [{ label: "Projects", href: "/projects" }, { label: "Reporting", href: "/reports" }] },
  { id: "originate", label: "Originate opportunities", layers: [], records: ["triggers", "procurement", "deals", "projects"],
    note: "Signals, funding calls and candidate projects. New opportunities are created only after a person reviews them.", actions: [{ label: "Scans & missions", href: "/scans" }, { label: "Funding", href: "/funding" }] },
  { id: "site", label: "Assess a site", base: "esri", layers: ["power", "protected", "ndvi", "fires"], records: ["projects"],
    note: "Select a project or draw a boundary, then open Site diligence for the workbench.", actions: [] },
  { id: "rights", label: "Secure land & rights", base: "esri", layers: ["protected", "forest_loss"], records: ["projects"],
    note: "Map features never establish legal rights or tenure; record rights evidence on the project.", actions: [] },
  { id: "develop", label: "Develop a project", layers: ["power", "buildings"], records: ["projects"],
    note: "Milestones, permits, grid and offtake evidence live on the project plan.", actions: [{ label: "Projects", href: "/projects" }] },
  { id: "grid", label: "Power grid & connections", base: "light", layers: ["power"], records: ["projects", "organizations"],
    note: "Grid proximity does not establish available connection capacity, queue position, rights or transferability.", actions: [] },
  { id: "capital", label: "Structure capital", layers: [], records: ["projects", "deals", "procurement"],
    note: "Capital readiness, requirements and raises are in the Capital workspace.", actions: [{ label: "Capital", href: "/capital" }, { label: "Funding", href: "/funding" }] },
  { id: "partners", label: "Find partners", layers: [], records: ["projects", "organizations"],
    note: "Organizations shown at their recorded office, not at project sites. Follow-ups are proposed for approval.", actions: [{ label: "Organizations", href: "/companies" }, { label: "Network", href: "/network" }] },
  { id: "risk", label: "Monitor project risk", layers: ["quakes", "fires", "events", "cyclones"], records: ["projects"],
    note: "Hazard feeds are context, not a complete risk assessment; an unavailable feed is not an absence of risk.", actions: [] },
  { id: "outcomes", label: "Review outcomes", layers: [], records: ["projects"],
    note: "Milestones, value created and outcomes with their evidence and attribution are on each project and in reporting.", actions: [{ label: "Reporting", href: "/reports" }] },
];

export const objectiveById = (id: string) => OBJECTIVES.find(o => o.id === id) ?? OBJECTIVES[0];

/** What applying an objective would change: layers it adds (never removes), layers the catalogue does not offer. */
export function suggestion(o: Objective, available: Set<string>, enabled: Set<string>) {
  return {
    add: o.layers.filter(l => available.has(l) && !enabled.has(l)),
    already: o.layers.filter(l => enabled.has(l)),
    unavailable: o.layers.filter(l => !available.has(l)),
    base: o.base && available.has(o.base) ? o.base : null,
  };
}
