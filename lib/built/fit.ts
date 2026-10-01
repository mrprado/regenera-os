// Project fit engine (built environment §8), pure. Site profile (climate, hazards, project type, stage) from the
// project record and its site-intelligence facts, then candidates filtered and explained. Output: a solution stack by
// category with reason, confidence, categorical impacts (cost, schedule, carbon, resilience), stage fit and providers.
// No 0–100 score is produced; an inferred site attribute says it was inferred.
import { CLIMATES, EFFECT, HAZARDS, type Climate, type Effect, type Hazard, type ProjectType, type StackCategory } from "./vocab";

export type SiteProfile = { climate: Climate | null; climateBasis: string; hazards: Hazard[]; hazardBasis: string[]; projectType: ProjectType | null; stage: string; country: string | null };

export function siteProfile(p: { lat: number | null; lng: number | null; assetClass: string | null; sector: string | null; stage: string; country: string | null; description?: string | null },
  facts: { label: string; value: string }[] = [], flags: string[] = []): SiteProfile {
  const precip = facts.find(f => /precip/i.test(f.label));
  const mmDay = precip ? Number(precip.value.match(/[\d.]+/)?.[0]) : null;
  const lat = p.lat, lng = p.lng;
  let climate: Climate | null = null, basis = "Not enough location data";
  if (lat !== null) {
    const a = Math.abs(lat);
    const wet = mmDay !== null ? mmDay >= 2.5 : null;
    climate = a <= 23.5 ? (wet === false ? "tropical_dry" : "tropical_humid") : a <= 35 ? (wet === false ? "arid" : "temperate") : a <= 55 ? "temperate" : "cold";
    basis = `Inferred from latitude ${lat.toFixed(1)}°${mmDay !== null ? ` and ${mmDay} mm/day precipitation (NASA POWER)` : ""}; verify with local climate data`;
  }
  const hazards: Hazard[] = [], hb: string[] = [];
  if (lat !== null && lng !== null && Math.abs(lat) >= 8 && Math.abs(lat) <= 30 && ((lng >= -100 && lng <= -55) || (lng >= 100 && lng <= 160) || (lng >= -160 && lng <= -100 && lat > 0))) { hazards.push("hurricane"); hb.push("Hurricane / cyclone belt (inferred from location)"); }
  if (flags.includes("climate_exposure")) { hazards.push("flood"); hb.push("Climate exposure flag from screening"); }
  if (facts.some(f => /earthquake/i.test(f.label) && Number(f.value.match(/\d+/)?.[0] ?? 0) >= 5)) { hazards.push("seismic"); hb.push("USGS seismic record near site"); }
  if (flags.includes("water_stress")) { hazards.push("drought"); hb.push("Water stress flag (WRI Aqueduct)"); }
  if (climate === "arid" || climate === "tropical_dry") { hazards.push("heat"); hb.push("Hot climate (inferred)"); }
  const ac = `${p.assetClass ?? ""} ${p.sector ?? ""} ${p.description ?? ""}`.toLowerCase();
  const projectType: ProjectType | null = /hotel|hospitality|resort|eco park|eco-park|tourism/.test(ac) ? "hospitality" : /mixed/.test(ac) ? "mixed_use" : /affordable/.test(ac) ? "affordable_housing" : /residential|housing/.test(ac) ? "residential"
    : /data.?cent/.test(ac) ? "data_center" : /industrial|factory|logistics/.test(ac) ? "industrial" : /commercial|office|retail/.test(ac) ? "commercial" : /solar|wind|hydro|bess|grid|water|infrastructure|transport/.test(ac) ? "infrastructure" : null;
  return { climate, climateBasis: basis, hazards: [...new Set(hazards)], hazardBasis: hb, projectType, stage: p.stage, country: p.country };
}

export type Candidate = {
  subjectType: "technology" | "material" | "system"; id: string; name: string; category: StackCategory; maturity: string; climates: string[]; hazards: string[]; buildingTypes: string[];
  stageFit: string[]; effects: Record<string, string>; providers: string[]; local?: boolean;
};

export type Recommendation = { subjectType: Candidate["subjectType"] | "strategy"; subjectId: string | null; category: StackCategory; label: string; reason: string; confidence: "high" | "moderate" | "low"; impacts: Record<"cost" | "schedule" | "carbon" | "resilience", Effect>; stageFit: string; providers: string[] };

const PROVEN = ["proven", "scaled"];
const eff = (v: string | undefined): Effect => (v && v in EFFECT ? (v as Effect) : "unknown");

export function evaluate(c: Candidate, s: SiteProfile): Recommendation | null {
  const why: string[] = [];
  let pts = 0;
  if (c.climates.length && s.climate) {
    if (!c.climates.includes(s.climate)) return null;
    why.push(`suited to ${CLIMATES[s.climate].toLowerCase()} climate`); pts++;
  }
  if (c.buildingTypes.length && s.projectType) {
    if (!c.buildingTypes.includes(s.projectType)) return null;
    why.push(`used in ${s.projectType.replace("_", " ")} projects`); pts++;
  }
  const hz = s.hazards.filter(h => c.hazards.includes(h));
  if (hz.length) { why.push(`rated for ${hz.map(h => HAZARDS[h].toLowerCase()).join(", ")}`); pts++; }
  if (PROVEN.includes(c.maturity)) { why.push(`${c.maturity} maturity`); pts++; } else why.push(`${c.maturity.replace("_", " ")} maturity: pilot risk`);
  if (c.local) { why.push("locally available"); pts++; }
  const stageOk = !c.stageFit.length || c.stageFit.includes(s.stage);
  const confidence = pts >= 3 && PROVEN.includes(c.maturity) ? "high" : pts >= 2 ? "moderate" : "low";
  return {
    subjectType: c.subjectType, subjectId: c.id, category: c.category, label: c.name, reason: why.join("; "), confidence,
    impacts: { cost: eff(c.effects.capex ?? c.effects.cost), schedule: eff(c.effects.speed), carbon: eff(c.effects.embodied ?? c.effects.carbon), resilience: hz.length ? "lower" : "unknown" },
    stageFit: stageOk ? (c.stageFit.length ? `fits ${s.stage}` : "any stage") : `usually from ${c.stageFit.join(", ")}`, providers: c.providers,
  };
}

/** Passive / bioclimatic strategies from climate and hazards (design category). */
export function designStrategies(s: SiteProfile): Recommendation[] {
  const base = (label: string, reason: string, carbon: Effect = "lower"): Recommendation => ({ subjectType: "strategy", subjectId: null, category: "design", label, reason, confidence: s.climate ? "moderate" : "low", impacts: { cost: "neutral", schedule: "neutral", carbon, resilience: "lower" }, stageFit: "concept and design", providers: [] });
  const out: Recommendation[] = [];
  if (s.climate === "tropical_humid") out.push(base("Cross-ventilation and elevated floors", "Humid heat: air movement and raised floors reduce cooling load and damp"), base("Deep shading and light roofs", "High solar gain"), base("Shaded courtyards", "Microclimate cooling; vernacular precedent (governed knowledge where community-held)"));
  if (s.climate === "arid" || s.climate === "tropical_dry") out.push(base("Thermal mass and night purging", "Large day-night temperature swing"), base("Compact massing, courtyards and small openings", "Solar control in hot dry climates"));
  if (s.climate === "temperate") out.push(base("Solar orientation and airtight envelope", "Heating and cooling seasons"));
  if (s.climate === "cold") out.push(base("Super-insulated envelope and heat recovery", "Heating-dominated climate"));
  if (s.hazards.includes("hurricane")) out.push({ ...base("Wind-rated envelope and roof tie-downs", "Hurricane exposure (inferred)", "neutral"), category: "resilience" });
  if (s.hazards.includes("flood")) out.push({ ...base("Raised finished floor levels and flood-resilient ground floor", "Flood exposure from screening", "neutral"), category: "resilience" });
  if (s.hazards.includes("drought")) out.push({ ...base("Water-sensitive site design", "Water stress (WRI Aqueduct)"), category: "water" });
  return out;
}

export function solutionStack(cands: Candidate[], s: SiteProfile, perCategory = 4) {
  const recs = [...designStrategies(s), ...cands.map(c => evaluate(c, s)).filter((x): x is Recommendation => !!x)];
  const order = { high: 0, moderate: 1, low: 2 };
  const by = new Map<StackCategory, Recommendation[]>();
  for (const r of recs.sort((a, b) => order[a.confidence] - order[b.confidence])) by.set(r.category, [...(by.get(r.category) ?? []), r]);
  return { site: s, stack: [...by.entries()].map(([category, list]) => ({ category, items: list.slice(0, perCategory) })) };
}

/** §23 A description may use a guarded word only with a supporting, non-"unverified" claim. */
export function guardedClaimIssues(text: string, claims: { claim: string; verification: string }[]) {
  const m = text.match(/\b(carbon[- ]negative|sustainable|regenerative|zero[- ]carbon|net[- ]zero|carbon[- ]neutral)\b/gi) ?? [];
  return [...new Set(m.map(w => w.toLowerCase()))].filter(w => !claims.some(c => c.verification !== "unverified" && c.claim.toLowerCase().includes(w.replace("-", " ").split(" ")[0])));
}
