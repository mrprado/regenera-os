// Pure matching + qualification logic (docs/plans/phase-14-mandates.md §7–9, §21). No database, no clock unless
// passed. Every reading states its basis; inferred values (EPC value, procurement window) are labelled inferences.
import { CANDIDATE_STAGES, flowFor, qualificationFor, STAGE_ORDER, type CandidateStage, type Evidence, type FitDimension, type FitReading, type MandateType, type PursuitType, type Reading } from "./vocab";

export type MandateLike = { type: MandateType; technologies: string[]; geography: { countries?: string[]; states?: string[]; isos?: string[] }; criteria: Record<string, unknown> };
export type Check = { met: "yes" | "no" | "unknown"; basis: string; by?: string; at?: string; machine?: boolean };

/** A normalized view of any candidate entity: what the matcher reads. */
export type Attrs = {
  technology?: string | null;        // solar | bess | solar_bess | wind | … or free text
  mw?: number | null; mwh?: number | null;
  country?: string | null; state?: string | null; iso?: string | null;
  stage?: string | null;             // normalized development stage, see stageFromQueue
  stageBasis?: string;
  cod?: string | null;               // expected in-service / COD (ISO date)
  value?: number | null;             // ticket / capex / award, in the mandate currency
  sponsorKnown?: boolean; epcAwarded?: boolean | null;
  sectors?: string[]; ticketMin?: number | null; ticketMax?: number | null; geographies?: string[]; stages?: string[];
  source?: string; sourceUrl?: string;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
const list = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x).trim().toLowerCase()).filter(Boolean) : typeof v === "string" ? v.split(/[,;\n]/).map(x => x.trim().toLowerCase()).filter(Boolean) : []);
const lc = (s?: string | null) => (s ?? "").toLowerCase();

/** Queue fuel → technology key. */
export function technologyOf(fuel: string, facility = ""): string {
  const f = `${fuel} ${facility}`.toLowerCase();
  if (/hybrid|solar\s*\/\s*storage|solar.*batter|pv.*storage/.test(f)) return "solar_bess";
  if (/solar|photovoltaic|\bpv\b/.test(f)) return "solar";
  if (/batter|storage|bess/.test(f)) return "bess";
  if (/wind/.test(f)) return "wind";
  if (/gas|thermal|combustion|\bct\b|combined cycle/.test(f)) return "gas";
  return f.trim() ? "other" : "";
}

/** Interconnection status → development stage, with the reading's basis. Under construction / operating ⇒ EPC likely awarded. */
export function stageFromQueue(iso: string, status: string, studyPhase: string, iaStatus: string): { stage: string; basis: string; epcAwarded: boolean | null } {
  const s = `${status} ${studyPhase} ${iaStatus}`.toLowerCase();
  if (/withdrawn|suspension|terminated/.test(s)) return { stage: "withdrawn", basis: `${iso} status "${[status, iaStatus].filter(Boolean).join(" / ")}"`, epcAwarded: null };
  if (/commercial operation|in service|operational/.test(s)) return { stage: "operating", basis: `${iso} reports commercial operation`, epcAwarded: true };
  if (/under construction|construction/.test(s)) return { stage: "construction", basis: `${iso} reports construction`, epcAwarded: true };
  if (/ia fully executed|gia executed/.test(s)) return { stage: "late_development", basis: `${iso}: interconnection agreement executed ("${iaStatus || status}")`, epcAwarded: null };
  // MISO publishes a post-GIA status of "Not Started" on positions still in study, so it only counts when no study phase is active.
  if (/post-gia/.test(lc(iaStatus)) && !/phase [123]/.test(lc(studyPhase))) return { stage: "late_development", basis: `${iso}: post-GIA record with no active study phase ("${iaStatus}"); inference that the GIA is executed, confirm with the developer`, epcAwarded: null };
  if (/facility study|phase 3|ia pending/.test(s)) return { stage: "mid_development", basis: `${iso}: ${studyPhase || status}`, epcAwarded: null };
  if (/phase 2/.test(s)) return { stage: "mid_development", basis: `${iso}: study ${studyPhase}`, epcAwarded: null };
  return { stage: "early_development", basis: `${iso}: ${studyPhase || status || "study stage not stated"}`, epcAwarded: null };
}

/** EPC planning benchmarks (internal assumptions, shown as inferences; replace with the client's own estimating data). */
export const EPC_BENCHMARK = { solarUsdPerWac: 1.0, bessUsdPerWh: 0.25, bessHoursIfUnknown: 4, hybridBessShare: 0.5, ntpMonthsBeforeCodSolar: 14, ntpMonthsBeforeCodBess: 12, procurementMonthsBeforeNtp: 6 } as const;

export function estimateEpc(a: Attrs): { value: number | null; basis: string } {
  if (!a.mw) return { value: null, basis: "No capacity stated." };
  const solarMw = a.technology === "bess" ? 0 : a.mw;
  const bessMwh = a.technology === "solar" ? 0 : a.mwh ?? (a.technology === "bess" ? a.mw * EPC_BENCHMARK.bessHoursIfUnknown : a.technology === "solar_bess" ? a.mw * EPC_BENCHMARK.hybridBessShare * EPC_BENCHMARK.bessHoursIfUnknown : 0);
  const v = solarMw * 1e6 * EPC_BENCHMARK.solarUsdPerWac + bessMwh * 1e6 * EPC_BENCHMARK.bessUsdPerWh;
  const parts = [solarMw ? `${solarMw} MWac × $${EPC_BENCHMARK.solarUsdPerWac}/Wac` : "", bessMwh ? `${bessMwh} MWh${a.mwh ? "" : a.technology === "solar_bess" ? ` (assumed storage at ${EPC_BENCHMARK.hybridBessShare * 100}% of injection MW, ${EPC_BENCHMARK.bessHoursIfUnknown} h)` : ` (assumed ${EPC_BENCHMARK.bessHoursIfUnknown} h)`} × $${EPC_BENCHMARK.bessUsdPerWh}/Wh` : ""].filter(Boolean);
  return { value: v || null, basis: `Inference: ${parts.join(" + ")} (internal planning benchmark, not an estimate).` };
}

const addMonths = (iso: string, m: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };

/** §21 Procurement window inferred back from the stated in-service date. Always an inference. */
export function procurementWindow(a: Attrs): { start: string | null; end: string | null; basis: string } {
  if (!a.cod) return { start: null, end: null, basis: "No in-service date published." };
  const ntp = a.technology === "bess" ? EPC_BENCHMARK.ntpMonthsBeforeCodBess : EPC_BENCHMARK.ntpMonthsBeforeCodSolar;
  const end = addMonths(a.cod, -ntp);
  const start = addMonths(end, -EPC_BENCHMARK.procurementMonthsBeforeNtp);
  return { start, end, basis: `Inference: requested in-service ${a.cod.slice(0, 10)} − ~${ntp} months to NTP − ~${EPC_BENCHMARK.procurementMonthsBeforeNtp} months procurement. Queue dates slip often.` };
}

function technologyFit(m: MandateLike, a: Attrs): FitReading {
  const want = new Set(m.technologies.map(lc).length ? m.technologies.map(lc) : list(m.criteria.technologies));
  const t = lc(a.technology);
  if (!want.size) return { reading: "unknown", basis: "Mandate has no technology criteria." };
  if (!t) return { reading: "unknown", basis: "Technology not stated by the source." };
  if (want.has(t)) return { reading: "strong", basis: `${t} is in the mandate (${[...want].join(", ")}).` };
  if (t === "solar_bess" && (want.has("solar") || want.has("bess"))) return { reading: "partial", basis: "Hybrid solar + storage; the mandate lists one component." };
  if ((t === "solar" || t === "bess") && want.has("solar_bess")) return { reading: "partial", basis: `${t} alone; the mandate targets hybrids.` };
  if ([...want].some(w => t.includes(w) || w.includes(t))) return { reading: "partial", basis: `Text match between "${t}" and the mandate technologies.` };
  return { reading: "fail", basis: `${t} is outside the mandate (${[...want].join(", ")}).` };
}

function sizeFit(m: MandateLike, a: Attrs): FitReading {
  if (m.type === "epc_origination") {
    const minSolar = num(m.criteria.minSolarMw), minMw = num(m.criteria.minStorageMw), minMwh = num(m.criteria.minStorageMwh);
    if (a.mw == null) return { reading: "unknown", basis: "Capacity not stated." };
    const isBess = a.technology === "bess";
    const min = isBess ? minMw : minSolar;
    if (min == null) return { reading: "unknown", basis: "No minimum size in the mandate." };
    if (a.mw < min) return { reading: "fail", basis: `${a.mw} MW < ${min} MW minimum.` };
    if (isBess && minMwh != null && a.mwh == null) return { reading: "partial", basis: `${a.mw} MW ≥ ${min} MW; energy (MWh) not published.` };
    if (isBess && minMwh != null && a.mwh != null && a.mwh < minMwh) return { reading: "fail", basis: `${a.mwh} MWh < ${minMwh} MWh minimum.` };
    return { reading: a.mw >= min * 2 ? "strong" : "partial", basis: `${a.mw} MW against a ${min} MW minimum.` };
  }
  const lo = num(m.criteria.ticketMin) ?? a.ticketMin ?? null, hi = num(m.criteria.ticketMax) ?? a.ticketMax ?? null;
  const v = a.value ?? num(m.criteria.raiseAmount);
  if (v == null || (lo == null && hi == null)) return { reading: "unknown", basis: "Amount or range not stated." };
  if ((lo != null && v < lo) || (hi != null && v > hi)) return { reading: "fail", basis: `${Math.round(v).toLocaleString("en-US")} outside ${lo ?? "—"}–${hi ?? "—"}.` };
  return { reading: "strong", basis: `${Math.round(v).toLocaleString("en-US")} within ${lo ?? "—"}–${hi ?? "—"}.` };
}

function geoFit(m: MandateLike, a: Attrs): FitReading {
  const states = list(m.geography.states ?? m.criteria.states), isos = list(m.geography.isos ?? m.criteria.isos), countries = list(m.geography.countries ?? m.criteria.countries);
  const theirs = (a.geographies ?? []).map(lc);
  if (!states.length && !isos.length && !countries.length) return { reading: "unknown", basis: "Mandate has no geography." };
  if (a.state && states.includes(lc(a.state))) return { reading: "strong", basis: `${a.state} is a mandate state.` };
  if (a.iso && isos.includes(lc(a.iso))) return { reading: states.length && a.state ? "partial" : "strong", basis: `${a.iso} is a mandate market${states.length && a.state ? `; ${a.state} is not a listed state` : ""}.` };
  if (a.country && countries.some(c => lc(a.country).startsWith(c) || c.startsWith(lc(a.country)))) return { reading: "strong", basis: `${a.country} is a mandate country.` };
  if (theirs.length && (theirs.includes("global") || theirs.some(g => countries.includes(g) || states.includes(g)))) return { reading: "strong", basis: `Their geographies (${theirs.join(", ")}) cover the mandate.` };
  if (!a.state && !a.iso && !a.country && !theirs.length) return { reading: "unknown", basis: "Location not stated." };
  return { reading: "fail", basis: `${[a.state, a.iso, a.country, ...theirs].filter(Boolean).join(" / ")} is outside the mandate geography.` };
}

function timingFit(m: MandateLike, a: Attrs, now: Date): FitReading {
  if (m.type !== "epc_origination") return a.stage ? { reading: "partial", basis: `Stage ${a.stage}.` } : { reading: "unknown", basis: "Timing not stated." };
  if (a.stage === "construction" || a.stage === "operating") return { reading: "fail", basis: `${a.stageBasis ?? a.stage}: EPC procurement has likely passed.` };
  if (a.stage === "withdrawn") return { reading: "fail", basis: a.stageBasis ?? "Withdrawn." };
  const w = procurementWindow(a);
  if (!w.end) return { reading: "unknown", basis: w.basis };
  const horizon = num(m.criteria.procurementHorizonMonths) ?? 30;
  const today = now.toISOString().slice(0, 10), limit = addMonths(today, horizon);
  if (w.end < today) return { reading: "weak", basis: `${w.basis} Window may have passed (or the date will move).` };
  if (w.start! <= limit) return { reading: "strong", basis: `${w.basis} Inside the ${horizon}-month horizon.` };
  return { reading: "weak", basis: `${w.basis} Beyond the ${horizon}-month horizon.` };
}

function stageFit(m: MandateLike, a: Attrs): FitReading {
  const wanted = list(m.criteria.stages);
  if (!a.stage) return { reading: "unknown", basis: "Stage not stated." };
  if (a.stage === "withdrawn" || a.stage === "operating" || a.stage === "construction") return { reading: "fail", basis: a.stageBasis ?? a.stage };
  if (!wanted.length) return { reading: "partial", basis: `${a.stageBasis ?? a.stage}; mandate has no stage filter.` };
  if (wanted.includes(a.stage)) return { reading: "strong", basis: a.stageBasis ?? a.stage };
  return { reading: "weak", basis: `${a.stageBasis ?? a.stage}; mandate wants ${wanted.join(", ")}.` };
}

/** §7 All fit dimensions for one candidate. */
export function evaluate(m: MandateLike, a: Attrs, ctx: { relationship?: "strong" | "some" | "none"; now?: Date } = {}): Record<FitDimension, FitReading> {
  const now = ctx.now ?? new Date();
  const technical = technologyFit(m, a);
  const size = sizeFit(m, a);
  const geographic = geoFit(m, a);
  const timing = timingFit(m, a, now);
  const stage = stageFit(m, a);
  const epc = m.type === "epc_origination" ? estimateEpc(a) : null;
  const minValue = num(m.criteria.minEpcValue);
  const financial: FitReading = epc ? (epc.value == null ? { reading: "unknown", basis: epc.basis } : minValue != null && epc.value < minValue ? { reading: "weak", basis: `${epc.basis} Below the ${minValue.toLocaleString("en-US")} minimum.` } : { reading: "partial", basis: epc.basis }) : size;
  const worst = (rs: Reading[]): Reading => (rs.includes("fail") ? "fail" : rs.includes("unknown") ? (rs.every(r => r === "unknown") ? "unknown" : "partial") : rs.includes("weak") ? "weak" : rs.includes("partial") ? "partial" : "strong");
  const core = [technical.reading, m.type === "epc_origination" ? size.reading : "strong", geographic.reading, stage.reading];
  return {
    mandate: { reading: worst(core), basis: `Technology ${technical.reading}, size ${size.reading}, geography ${geographic.reading}, stage ${stage.reading}.` },
    technical: m.type === "epc_origination" ? { reading: worst([technical.reading, size.reading]), basis: `${technical.basis} ${size.basis}` } : technical,
    financial,
    geographic,
    timing,
    strategic: a.sponsorKnown ? { reading: "partial", basis: "Sponsor known; strategic fit needs the account profile." } : { reading: "unknown", basis: "Sponsor / account not identified: strategic fit cannot be judged yet." },
    relationship: ctx.relationship === "strong" ? { reading: "strong", basis: "Existing relationship in the CRM." } : ctx.relationship === "some" ? { reading: "partial", basis: "Some contact history in the CRM." } : { reading: "unknown", basis: "No relationship recorded." },
    compliance: { reading: "unknown", basis: "Outreach follows the mandate's outreach permission and the send-time compliance gate." },
    risk: a.stage === "early_development" ? { reading: "weak", basis: "Early study stage: queue positions at this stage frequently withdraw." } : a.stage === "late_development" ? { reading: "partial", basis: "Interconnection agreement stage; permitting, offtake and financing not confirmed by the queue." } : { reading: "unknown", basis: "Risk not assessed." },
    esg: { reading: "unknown", basis: "Run site intelligence (Atlas) for environmental and community screening." },
  };
}

/** Machine-answerable qualification criteria (§8). Human criteria stay "unknown" until a person records them. */
export function machineChecks(m: MandateLike, a: Attrs, fit: Record<FitDimension, FitReading>, hasEvidence: boolean, nextAction: string): Record<string, Check> {
  const yes = (r: Reading) => (r === "strong" || r === "partial" ? "yes" : r === "unknown" ? "unknown" : "no") as Check["met"];
  const c: Record<string, Check> = {};
  const set = (k: string, met: Check["met"], basis: string) => { c[k] = { met, basis, machine: true }; };
  set("technology", yes(fit.technical.reading === "fail" ? "fail" : technologyFit(m, a).reading), technologyFit(m, a).basis);
  set("geography", yes(fit.geographic.reading), fit.geographic.basis);
  set("size", yes(sizeFit(m, a).reading), sizeFit(m, a).basis);
  set("mandate_fit", yes(fit.mandate.reading), fit.mandate.basis);
  set("stage", yes(stageFit(m, a).reading === "weak" ? "fail" : stageFit(m, a).reading), stageFit(m, a).basis);
  set("timing", fit.timing.reading === "strong" ? "yes" : fit.timing.reading === "unknown" ? "unknown" : "no", fit.timing.basis);
  set("value", fit.financial.reading === "unknown" ? "unknown" : fit.financial.reading === "weak" || fit.financial.reading === "fail" ? "no" : "yes", fit.financial.basis);
  set("evidence", hasEvidence ? "yes" : "no", hasEvidence ? "Source record attached." : "No source recorded.");
  set("next_action", nextAction.trim() ? "yes" : "no", nextAction.trim() || "No next action.");
  if (a.epcAwarded === true) set("epc_open", "no", "Source indicates construction or operation: EPC awarded.");
  return c;
}

/** Merge: a human answer always wins over a machine one; machine answers refresh. */
export function mergeChecks(prev: Record<string, Check>, machine: Record<string, Check>): Record<string, Check> {
  const out = { ...machine };
  for (const [k, v] of Object.entries(prev)) if (!v.machine) out[k] = v;
  return out;
}

export function tally(t: MandateType, checks: Record<string, Check>) {
  const crit = qualificationFor(t).filter(c => c.level === "qualified");
  const met = crit.filter(c => checks[c.key]?.met === "yes").length, fail = crit.filter(c => checks[c.key]?.met === "no").length;
  return { met, fail, unknown: crit.length - met - fail, completeness: crit.length ? (met + fail) / crit.length : 0, total: crit.length };
}

/** §9 What a stage requires, and what is missing. */
export function stageRequirements(t: MandateType, target: CandidateStage, checks: Record<string, Check>, ctx: { clientApproved?: boolean; owner?: string | null; dataPresent?: boolean } = {}) {
  const q = qualificationFor(t);
  const need = (level: "qualified" | "engagement" | "pursuit", machineOnly = false) => q.filter(c => c.level === level && (!machineOnly || c.machine));
  const req: { key: string; label: string }[] = [];
  const idx = STAGE_ORDER.indexOf(target);
  if (idx >= STAGE_ORDER.indexOf("screened")) req.push({ key: "data", label: "Source data captured" });
  if (idx >= STAGE_ORDER.indexOf("matched")) for (const k of ["technology", "geography", "mandate_fit"]) { const c = q.find(x => x.key === k); if (c) req.push(c); }
  if (idx >= STAGE_ORDER.indexOf("pre_qualified")) req.push(...need("qualified", true));
  if (idx >= STAGE_ORDER.indexOf("qualified")) req.push(...need("qualified"));
  if (idx >= STAGE_ORDER.indexOf("approved")) req.push({ key: "client_approved", label: "Client approved the pursuit" });
  if (idx >= STAGE_ORDER.indexOf("engagement_qualified")) req.push(...need("engagement"));
  if (idx >= STAGE_ORDER.indexOf("active_pursuit")) req.push(...need("pursuit"));
  const uniq = [...new Map(req.map(r => [r.key, r])).values()];
  const ok = (k: string) => (k === "data" ? ctx.dataPresent !== false : k === "client_approved" ? !!ctx.clientApproved || checks[k]?.met === "yes" : k === "owner" ? !!ctx.owner || checks[k]?.met === "yes" : checks[k]?.met === "yes");
  return { required: uniq, missing: uniq.filter(r => !ok(r.key)) };
}

/** Highest stage the evidence supports, capped at pre-qualified for the machine (a person qualifies). */
export function machineStage(t: MandateType, checks: Record<string, Check>): CandidateStage {
  if (Object.entries(checks).some(([k, c]) => c.met === "no" && ["technology", "geography", "size", "mandate_fit"].includes(k))) return "screened";
  let best: CandidateStage = "discovered";
  for (const s of ["screened", "matched", "pre_qualified"] as CandidateStage[]) if (stageRequirements(t, s, checks).missing.length === 0) best = s;
  return best;
}

export function canAdvance(t: MandateType, to: CandidateStage, checks: Record<string, Check>, ctx: { clientApproved?: boolean; owner?: string | null }) {
  if (!(to in CANDIDATE_STAGES)) return { ok: false, missing: [{ key: "stage", label: "Unknown stage" }] };
  if (to === "watch" || to === "rejected" || to === "excluded") return { ok: true, missing: [] };
  const r = stageRequirements(t, to, checks, ctx);
  return { ok: r.missing.length === 0, missing: r.missing };
}

/** Priority for the approval queue: strong timing + material value first. Categorical, with the reason. */
export function priorityOf(fit: Record<FitDimension, FitReading>, windowStart?: string | null, now = new Date()): { priority: "high" | "medium" | "low"; why: string } {
  if (fit.mandate.reading === "fail") return { priority: "low", why: "Fails a core mandate criterion." };
  if (fit.timing.reading === "weak" || fit.timing.reading === "fail") return { priority: "low", why: "Outside the horizon or the window may have passed." };
  const soon = !!windowStart && windowStart <= addMonths(now.toISOString().slice(0, 10), 12);
  if (fit.timing.reading === "strong" && soon && fit.mandate.reading === "strong") return { priority: "high", why: "Meets every core criterion and the inferred procurement window opens within 12 months." };
  if (fit.timing.reading === "strong") return { priority: "medium", why: soon ? "Window within 12 months; a core criterion is only partially met." : "Inside the horizon; window opens beyond 12 months." };
  return { priority: "medium", why: "Meets core criteria; timing or data incomplete." };
}

/** §64 Probability: stage default, human override with a reason shown beside it. */
export function probabilityOf(type: PursuitType, stage: string, override?: number | null) {
  const base = flowFor(type).find(s => s.key === stage)?.p ?? 0;
  return { base, effective: override ?? base, overridden: override != null };
}

/** §25 Activity → output → outcome → commercial result, from candidate and pursuit rows. */
export function funnelLevels(cands: { stage: string; clientResponse?: string | null }[], purs: { stage: string; outcome: string }[]) {
  const at = (s: CandidateStage) => cands.filter(c => STAGE_ORDER.indexOf(c.stage as CandidateStage) >= STAGE_ORDER.indexOf(s)).length;
  return {
    activity: { screened: at("screened"), universe: cands.length },
    output: { matched: at("matched"), preQualified: at("pre_qualified"), qualified: at("qualified") },
    outcome: { approved: cands.filter(c => c.clientResponse === "approve").length, alreadyKnown: cands.filter(c => c.clientResponse === "already_known").length, pursuits: purs.length },
    commercial: { rfx: purs.filter(p => ["rfq", "rfp", "bid", "bafo", "negotiation", "award", "handoff", "ioi", "term_sheet", "ic", "docs", "close"].includes(p.stage)).length, won: purs.filter(p => p.outcome === "won").length, lost: purs.filter(p => p.outcome === "lost").length },
  };
}

export type { Evidence };
