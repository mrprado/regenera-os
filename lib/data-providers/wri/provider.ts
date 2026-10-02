// World Resources Institute as a Tier 1 institutional data provider. Platform adapters live beside this file:
// aqueduct.ts and resource-watch.ts (public API), global-forest-watch.ts (Data API, free key GFW_API_KEY),
// land-carbon-lab.ts (served by the GFW Data API or downloads), energy-access-explorer.ts (external platform).
// Credentials: GFW_API_KEY only. Resource Watch and Aqueduct via Resource Watch need no key. RESOURCE_WATCH_API_KEY
// and WRI_API_KEY are not required by any adapter today and are not read.
export const WRI_ENV = { GFW_API_KEY: "Global Forest Watch Data API (free registration). Server-side only." } as const;
export const WRI_ATTRIBUTION = "Data: World Resources Institute (Aqueduct, Global Forest Watch, Resource Watch, Land & Carbon Lab, Energy Access Explorer), CC BY 4.0 unless the dataset states otherwise.";
