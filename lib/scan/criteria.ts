// Deterministic screening of one organization against a scan's written criteria (phase 15 §8). Pure: no I/O.
// Each criterion is supported, contradicted or unknown with its evidence. Absence of a keyword is never a contradiction
// (it is unknown); an exclusion word or an out-of-geography country is. The machine stops at "matches criteria":
// human review, outreach readiness and commercial qualification are recorded by people (lib/scan/qualification.ts).
import type { CriterionResult } from "@/db/scans";
import type { Audience } from "./audiences";
import type { ScanConfig } from "./config";
import { country, countryName, expandGeography } from "./countries";

export type OrgFacts = {
  name: string; country: string | null; industry: string | null; description: string | null; headcount: number | null;
  domain: string | null; website: string | null; source?: string;
};
export type Screening = { match: "matches" | "partial" | "unknown" | "excluded"; criteria: CriterionResult[]; missing: string[]; exclusionReason: string | null };

export const RUBRIC_VERSION = "scan-criteria.v1";

export function screenOrganization(org: OrgFacts, a: Audience, c: ScanConfig): Screening {
  const criteria: CriterionResult[] = [];
  const text = [org.industry, org.description].filter(Boolean).join(" · ");
  const haystack = `${org.name} ${text}`;
  const src = org.source;

  // Geography: a stated country inside the scan geography supports it; outside contradicts; missing is unknown.
  const geo = expandGeography(c.geography);
  if (geo.length) {
    const iso = country(org.country)?.iso3 ?? (org.country ? org.country.toUpperCase() : null);
    criteria.push(!iso
      ? { key: "geography", label: "Geography", result: "unknown", evidence: "No country recorded" }
      : geo.includes(iso)
        ? { key: "geography", label: "Geography", result: "supported", evidence: `Recorded country ${countryName(iso)}`, source: src }
        : { key: "geography", label: "Geography", result: "contradicted", evidence: `Recorded country ${countryName(iso)} is outside the scan geography`, source: src });
  }

  // Audience evidence: industry / description wording. A name match alone is weaker and says so.
  const extra = c.terms.length ? new RegExp(`\\b(${c.terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i") : null;
  const inText = text ? a.evidence.test(text) || (extra?.test(text) ?? false) : false;
  const inName = a.evidence.test(org.name) || (extra?.test(org.name) ?? false);
  criteria.push(inText
    ? { key: "audience", label: a.label, result: "supported", evidence: `Industry / description: "${text.slice(0, 140)}"`, source: src }
    : inName
      ? { key: "audience", label: a.label, result: "unknown", evidence: "Only the organization name suggests it; no industry or description evidence yet" }
      : { key: "audience", label: a.label, result: "unknown", evidence: text ? "Recorded industry / description does not mention it" : "No industry or description recorded" });

  // Exclusions: the audience's own, plus the scan's.
  const excl = [a.exclude, c.excludeTerms.length ? new RegExp(`\\b(${c.excludeTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i") : null].filter(Boolean) as RegExp[];
  const hit = excl.map(r => haystack.match(r)?.[0]).find(Boolean);
  if (hit) criteria.push({ key: "exclusion", label: "Exclusions", result: "contradicted", evidence: `Mentions "${hit}", which this audience excludes`, source: src });

  // Size, only when the scan asks for it.
  if (c.headcountMin != null || c.headcountMax != null) {
    const n = org.headcount;
    const okMin = c.headcountMin == null || (n != null && n >= c.headcountMin), okMax = c.headcountMax == null || (n != null && n <= c.headcountMax);
    criteria.push(n == null
      ? { key: "size", label: "Size", result: "unknown", evidence: "Headcount not recorded" }
      : okMin && okMax
        ? { key: "size", label: "Size", result: "supported", evidence: `${n} employees`, source: src }
        : { key: "size", label: "Size", result: "contradicted", evidence: `${n} employees is outside ${c.headcountMin ?? 0}–${c.headcountMax ?? "∞"}`, source: src });
  }

  const missing = [...(org.domain || org.website ? [] : ["Website / domain (needed for research and people search)"]), ...a.capture];
  const contradicted = criteria.find(x => x.result === "contradicted");
  if (contradicted) return { match: "excluded", criteria, missing, exclusionReason: `${contradicted.label}: ${contradicted.evidence}` };
  const core = criteria.filter(x => x.key === "geography" || x.key === "audience");
  const match = core.every(x => x.result === "supported") ? "matches" : core.some(x => x.result === "supported") ? "partial" : "unknown";
  return { match, criteria, missing, exclusionReason: null };
}
