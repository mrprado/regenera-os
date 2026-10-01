// Energy Access Explorer (WRI). Country datasets are published by national partners and viewed on the platform; no
// public query API is wired here, so the datasets are registered as "External source" with their links and the
// energy-access opportunity uses World Bank country indicators plus Regenera's own site facts. When a documented API
// or a partner export is available, add the adapter here and set the dataset's `adapter` in the catalogue.
export const EAE_URL = "https://www.energyaccessexplorer.org";
export const EAE_STATUS = "external" as const;

export type EnergyAccessInputs = { accessPct: number | null; ruralAccessPct: number | null; population: string | null; gridKm: number | null; health: number | null; schools: number | null; ghi: string | null };

/** §6 Structured energy-access opportunity. Values stay "Not available" when no source supplied them. */
export function energyAccessOpportunity(project: string, x: EnergyAccessInputs) {
  const na = "Not available";
  const gridGap = x.gridKm !== null && x.gridKm > 10;
  const lowAccess = x.accessPct !== null && x.accessPct < 80;
  const narrative = [
    lowAccess ? `National electricity access is ${x.accessPct}%${x.ruralAccessPct !== null ? ` (rural ${x.ruralAccessPct}%)` : ""}.` : x.accessPct !== null ? `National electricity access is ${x.accessPct}%.` : null,
    gridGap ? `The nearest mapped transmission line is about ${x.gridKm} km away, which points to distributed or mini-grid options.` : null,
    x.ghi ? `Solar resource: ${x.ghi}.` : null,
    "Country-level indicators do not describe the site: confirm local connection status, demand and willingness to pay on the ground.",
  ].filter(Boolean).join(" ");
  return {
    project, grid: x.gridKm === null ? na : gridGap ? `No transmission mapped within ${x.gridKm} km` : `Transmission ≈ ${x.gridKm} km`,
    population: x.population ?? na, socialInfrastructure: x.health === null && x.schools === null ? na : `${x.health ?? "?"} health facilities, ${x.schools ?? "?"} schools mapped nearby`,
    productiveUse: na, energyResource: x.ghi ?? na, opportunity: lowAccess || gridGap ? "Potential energy-access opportunity" : "No energy-access signal from available data", narrative,
  };
}
