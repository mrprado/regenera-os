// Objectives (extended specification §5): a specific outcome a party or Regenera wants. An objective turns into a scan
// whose criteria are copied from it (so the run stays reproducible if the objective changes later). Different kinds use
// different engines: finding contracts, projects or funding matches OPPORTUNITIES; finding partners, capital providers or
// clients discovers ORGANIZATIONS for an audience. Development options have no scan: they lead to a site brief.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { objectives, organizations, type ObjectiveKind } from "@/db/schema";
import { zScanConfig, type ScanConfig, type ScanSection } from "@/lib/scan/config";
import { audience } from "@/lib/scan/audiences";

type Objective = typeof objectives.$inferSelect;

const OPP: Partial<Record<ObjectiveKind, ScanConfig["providers"]>> = {
  find_contracts: ["web", "procurement", "network_projects", "queue_projects", "funding_calls"],
  find_projects: ["network_projects", "queue_projects", "web"],
  find_funding: ["funding_calls", "web"],
};
const ORG_AUDIENCE: Partial<Record<ObjectiveKind, string>> = { find_delivery_partners: "epc_engineering", find_capital: "funds_asset_managers" };
export const SECTION_FOR: Record<ObjectiveKind, ScanSection> = {
  find_contracts: "mandates", find_projects: "capital", find_funding: "funding", find_delivery_partners: "partners", find_capital: "capital",
  find_clients: "prospecting", referral: "partners", development_options: "projects",
};

/** The scan an objective runs, or the reason it cannot run one yet. */
export function scanConfigFor(o: Objective): { config: ScanConfig; label: string } | { blocked: string } {
  const kind = o.kind as ObjectiveKind;
  if (kind === "development_options") return { blocked: "Development options are assessed with a site brief and diagnostic, not a scan." };
  const common = { geography: o.geography, excludeTerms: o.exclusions, capabilities: o.capabilities, sizeMin: o.sizeMin, sizeMax: o.sizeMax, sizeUnit: o.sizeUnit, stages: o.stages, objectiveId: o.id, maxOrganizations: 60 };
  if (OPP[kind]) {
    if (!o.capabilities.length && kind === "find_contracts") return { blocked: "Record the capabilities (technologies and scope) before scanning for contracts." };
    return { config: zScanConfig.parse({ ...common, mode: "opportunities", audience: "objective", providers: OPP[kind] }), label: `Opportunities for: ${o.title}` };
  }
  const aud = o.targetAudience ?? ORG_AUDIENCE[kind];
  if (!aud || !audience(aud)) return { blocked: "Choose the audience to search for (for example EPC firms or family offices)." };
  return { config: zScanConfig.parse({ ...common, mode: "organizations", audience: aud, terms: o.capabilities, providers: ["existing", "web", "gleif", "apollo_orgs"] }), label: `${audience(aud)!.label} for: ${o.title}` };
}

export type ObjectiveInput = Omit<typeof objectives.$inferInsert, "id" | "mandateId" | "createdBy" | "createdAt" | "updatedAt">;

export async function saveObjective(db: Db, mandateId: string, input: ObjectiveInput, by: string, id?: string) {
  if (input.orgId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, input.orgId), eq(organizations.mandateId, mandateId)));
    if (!o) throw new Error("Organization not found in this workspace");
  }
  const t = new Date().toISOString();
  if (id) {
    const [row] = await db.update(objectives).set({ ...input, updatedAt: t }).where(and(eq(objectives.id, id), eq(objectives.mandateId, mandateId))).returning();
    if (!row) throw new Error("Objective not found");
    return row;
  }
  const [row] = await db.insert(objectives).values({ ...input, mandateId, createdBy: by, owner: input.owner ?? by }).returning();
  return row;
}
