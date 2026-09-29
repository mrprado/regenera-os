// Power stack engine: PPA bankability by independent dimension (never one score), revenue stack (contracted vs merchant,
// counterparty concentration, tenor), storage LCOS, power-to-load matching in both directions with explained
// dimensions, and screening power-supply strategies for a large load. Estimates are labelled; nothing is invented.
import type { gridConnections, largeLoads, ppas, revenueStreams, storageSpecs } from "@/db/schema";
import { PROCUREMENT, type Bankability } from "./vocab";

type Ppa = typeof ppas.$inferSelect;
type Stream = typeof revenueStreams.$inferSelect;
type Storage = typeof storageSpecs.$inferSelect;
type Load = typeof largeLoads.$inferSelect;
type Grid = typeof gridConnections.$inferSelect;

export type Dimension = { dimension: string; result: Bankability; why: string };
const IG = /^(AAA|AA[+-]?|A[+-]?|BBB[+-]?|Aaa|Aa[123]|A[123]|Baa[123])$/;
const SUB_IG = /^(BB[+-]?|B[+-]?|CCC[+-]?|CC|C|D|Ba[123]|B[123]|Caa[123]|Ca)$/;

export function ppaBankability(p: Ppa, ctx: { projectCurrency?: string | null; debtCurrency?: string | null; debtTenorYears?: number | null; breakevenPrice?: number | null } = {}): Dimension[] {
  const out: Dimension[] = [];
  const add = (dimension: string, result: Bankability, why: string) => out.push({ dimension, result, why });
  const rating = (p.credit.rating ?? "").trim();
  const support = !!(p.credit.guarantee?.trim() || p.credit.lc?.trim() || p.credit.deposit?.trim());
  if (!rating) add("Counterparty strength", support ? "conditional" : "unknown", support ? "No public rating recorded; credit support is in place" : "No rating or credit support recorded");
  else if (IG.test(rating)) add("Counterparty strength", "strong", `Investment-grade rating ${rating}${p.credit.ratingAgency ? ` (${p.credit.ratingAgency})` : ""}`);
  else if (SUB_IG.test(rating)) add("Counterparty strength", support ? "acceptable" : "material_issue", `Sub-investment-grade rating ${rating}${support ? " with credit support" : " without credit support"}`);
  else add("Counterparty strength", "unknown", `Rating "${rating}" not recognised`);

  const tenor = p.termYears;
  if (tenor === null) add("Tenor adequacy", "unknown", "Term not recorded");
  else if (ctx.debtTenorYears) add("Tenor adequacy", tenor >= ctx.debtTenorYears ? "strong" : tenor >= ctx.debtTenorYears * 0.8 ? "acceptable" : "conditional", `${tenor}-year term against ${ctx.debtTenorYears}-year debt tenor${tenor < ctx.debtTenorYears ? ": merchant tail during debt life" : ""}`);
  else add("Tenor adequacy", tenor >= 15 ? "strong" : tenor >= 10 ? "acceptable" : tenor >= 5 ? "conditional" : "material_issue", `${tenor}-year term (no debt tenor in the model to compare)`);

  if (p.price === null) add("Price adequacy", "unknown", "Price not recorded");
  else if (!ctx.breakevenPrice) add("Price adequacy", "unknown", "No breakeven price from a financial model to compare against");
  else { const r = p.price / ctx.breakevenPrice; add("Price adequacy", r >= 1.15 ? "strong" : r >= 1 ? "acceptable" : "material_issue", `Price ${p.price} vs model breakeven ${ctx.breakevenPrice.toFixed(2)} (${Math.round((r - 1) * 100)}% headroom)`); }

  const debtCur = ctx.debtCurrency ?? ctx.projectCurrency;
  if (!debtCur) add("Currency alignment", "unknown", "No debt or model currency to compare");
  else if (p.currency === debtCur) add("Currency alignment", "strong", `PPA and debt both in ${p.currency}`);
  else add("Currency alignment", /usd|dollar|fx/i.test(p.indexation) ? "acceptable" : "conditional", `PPA in ${p.currency}, debt in ${debtCur}${/usd|dollar|fx/i.test(p.indexation) ? "; price indexed to FX" : ": FX exposure"}`);

  add("Indexation", (p.escalationPct ?? 0) > 0 || p.indexation.trim() ? "acceptable" : (tenor ?? 0) > 10 ? "conditional" : "acceptable", (p.escalationPct ?? 0) > 0 || p.indexation.trim() ? `Escalation ${p.escalationPct ?? 0}%/yr${p.indexation ? `, indexed to ${p.indexation}` : ""}` : "Flat nominal price: real value erodes over a long term");

  const alloc = (k: string) => (p.riskAllocation[k] ?? "unknown") as "seller" | "buyer" | "shared" | "unknown";
  const allocDim = (name: string, key: string, sellerResult: Bankability, sellerWhy: string) => {
    const a = alloc(key);
    add(name, a === "buyer" ? "strong" : a === "shared" ? "acceptable" : a === "seller" ? sellerResult : "unknown", a === "unknown" ? "Allocation not recorded" : a === "seller" ? sellerWhy : `Borne by ${a === "buyer" ? "the buyer" : "both parties"}`);
  };
  allocDim("Volume certainty", "volume", p.profile === "as_produced" ? "acceptable" : "conditional", p.profile === "as_produced" ? "As-produced: the project delivers what it generates" : "Project bears shortfall against a fixed or shaped volume");
  allocDim("Curtailment allocation", "curtailment", "conditional", "Project bears curtailment: lost revenue is uncompensated");
  allocDim("Change-in-law protection", "change_in_law", "conditional", "Project bears change-in-law risk");
  if (p.type === "virtual" || p.type === "cfd") allocDim("Basis risk", "basis", "conditional", "Settlement at a different node than delivery: project bears the spread");
  allocDim("Negative pricing", "negative_pricing", "conditional", "Project bears negative-price intervals");

  add("Termination regime", p.credit.terminationPayment?.trim() ? "acceptable" : "unknown", p.credit.terminationPayment?.trim() ? `Termination payment: ${p.credit.terminationPayment}` : "Termination payment not recorded");
  const la = p.lenderRights.assignment ?? "unknown", si = p.lenderRights.stepIn ?? "unknown", da = p.lenderRights.directAgreement ?? "unknown";
  add("Lender assignment", la === "yes" ? "strong" : la === "no" ? "material_issue" : "unknown", la === "yes" ? "Assignable to lenders as security" : la === "no" ? "Not assignable: lenders cannot take security over the contract" : "Not recorded");
  add("Step-in rights", si === "yes" && da === "yes" ? "strong" : si === "yes" ? "acceptable" : si === "no" ? "material_issue" : "unknown", si === "yes" ? `Step-in rights${da === "yes" ? " under a direct agreement" : " (no direct agreement recorded)"}` : si === "no" ? "No lender step-in" : "Not recorded");
  const open = p.conditions.filter(c => c.status === "open");
  add("COD / conditions precedent", !p.conditions.length ? "unknown" : open.length === 0 ? "strong" : "conditional", !p.conditions.length ? "No conditions recorded" : open.length ? `Open: ${open.map(c => c.condition).join(", ")}` : "All conditions satisfied or waived");
  add("Guarantee quality", support ? (IG.test(rating) || /parent|bank|sovereign|letter of credit|lc/i.test(`${p.credit.guarantee} ${p.credit.lc}`) ? "acceptable" : "conditional") : IG.test(rating) ? "acceptable" : "unknown", support ? [p.credit.guarantee, p.credit.lc, p.credit.deposit].filter(Boolean).join(" · ") : IG.test(rating) ? "No guarantee; investment-grade buyer" : "No guarantee, LC or deposit recorded");
  return out;
}

export function summariseBankability(d: Dimension[]) {
  const c: Record<Bankability, number> = { strong: 0, acceptable: 0, conditional: 0, material_issue: 0, unknown: 0 };
  for (const x of d) c[x.result]++;
  return c;
}

export type StackRow = { name: string; source: "stream" | "ppa"; counterparty: string; mechanism: string; annualRevenue: number | null; contracted: boolean; tenorYears: number | null; currency: string };
/** Revenue stack: contracted vs merchant share, counterparty concentration and revenue-weighted contracted tenor. */
export function revenueStack(streams: Stream[], ppaRows: Ppa[]) {
  const linked = new Set(ppaRows.map(p => p.revenueStreamId).filter(Boolean));
  const rows: StackRow[] = [
    ...streams.filter(s => s.status !== "lost").map(s => ({ name: s.name || s.mechanism, source: "stream" as const, counterparty: s.counterparty ?? "", mechanism: s.mechanism, annualRevenue: s.unitPrice !== null && s.annualVolume !== null ? s.unitPrice * s.annualVolume : null, contracted: s.status === "signed" && s.mechanism !== "merchant", tenorYears: s.tenorYears, currency: s.currency })),
    ...ppaRows.filter(p => p.status !== "terminated" && !(p.revenueStreamId && linked.has(p.revenueStreamId) && streams.some(s => s.id === p.revenueStreamId))).map(p => ({ name: p.name, source: "ppa" as const, counterparty: p.buyerName, mechanism: p.type, annualRevenue: p.price !== null && p.contractedMwhYear !== null ? p.price * p.contractedMwhYear : null, contracted: ["signed", "conditions_precedent", "effective"].includes(p.status), tenorYears: p.termYears, currency: p.currency })),
  ];
  const known = rows.filter(r => r.annualRevenue !== null);
  const total = known.reduce((a, r) => a + r.annualRevenue!, 0);
  const contracted = known.filter(r => r.contracted).reduce((a, r) => a + r.annualRevenue!, 0);
  const byCp = new Map<string, number>();
  for (const r of known) if (r.contracted) byCp.set(r.counterparty || "Unnamed", (byCp.get(r.counterparty || "Unnamed") ?? 0) + r.annualRevenue!);
  const shares = [...byCp.values()].map(v => (contracted ? v / contracted : 0));
  const top = [...byCp].sort((a, b) => b[1] - a[1])[0];
  const tenorW = known.filter(r => r.contracted && r.tenorYears !== null).reduce((a, r) => a + r.annualRevenue! * r.tenorYears!, 0);
  return {
    rows, total, contractedPct: total ? (contracted / total) * 100 : null, merchantPct: total ? ((total - contracted) / total) * 100 : null, unknownRevenueRows: rows.length - known.length,
    topCounterparty: top ? { name: top[0], pct: contracted ? (top[1] / contracted) * 100 : 0 } : null, hhi: shares.reduce((a, s) => a + (s * 100) ** 2, 0),
    weightedTenor: contracted ? tenorW / contracted : null, currencies: [...new Set(rows.map(r => r.currency))],
  };
}

/** Levelised cost of storage: PV(capex + fixed O&M + charging + augmentation) / PV(discharged MWh). Screening grade. */
export function lcos(s: Pick<Storage, "powerMw" | "energyMwh" | "cyclesPerYear" | "roundTripPct" | "degradationPctYear" | "usefulLifeYears" | "augmentation" | "capexPerKwh" | "capexPerKw" | "fixedOmPerKwYear" | "chargingCostPerMwh">, discountPct = 8) {
  const missing = (["cyclesPerYear", "roundTripPct", "usefulLifeYears"] as const).filter(k => s[k] === null);
  if (missing.length || (s.capexPerKwh === null && s.capexPerKw === null)) return { lcos: null, missing: [...missing, ...(s.capexPerKwh === null && s.capexPerKw === null ? ["capex"] : [])] };
  const r = discountPct / 100, life = Math.round(s.usefulLifeYears!), rte = s.roundTripPct! / 100;
  const capex = (s.capexPerKwh ?? 0) * s.energyMwh * 1000 + (s.capexPerKw ?? 0) * s.powerMw * 1000;
  let pvCost = capex, pvMwh = 0, usable = s.energyMwh;
  for (let t = 1; t <= life; t++) {
    const aug = s.augmentation.filter(a => a.year === t);
    usable = usable * (1 - (s.degradationPctYear ?? 0) / 100) + aug.reduce((a, x) => a + x.mwh, 0);
    usable = Math.min(usable, s.energyMwh);
    const discharged = usable * s.cyclesPerYear!;
    const cost = (s.fixedOmPerKwYear ?? 0) * s.powerMw * 1000 + (discharged / rte) * (s.chargingCostPerMwh ?? 0) + aug.reduce((a, x) => a + x.mwh * 1000 * x.costPerKwh, 0);
    pvCost += cost / (1 + r) ** t; pvMwh += discharged / (1 + r) ** t;
  }
  return { lcos: pvMwh ? pvCost / pvMwh : null, capex, durationHours: s.powerMw ? s.energyMwh / s.powerMw : null, missing: [] as string[] };
}

// ---------------- Power-to-load matching ----------------
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Screening capacity factors by asset class (labelled estimates, used only when the project has no generation figure). */
export const SCREEN_CF: Record<string, number> = { solar: 0.22, wind: 0.35, hydro: 0.45, geothermal: 0.85 };
export type MatchDim = { dimension: string; result: "fit" | "conditional" | "no_fit" | "unknown"; why: string };
type Gen = { id: string; name: string; lat: number | null; lng: number | null; capacity: number | null; capacityUnit: string | null; assetClass: string | null; country: string | null; stage: string; codYear?: number | null; annualMwh?: number | null };

export function matchDims(gen: Gen, load: Load, grid?: Grid | null): { distanceKm: number | null; dims: MatchDim[]; annualMwh: number | null; estimated: boolean } {
  const dims: MatchDim[] = [];
  const d = gen.lat !== null && gen.lng !== null && load.lat !== null && load.lng !== null ? haversineKm({ lat: gen.lat, lng: gen.lng }, { lat: load.lat, lng: load.lng }) : null;
  dims.push(d === null ? { dimension: "Distance", result: "unknown", why: "Location missing on one side" } : d <= 30 ? { dimension: "Distance", result: "fit", why: `${d.toFixed(0)} km: onsite, private wire or physical delivery possible` } : d <= 300 ? { dimension: "Distance", result: "conditional", why: `${d.toFixed(0)} km: physical or sleeved PPA through the grid; check same market / zone` } : { dimension: "Distance", result: gen.country && gen.country === load.country ? "conditional" : "no_fit", why: `${d.toFixed(0)} km: virtual PPA only${gen.country && gen.country === load.country ? " (same country)" : " (different market)"}` });
  const mw = gen.capacityUnit?.toUpperCase() === "MW" ? gen.capacity : null;
  const cf = gen.assetClass ? SCREEN_CF[gen.assetClass] : undefined;
  const annual = gen.annualMwh ?? (mw && cf ? mw * 8760 * cf : null);
  const need = load.mwhYear ?? (load.mw && load.loadFactorPct ? load.mw * 8760 * (load.loadFactorPct / 100) : load.mw ? load.mw * 8760 * 0.8 : null);
  if (annual === null || need === null) dims.push({ dimension: "Energy volume", result: "unknown", why: "Generation or load volume unknown" });
  else { const cover = (annual / need) * 100; dims.push({ dimension: "Energy volume", result: cover >= 20 ? "fit" : cover >= 5 ? "conditional" : "no_fit", why: `Project ≈ ${Math.round(annual).toLocaleString("en-US")} MWh/yr${gen.annualMwh ? "" : " (screening CF)"} covers ${cover.toFixed(0)}% of load ≈ ${Math.round(need).toLocaleString("en-US")} MWh/yr` }); }
  if (load.renewableTargetPct !== null) dims.push({ dimension: "Renewable target", result: gen.assetClass && ["solar", "wind", "hydro", "geothermal"].includes(gen.assetClass) ? "fit" : "unknown", why: `Load targets ${load.renewableTargetPct}% renewable` });
  const prefs = new Set(load.procurement);
  if (prefs.size) {
    const physicalOk = d !== null && d <= 300;
    const sameMarket = d !== null && (d <= 300 || (!!gen.country && gen.country === load.country));
    const ok = (physicalOk && (prefs.has("physical_ppa") || prefs.has("sleeved") || prefs.has("onsite"))) || (sameMarket && prefs.has("vppa"));
    const labels = [...prefs].map(k => PROCUREMENT[k as keyof typeof PROCUREMENT] ?? k).join(", ");
    dims.push({ dimension: "Procurement route", result: ok ? "fit" : sameMarket ? "conditional" : "no_fit", why: ok ? `Load procures via ${labels}` : sameMarket ? `Load procures via ${labels}; physical delivery needs a closer or same-zone project` : `Load procures via ${labels}; a virtual PPA must settle in the load's market` });
  }
  const eYear = load.energizationDate ? Number(load.energizationDate.slice(0, 4)) : null;
  if (eYear && gen.codYear) dims.push({ dimension: "Timing", result: Math.abs(gen.codYear - eYear) <= 1 ? "fit" : gen.codYear < eYear ? "conditional" : gen.codYear - eYear <= 3 ? "conditional" : "no_fit", why: `Project COD ${gen.codYear} vs load energisation ${eYear}` });
  else dims.push({ dimension: "Timing", result: "unknown", why: "COD or energisation date missing" });
  if (grid) dims.push({ dimension: "Grid position", result: grid.studyStage === "agreement" || grid.studyStage === "energized" || grid.studyStage === "construction" ? "fit" : grid.studyStage === "none" ? "no_fit" : "conditional", why: `Interconnection: ${grid.studyStage.replace(/_/g, " ")}${grid.approvedMw ? `, ${grid.approvedMw} MW approved` : ""}` });
  return { distanceKm: d, dims, annualMwh: annual, estimated: !gen.annualMwh && annual !== null };
}

export function orderMatches<T extends { dims: MatchDim[]; distanceKm: number | null }>(xs: T[]) {
  const rank = (x: T) => x.dims.filter(d => d.result === "fit").length * 3 + x.dims.filter(d => d.result === "conditional").length - x.dims.filter(d => d.result === "no_fit").length * 5;
  return [...xs].sort((a, b) => rank(b) - rank(a) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
}

export type Strategy = { name: string; lines: string[]; caveats: string[] };
/** Screening supply strategies for a large load (indicative sizing with every formula shown; not a design). */
export function powerStrategies(load: Pick<Load, "mw" | "loadFactorPct" | "redundancy">, o: { solarCf?: number; windCf?: number; gridAvailableMw?: number | null } = {}): Strategy[] {
  if (!load.mw) return [];
  const lf = (load.loadFactorPct ?? 80) / 100, mwh = load.mw * 8760 * lf, solarCf = o.solarCf ?? 0.22, windCf = o.windCf ?? 0.35;
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const gridGap = o.gridAvailableMw !== undefined && o.gridAvailableMw !== null ? load.mw - o.gridAvailableMw : null;
  const solarFor = (share: number) => (mwh * share) / (8760 * solarCf);
  const bessNight = load.mw * lf * 12; // MWh to carry 12 h of average load
  return [
    { name: "A · Grid + virtual PPA", lines: [`Grid supply ${f(load.mw)} MW`, `VPPA for ${f(mwh)} MWh/yr (annual matching)`], caveats: [gridGap && gridGap > 0 ? `Grid gap ${f(gridGap)} MW: needs network upgrades or onsite supply` : "Confirm available grid capacity and energisation date", "Annual matching only; not 24/7 carbon-free"] },
    { name: "B · Solar + BESS + grid", lines: [`Solar ≈ ${f(solarFor(0.5))} MWac for ~50% of annual energy (CF ${solarCf})`, `BESS ≈ ${f(load.mw * lf)} MW / ${f(load.mw * lf * 4)} MWh (4 h shifting)`, `Grid for the remainder and firming`], caveats: ["Land ≈ 1.6–2 ha per MWac for solar", "Grid still needed for reliability and redundancy"] },
    { name: "C · Wind + solar + BESS (high hourly matching)", lines: [`Wind ≈ ${f((mwh * 0.4) / (8760 * windCf))} MW (CF ${windCf}) + solar ≈ ${f(solarFor(0.4))} MWac`, `BESS ≈ ${f(load.mw * lf)} MW / ${f(bessNight)} MWh (12 h)`], caveats: ["Hourly match depends on resource correlation: needs 8760-h modelling", "Storage cost dominates above ~80% hourly matching"] },
    { name: "D · Onsite firm generation + renewables", lines: [`Firm onsite capacity ${f(load.mw * 1.2)} MW (N+1 margin)`, `Renewable PPA for decarbonisation share`], caveats: ["Gas: fuel supply, emissions and permitting; fuel cells / geothermal where available", "Microgrid can shorten time to power where transmission is slow"] },
    { name: "E · Clean-firm pathway", lines: [`Geothermal / hydro / nuclear (SMR) offtake for baseload ${f(load.mw * lf)} MW average`], caveats: ["Availability and timeline are location- and technology-specific; treat as long-dated option"] },
  ];
}
