// Energy-yield sanity check: a project's stated annual energy against what PVGIS says 1 kWp produces at the site,
// fixed and with single-axis tracking. A claim above the tracking yield needs an explanation (capacity stated in AC
// with DC oversizing, bifacial gain, a different resource dataset) before it reaches a lender. Never a verdict on the
// project: a question to put to the sponsor, with the numbers shown.

export type YieldCheck = {
  statedKwhPerKw: number; fixed: number | null; tracking: number | null;
  ratioFixed: number | null; ratioTracking: number | null;
  reading: "consistent_fixed" | "needs_tracking" | "above_tracking" | "below_fixed" | "no_reference";
  question: string;
};

export function yieldCheck(capacityMw: number, annualGwh: number, fixed: number | null, tracking: number | null): YieldCheck | null {
  if (!(capacityMw > 0) || !(annualGwh > 0)) return null;
  const stated = Math.round((annualGwh * 1000) / capacityMw);
  const r = (ref: number | null) => (ref ? Math.round((stated / ref) * 100) / 100 : null);
  const ratioFixed = r(fixed), ratioTracking = r(tracking);
  const pct = (x: number) => `${Math.round((x - 1) * 100)}%`;
  if (!fixed && !tracking) return { statedKwhPerKw: stated, fixed, tracking, ratioFixed, ratioTracking, reading: "no_reference", question: "No PVGIS reference for this site yet: set the location and build the place profile." };
  if (ratioTracking !== null && ratioTracking > 1.05)
    return { statedKwhPerKw: stated, fixed, tracking, ratioFixed, ratioTracking, reading: "above_tracking", question: `Stated output is ${pct(ratioTracking)} above single-axis tracking at this site. Ask: is capacity stated in MWac (and what DC/AC ratio), which resource dataset and P-value (P50/P90) were used, and is there an independent energy yield assessment?` };
  if (ratioFixed !== null && ratioFixed > 1.05)
    return { statedKwhPerKw: stated, fixed, tracking, ratioFixed, ratioTracking, reading: "needs_tracking", question: "Stated output needs single-axis tracking (or DC oversizing) to be reached: confirm the design basis and that trackers are priced in the CAPEX." };
  if (ratioFixed !== null && ratioFixed < 0.8)
    return { statedKwhPerKw: stated, fixed, tracking, ratioFixed, ratioTracking, reading: "below_fixed", question: "Stated output is well below fixed-tilt potential: confirm losses, curtailment or export limits assumed." };
  return { statedKwhPerKw: stated, fixed, tracking, ratioFixed, ratioTracking, reading: "consistent_fixed", question: "Stated output is consistent with the public resource data; an independent yield assessment (P50/P90) is still needed for financing." };
}

/** Parses an annual-energy claim value to GWh (accepts GWh, MWh, kWh units). */
export function toGwh(value: string | null | undefined, unit: string | null | undefined): number | null {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (unit ?? "GWh").toLowerCase();
  return u.startsWith("mwh") ? n / 1000 : u.startsWith("kwh") ? n / 1e6 : u.startsWith("twh") ? n * 1000 : n;
}
