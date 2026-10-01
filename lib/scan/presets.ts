// Built-in scan presets (phase 15 §6). Names describe a search, not a market fact: "Mexico solar EPC firms" means
// "screen for EPC firms in Mexico mentioning solar", and every result still needs evidence and human review.
// Saved workspace presets live in scan_presets; built-ins are code so every workspace gets the same definitions.
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { scanPresets } from "@/db/schema";
import { zScanConfig, type ScanConfig, type ScanSection } from "./config";

export type Preset = { key: string; name: string; section: ScanSection; note: string; config: ScanConfig; builtIn: boolean; id?: string };

const P = (key: string, name: string, section: ScanSection, note: string, cfg: Partial<ScanConfig> & { audience: string }): Preset =>
  ({ key, name, section, note, builtIn: true, config: zScanConfig.parse({ providers: ["existing", "web", "gleif", "apollo_orgs"], maxOrganizations: 50, ...cfg }) });

export const BUILT_IN_PRESETS: Preset[] = [
  P("mx_solar_epc", "Mexico solar EPC firms", "prospecting", "EPC and engineering firms registered or located in Mexico whose records mention solar.", { audience: "epc_engineering", geography: ["MEX"], terms: ["solar", "fotovoltaic", "photovoltaic"] }),
  P("us_epc_firms", "US EPC firms (solar and storage)", "prospecting", "EPCs and integrators in the United States; pairs with the EPC origination mandate.", { audience: "epc_engineering", geography: ["USA"], terms: ["solar", "storage", "BESS"] }),
  P("latam_renewable_developers", "LATAM renewable-energy developers", "prospecting", "Developers in Mexico, Central and South America.", { audience: "renewable_developers", geography: ["MEX", "central_america_caribbean", "south_america"] }),
  P("na_developers", "North American developers (energy)", "prospecting", "Renewable developers in the United States and Canada.", { audience: "renewable_developers", geography: ["USA", "CAN"] }),
  P("mx_real_estate_developers", "Mexico real-estate developers", "organizations", "Property developers and REITs in Mexico.", { audience: "real_estate_developers", geography: ["MEX"] }),
  P("infra_pe", "Infrastructure private-equity firms", "capital", "PE firms whose records mention infrastructure or energy transition.", { audience: "private_equity", terms: ["infrastructure", "energy transition"] }),
  P("real_asset_funds", "Real-asset and infrastructure funds", "capital", "Fund and asset managers with real-asset strategies.", { audience: "funds_asset_managers" }),
  P("family_offices", "Family offices (evidenced relevant strategy)", "capital", "Family offices; strategy is captured from sources, never inferred from the name.", { audience: "family_offices" }),
  P("lenders", "Project-finance banks and lenders", "capital", "Banks and institutional lenders with project-finance or infrastructure-debt activity.", { audience: "banks_lenders" }),
  P("dfis", "DFIs and multilateral development banks", "capital", "Development finance institutions.", { audience: "dfis_mdbs", providers: ["existing", "web", "gleif"] }),
  P("foundations", "Foundations (PRI / MRI)", "capital", "Foundations with programme- or mission-related investment.", { audience: "foundations" }),
  P("nature_capital_funds", "Nature-capital funds", "capital", "Funds in forestry, regenerative agriculture, water and biodiversity.", { audience: "natural_capital_funds" }),
  P("mx_referral_partners", "Mexico referral partners (legal and advisory)", "partners", "Law and advisory firms in Mexico with energy, real-estate or ESG practices.", { audience: "legal_advisory_partners", geography: ["MEX"] }),
  P("architects_planners", "Architects and planners", "partners", "Design and planning practices with masterplanning work.", { audience: "architects_planners" }),
];

export async function listPresets(db: Db, mandateId: string, section?: ScanSection): Promise<Preset[]> {
  const saved = await db.select().from(scanPresets).where(and(eq(scanPresets.mandateId, mandateId), isNull(scanPresets.archivedAt))).orderBy(asc(scanPresets.name));
  const custom: Preset[] = saved.map(s => ({ id: s.id, key: s.key, name: s.name, section: s.section as ScanSection, note: s.note, builtIn: false, config: zScanConfig.parse(s.config) }));
  const all = [...BUILT_IN_PRESETS, ...custom];
  return section ? all.filter(p => p.section === section || (section === "organizations" && p.section !== "partners")) : all;
}

export async function findPreset(db: Db, mandateId: string, key: string): Promise<Preset | null> {
  return (await listPresets(db, mandateId)).find(p => p.key === key) ?? null;
}

export async function savePreset(db: Db, mandateId: string, input: { key: string; name: string; section: ScanSection; note?: string; config: ScanConfig }, by: string) {
  const config = zScanConfig.parse(input.config);
  const [row] = await db.insert(scanPresets).values({ mandateId, key: input.key, name: input.name, section: input.section, audience: config.audience, note: input.note ?? "", config, createdBy: by })
    .onConflictDoUpdate({ target: [scanPresets.mandateId, scanPresets.key], set: { name: input.name, section: input.section, audience: config.audience, note: input.note ?? "", config, updatedAt: new Date().toISOString(), archivedAt: null } }).returning();
  return row;
}
