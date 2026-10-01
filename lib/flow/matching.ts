// Explainable matching of an objective against a candidate opportunity (extended specification §8). Pure: no I/O.
// Each criterion is supported, a mismatch, or unknown, with the evidence used. Hard exclusions (closed call, an
// excluded term) never disappear into an average; evidence confidence is reported separately from match quality and
// missing information never raises either. A match is "potential" until a person checks eligibility and commercial terms.
import type { CriterionResult } from "@/db/scans";
import { country, countryName, expandGeography } from "@/lib/scan/countries";

export const MATCH_VERSION = "objective-match.v1";

export type CandidateKind = "project" | "queue_project" | "funding_call" | "procurement";
export type CandidateFacts = {
  kind: CandidateKind; name: string; country: string | null; region?: string | null;
  technologies: string[]; size: number | null; sizeUnit: string | null; stage: string | null;
  deadline: string | null; rolling?: boolean; open: boolean | null; text: string; buyer: string | null; source: string;
};
export type ObjectiveCriteria = { geography: string[]; capabilities: string[]; sizeMin: number | null; sizeMax: number | null; sizeUnit: string | null; stages: string[]; exclusions: string[] };
export type MatchResult = {
  match: "supported" | "partial" | "unknown" | "excluded"; criteria: CriterionResult[]; hardExclusion: string | null;
  confidence: "high" | "medium" | "low"; opportunityType: string; caveats: string[]; nextAction: string;
};

/** Normalizes technology words so "PV", "photovoltaic" and "solar" compare equal; "hybrid" expands to its parts. */
export function techTokens(values: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of values) {
    const v = raw.toLowerCase();
    if (/solar|photovolt|\bpv\b/.test(v)) out.add("solar");
    if (/bess|battery|storage/.test(v)) out.add("storage");
    if (/wind/.test(v)) out.add("wind");
    if (/substation|transmission|interconnect|grid/.test(v)) out.add("grid");
    if (/water|wastewater|desal/.test(v)) out.add("water");
    if (/waste|recycling|landfill/.test(v)) out.add("waste");
    if (/\bgas\b|thermal|ccgt/.test(v)) out.add("gas");
    if (/hydrogen/.test(v)) out.add("hydrogen");
    if (/building|real estate|housing|hospitality/.test(v)) out.add("buildings");
  }
  return out;
}

const TYPE_LABEL: Record<CandidateKind, string> = {
  project: "Project in your network", queue_project: "Interconnection-queue project", funding_call: "Funding call", procurement: "Procurement package",
};

export function matchCandidate(o: ObjectiveCriteria, c: CandidateFacts, today: string): MatchResult {
  const criteria: CriterionResult[] = [];
  const caveats: string[] = [];
  let hard: string | null = null;

  // Geography: operating coverage of the objective versus the candidate's location.
  const geo = expandGeography(o.geography);
  const iso = country(c.country)?.iso3 ?? null;
  if (geo.length) criteria.push(!iso ? { key: "geography", label: "Geography", result: "unknown", evidence: "Location not recorded" }
    : geo.includes(iso) ? { key: "geography", label: "Geography", result: "supported", evidence: `${countryName(iso)}${c.region ? `, ${c.region}` : ""}`, source: c.source }
      : { key: "geography", label: "Geography", result: "contradicted", evidence: `${countryName(iso)} is outside the objective's geography`, source: c.source });

  // Capability: what is needed versus what the objective's party can deliver.
  const want = techTokens(o.capabilities), have = techTokens(c.technologies.length ? c.technologies : [c.text]);
  if (want.size) {
    const common = [...want].filter(t => have.has(t));
    criteria.push(!have.size ? { key: "capability", label: "Capability", result: "unknown", evidence: "Technology not recorded on the candidate" }
      : common.length ? { key: "capability", label: "Capability", result: "supported", evidence: `Needs ${[...have].join(", ")}; objective covers ${common.join(", ")}`, source: c.source }
        : { key: "capability", label: "Capability", result: "contradicted", evidence: `Needs ${[...have].join(", ")}; objective covers ${[...want].join(", ")}`, source: c.source });
  }

  // Size, only in the same unit; a different unit is unknown, never converted silently.
  if (o.sizeMin != null || o.sizeMax != null) {
    const sameUnit = !o.sizeUnit || !c.sizeUnit || o.sizeUnit.toLowerCase() === c.sizeUnit.toLowerCase();
    if (c.size == null || !sameUnit) criteria.push({ key: "size", label: "Size", result: "unknown", evidence: c.size == null ? "Size not recorded" : `Recorded in ${c.sizeUnit}, objective in ${o.sizeUnit}` });
    else {
      const ok = (o.sizeMin == null || c.size >= o.sizeMin) && (o.sizeMax == null || c.size <= o.sizeMax);
      criteria.push({ key: "size", label: "Size", result: ok ? "supported" : "contradicted", evidence: `${c.size.toLocaleString("en-US")} ${c.sizeUnit ?? o.sizeUnit ?? ""} against ${o.sizeMin ?? 0}–${o.sizeMax ?? "∞"}`, source: c.source });
    }
  }

  // Stage, when the objective names stages.
  if (o.stages.length) criteria.push(!c.stage ? { key: "stage", label: "Stage", result: "unknown", evidence: "Stage not recorded" }
    : o.stages.some(s => c.stage!.toLowerCase().includes(s.toLowerCase())) ? { key: "stage", label: "Stage", result: "supported", evidence: c.stage, source: c.source }
      : { key: "stage", label: "Stage", result: "contradicted", evidence: `${c.stage} is not a wanted stage`, source: c.source });

  // Timing: a closed call is a hard exclusion; a missing deadline is unknown (never assumed rolling).
  if (c.kind === "funding_call" || c.kind === "procurement") {
    if (c.open === false || (c.deadline && c.deadline < today)) { hard = `Closed${c.deadline ? ` (deadline ${c.deadline})` : ""}`; criteria.push({ key: "deadline", label: "Deadline", result: "contradicted", evidence: hard, source: c.source }); }
    else criteria.push(c.deadline ? { key: "deadline", label: "Deadline", result: "supported", evidence: `Open; deadline ${c.deadline}`, source: c.source }
      : { key: "deadline", label: "Deadline", result: "unknown", evidence: c.rolling ? "Stated as rolling by the source" : "Deadline unknown" });
  }

  // Exclusions written on the objective.
  const hay = `${c.name} ${c.text}`.toLowerCase();
  const ex = o.exclusions.find(e => e.trim() && hay.includes(e.trim().toLowerCase()));
  if (ex) { hard = hard ?? `Mentions "${ex}", which the objective excludes`; criteria.push({ key: "exclusion", label: "Exclusions", result: "contradicted", evidence: `Mentions "${ex}"`, source: c.source }); }

  if (c.kind === "funding_call") caveats.push("A funding call is not a delivery contract: it needs an eligible applicant and a defined delivery role.");
  if (c.kind === "queue_project") caveats.push("An interconnection request is not an open procurement; the sponsor is not published and must be identified.");
  if (c.kind === "project") caveats.push("A project in your network: confirm the sponsor's procurement plans before treating it as a bid.");

  const core = criteria.filter(x => ["geography", "capability", "size"].includes(x.key));
  const unknowns = core.filter(x => x.result === "unknown").length;
  const confidence = unknowns === 0 && core.length >= 2 ? "high" : unknowns <= 1 ? "medium" : "low";
  const contradicted = criteria.filter(x => x.result === "contradicted");
  const match = hard ? "excluded" : contradicted.length ? (criteria.some(x => x.result === "supported") ? "partial" : "unknown")
    : core.length && core.every(x => x.result === "supported") ? "supported" : criteria.some(x => x.result === "supported") ? "partial" : "unknown";
  const nextAction = hard ? "Dismiss (excluded)"
    : c.kind === "queue_project" ? "Identify the sponsor, then request an introduction"
      : c.kind === "funding_call" ? "Check applicant eligibility and the delivery role"
        : c.kind === "procurement" ? "Review the package scope and decide bid / no-bid"
          : c.buyer ? `Ask ${c.buyer} about procurement plans` : "Identify who controls procurement";
  return { match, criteria, hardExclusion: hard, confidence, opportunityType: TYPE_LABEL[c.kind], caveats, nextAction };
}
