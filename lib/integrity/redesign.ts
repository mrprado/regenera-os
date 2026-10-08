// Redesign engine v1 (phase 23): for each sector method, the options that usually reduce harm or add value, and three
// versioned scenarios (original · lower impact · regenerative). Differences are stated as directions with their basis
// (modelled only when a screening model exists; otherwise "assumption" or "unknown"). Applying needs approval.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { finModels, policyDecisions, projects, redesignScenarios } from "@/db/schema";
import { audit } from "@/lib/audit";

type Opt = { key: string; label: string; effect: string; tier: "lower_impact" | "regenerative" };
export const REDESIGN_OPTIONS: Record<string, Opt[]> = {
  renewable: [
    { key: "degraded_land", label: "Site on degraded or previously disturbed land", effect: "Avoids natural-habitat conversion; may change land cost and grid distance", tier: "lower_impact" },
    { key: "habitat_buffers", label: "Retain habitat patches and corridors; wildlife-permeable fencing", effect: "Less fragmentation; small loss of usable area", tier: "lower_impact" },
    { key: "water_efficient_om", label: "Dry or robotic module cleaning", effect: "Lower water withdrawal in water-stressed sites", tier: "lower_impact" },
    { key: "agrivoltaics", label: "Agrivoltaics (grazing or crops under elevated arrays)", effect: "Keeps agricultural use; higher structure cost, lower ground cover ratio", tier: "regenerative" },
    { key: "pollinator_soil", label: "Native pollinator vegetation and soil regeneration under arrays", effect: "Biodiversity and soil-carbon gains; vegetation management cost", tier: "regenerative" },
    { key: "community_benefit", label: "Community energy or benefit-sharing arrangement", effect: "Local value and social licence; reduces distributable cash", tier: "regenerative" },
  ],
  grid: [
    { key: "route_avoidance", label: "Route around sensitive habitat and settlements", effect: "Longer line or higher cost; lower impact and permitting risk", tier: "lower_impact" },
    { key: "existing_corridors", label: "Use existing linear corridors", effect: "Less new disturbance", tier: "lower_impact" },
    { key: "vegetation_management", label: "Habitat-compatible right-of-way management", effect: "Corridor habitat value", tier: "regenerative" },
  ],
  waste: [
    { key: "waste_hierarchy", label: "Upstream reduction and recycling before energy recovery", effect: "Smaller, better-sized plant; protects recycling", tier: "lower_impact" },
    { key: "feedstock_verification", label: "Independent feedstock characterisation and supply contracts", effect: "Bankability and emissions certainty", tier: "lower_impact" },
    { key: "emissions_controls", label: "Best-available emissions controls with continuous monitoring", effect: "Higher capex; permit compliance and community trust", tier: "lower_impact" },
    { key: "residue_reuse", label: "Residue / digestate beneficial reuse", effect: "Less landfill; product revenue if quality proven", tier: "regenerative" },
  ],
  water: [
    { key: "reuse", label: "Treated-water reuse", effect: "Lower abstraction; added treatment cost", tier: "lower_impact" },
    { key: "nbs_treatment", label: "Constructed wetlands / nature-based treatment where suitable", effect: "Lower energy use; land need", tier: "regenerative" },
  ],
  built: [
    { key: "watershed_protection", label: "Watershed and recharge protection, permeable surfaces", effect: "Lower flood and water risk", tier: "lower_impact" },
    { key: "water_demand", label: "Water-demand reduction and reuse", effect: "Lower dependency in stressed basins", tier: "lower_impact" },
    { key: "passive_design", label: "Passive design and on-site renewables", effect: "Lower operating energy; design cost", tier: "lower_impact" },
    { key: "corridors_materials", label: "Biodiversity corridors and local / low-carbon materials", effect: "Ecological and embodied-carbon gains", tier: "regenerative" },
    { key: "stewardship_governance", label: "Long-term land stewardship and community governance", effect: "Durable outcomes; governance cost", tier: "regenerative" },
  ],
  industrial: [
    { key: "clean_power", label: "Contracted additional clean power", effect: "Lower emissions; PPA cost", tier: "lower_impact" },
    { key: "water_free_cooling", label: "Low-water cooling", effect: "Lower water demand; energy trade-off", tier: "lower_impact" },
    { key: "heat_recovery", label: "Waste-heat recovery to local users", effect: "Efficiency and local value", tier: "regenerative" },
  ],
  nature: [
    { key: "baseline_mrv", label: "Measured baseline and monitoring plan", effect: "Verifiable outcomes", tier: "lower_impact" },
    { key: "community_tenure", label: "Community tenure and benefit-sharing", effect: "Permanence and legitimacy", tier: "regenerative" },
  ],
  hydro: [
    { key: "environmental_flow", label: "Environmental flow regime", effect: "Lower river impact; energy trade-off", tier: "lower_impact" },
    { key: "fish_passage", label: "Fish passage and sediment management", effect: "Connectivity", tier: "regenerative" },
  ],
  transition: [{ key: "remediation_plan", label: "Remediation with verified end-state", effect: "Liability reduction", tier: "lower_impact" }],
};

const DIMENSIONS = ["Capital expenditure", "Operating expenditure", "Revenue / output", "Land disturbance", "Water demand", "Emissions", "Ecological impact", "Community benefit", "Permitting complexity", "Long-term obligations"];

/** Pure: a comparison table for one variant. Without a screening model, financial lines are assumptions, never figures. */
export function compareVariant(variant: "original" | "lower_impact" | "regenerative", opts: Opt[], hasModel: boolean) {
  if (variant === "original") return DIMENSIONS.map(d => ({ dimension: d, change: "Baseline design", basis: "unknown" as const }));
  const regen = variant === "regenerative";
  return DIMENSIONS.map(d => {
    const fin = /expenditure|Revenue/.test(d);
    const change = d === "Capital expenditure" ? (regen ? "Likely higher (added measures)" : "Similar to slightly higher") : d === "Operating expenditure" ? "Similar; stewardship adds cost" : d === "Revenue / output" ? (opts.some(o => o.key === "agrivoltaics") ? "Possibly lower output per ha; added land revenue" : "Similar") :
      d === "Land disturbance" ? "Lower" : d === "Water demand" ? (opts.some(o => /water|reuse|cooling/.test(o.key)) ? "Lower" : "Similar") : d === "Emissions" ? (opts.some(o => /clean_power|emissions/.test(o.key)) ? "Lower" : "Similar") :
      d === "Ecological impact" ? (regen ? "Net improvement targeted (to be measured)" : "Lower") : d === "Community benefit" ? (opts.some(o => /community/.test(o.key)) ? "Higher" : "Similar") : d === "Permitting complexity" ? "Lower (fewer sensitive receptors)" : "Higher (monitoring, stewardship)";
    return { dimension: d, change, basis: fin && hasModel ? "modelled" as const : "assumption" as const };
  });
}

/** Creates the three scenarios as a new version (drafts). */
export async function generateScenarios(db: Db, projectId: string, actor: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const [d] = await db.select({ rules: policyDecisions.rules }).from(policyDecisions).where(and(eq(policyDecisions.projectId, projectId), eq(policyDecisions.current, true)));
  const method = d?.rules.find(r => r.rule === "sector_class")?.basis.match(/method "([a-z]+)"/)?.[1] ?? "renewable";
  const opts = REDESIGN_OPTIONS[method] ?? REDESIGN_OPTIONS.renewable;
  const [m] = await db.select({ id: finModels.id }).from(finModels).where(eq(finModels.projectId, projectId)).limit(1);
  const [last] = await db.select({ v: redesignScenarios.version }).from(redesignScenarios).where(eq(redesignScenarios.projectId, projectId)).orderBy(desc(redesignScenarios.version)).limit(1);
  const version = (last?.v ?? 0) + 1;
  const assumptions = ["Directions are qualitative unless a screening model exists for the project", "Costs and output changes need engineering and supplier quotes", "Ecological gains need a measured baseline and monitoring"];
  for (const variant of ["original", "lower_impact", "regenerative"] as const) {
    const chosen = variant === "original" ? [] : opts.filter(o => o.tier === "lower_impact" || variant === "regenerative");
    await db.insert(redesignScenarios).values({ mandateId: p.mandateId, projectId, version, variant, options: chosen.map(({ key, label, effect }) => ({ key, label, effect })), comparison: compareVariant(variant, chosen, !!m), assumptions, createdBy: actor });
  }
  await audit(db, { actor, action: "redesign.generate", entity: "project", entityId: projectId, after: { version, method } });
  return { version, method };
}

export async function decideScenario(db: Db, id: string, status: "approved" | "rejected" | "applied", by: string) {
  await db.update(redesignScenarios).set({ status, decidedBy: by }).where(eq(redesignScenarios.id, id));
  await audit(db, { actor: by, action: `redesign.${status}`, entity: "redesign_scenarios", entityId: id });
}
