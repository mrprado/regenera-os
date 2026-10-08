// Project partner scans (2026-10-08): from a project, find the capital and delivery partners it needs, using the one
// scan engine. A scan preset is derived from the project (partner type → audience; country or region; technology and
// asset terms; stage) and saved per project, so the run is reproducible and reviewable. Nothing is contacted; results
// are reviewed and qualified by a person, then appear on the project's Matches tab once roles are recorded.
import type { Db } from "@/db";
import type { projects } from "@/db/schema";
import { zScanConfig, type ScanConfig, type ScanSection } from "./config";
import { countriesIn, isGeoGroup, REGION_LABELS } from "./countries";
import { savePreset } from "./presets";

type Project = typeof projects.$inferSelect;

export const PARTNER_TYPES = {
  lenders: { label: "Project-finance lenders", group: "capital", audience: "banks_lenders", section: "capital", reach: "region", note: "Banks with project-finance or infrastructure-debt desks active where the project sits." },
  dfis: { label: "DFIs and multilateral banks", group: "capital", audience: "dfis_mdbs", section: "capital", reach: "global", note: "Development finance institutions; most invest across many countries, so the scan is worldwide and screened for the project's region." },
  infra_equity: { label: "Infrastructure equity (PE / funds)", group: "capital", audience: "private_equity", section: "capital", reach: "global", note: "Infrastructure and energy-transition equity investors." },
  funds: { label: "Real-asset funds and asset managers", group: "capital", audience: "funds_asset_managers", section: "capital", reach: "global", note: "Fund managers with real-asset or renewable strategies (including buyers of operating assets)." },
  family_offices: { label: "Family offices", group: "capital", audience: "family_offices", section: "capital", reach: "global", note: "Family offices with an evidenced energy or infrastructure strategy." },
  impact: { label: "Foundations and impact capital", group: "capital", audience: "foundations", section: "capital", reach: "global", note: "Programme- or mission-related investment in energy access, land, water or communities." },
  derisking: { label: "Insurers, guarantors and ECAs", group: "capital", audience: "insurers_guarantors", section: "capital", reach: "global", note: "Political-risk, credit-guarantee and export-credit providers that unlock senior debt." },
  epc: { label: "EPC and engineering contractors", group: "delivery", audience: "epc_engineering", section: "partners", reach: "region", note: "Contractors that can build this asset in this region." },
  oem: { label: "Equipment manufacturers and suppliers", group: "delivery", audience: "equipment_suppliers", section: "partners", reach: "global", note: "Modules, inverters, storage, trackers and grid equipment for the project's technology." },
  developers: { label: "Developers and IPPs (co-development or acquisition)", group: "delivery", audience: "renewable_developers", section: "partners", reach: "region", note: "Developers and independent power producers for co-development, partnership or project acquisition." },
  advisory: { label: "Legal and advisory partners", group: "delivery", audience: "legal_advisory_partners", section: "partners", reach: "country", note: "Law and advisory firms with energy, project-finance or permitting practices in the project's country." },
  offtakers: { label: "Industrial offtakers and energy users", group: "delivery", audience: "industrial_resource_clients", section: "partners", reach: "country", note: "Mines, manufacturers and large energy users that could contract the project's output." },
} as const;
export type PartnerType = keyof typeof PARTNER_TYPES;

/** The scan region for a project's country: the country itself, or its whole region, or worldwide. */
export function reachOf(country: string | null, reach: "country" | "region" | "global"): string[] {
  if (!country || reach === "global") return [];
  const c = country.toUpperCase();
  if (reach === "country") return [c];
  const group = (Object.keys(REGION_LABELS) as string[]).find(g => isGeoGroup(g) && countriesIn(g).includes(c));
  return group ? [group] : [c];
}

const TECH_TERMS: [RegExp, string[]][] = [[/solar|pv|photovolt/i, ["solar"]], [/storage|bess|battery/i, ["storage", "BESS"]], [/wind/i, ["wind"]], [/hydro/i, ["hydro"]], [/waste|wte/i, ["waste-to-energy"]], [/water/i, ["water"]], [/grid|transmission/i, ["transmission"]]];

/** Scan configuration derived from a project. Pure. */
export function projectScanConfig(p: Pick<Project, "country" | "technology" | "assetClass" | "capacity" | "capacityUnit" | "stage">, type: PartnerType): ScanConfig {
  const t = PARTNER_TYPES[type];
  const text = `${p.technology ?? ""} ${p.assetClass ?? ""}`;
  const terms = [...new Set(TECH_TERMS.filter(([re]) => re.test(text)).flatMap(([, v]) => v))];
  const capital = t.group === "capital";
  return zScanConfig.parse({
    mode: "organizations", audience: t.audience, geography: reachOf(p.country, t.reach), terms: capital ? [...terms, "infrastructure"].slice(0, 4) : terms,
    providers: type === "dfis" || type === "derisking" ? ["existing", "web", "gleif"] : ["existing", "web", "gleif", "apollo_orgs"],
    maxOrganizations: 40, requireReview: true,
    signalCriteria: `Fit for ${p.capacity ?? "?"} ${p.capacityUnit ?? ""} ${p.technology ?? p.assetClass ?? "project"} at ${p.stage.replace(/_/g, " ")} stage${p.country ? ` in ${p.country}` : ""}`.trim(),
    stages: [p.stage],
  });
}

export const projectPresetKey = (projectId: string, type: PartnerType) => `proj_${projectId.slice(0, 8)}_${type}`;

/** Saves (or refreshes) the project's preset for one partner type and returns its key for the scan launcher. */
export async function saveProjectScan(db: Db, project: Project, type: PartnerType, by: string) {
  const t = PARTNER_TYPES[type];
  const key = projectPresetKey(project.id, type);
  await savePreset(db, project.mandateId, { key, name: `${project.name}: ${t.label}`.slice(0, 120), section: t.section as ScanSection, note: `${t.note} Built from project ${project.name} (/projects/${project.id}).`, config: projectScanConfig(project, type) }, by);
  return key;
}
