// Pure rule evaluation (phase 23). Same facts + same policy → same decision. Three independent dimensions: commercial
// integrity (readiness), regenerative integrity (rules below), strategic alignment. Seven readings are reported side by
// side; nothing is blended, and no commercial input (capex, fees, returns) is read by the integrity rules.
import type { Reading, RuleHit } from "@/db/integrity";
import type { Classification, DecisionState, PolicyRules } from "./policy";

export type Provenance = "verified" | "official" | "third_party" | "regenera_model" | "user_claim" | "ai_hypothesis" | "missing";
export type Finding = { kind: "concern" | "uncertainty" | "conflict" | "positive"; domain: string; text: string; source: string; provenance: Provenance };

export type IntegrityFacts = {
  name: string; text: string;              // name + technology + description, for pattern rules
  sectorKey: string | null; country: string | null; stage: string;
  exactLocation: boolean;                   // a site point / boundary, not a town/region/country centroid
  spatial: { checked: boolean; protectedOverlap: boolean | null; protectedNearestKm: number | null; wetlandOverlap: boolean | null; forestOverlap: boolean | null; settlementOverlap: boolean | null; source: string; error?: string };
  water: { stress: string | null; source: string };
  forestLoss: { value: string | null; source: string };
  community: { recorded: number; rightsOpen: number; consent: string[] };
  sanctions: { possible: number; confirmed: number };
  evidenceFields: string[];                 // claim fields with evidence (source_provided or better)
  claims: { verified: number; sourced: number; inferred: number; total: number };
  siteScreen: { done: number; failed: number };
  readiness: { reading: string; label: string; blocking: string[]; workPackages: string[] };
  eligibleFunding: number;
  regeneraSector: boolean;
};

const STATE_ORDER: DecisionState[] = ["excluded", "human_review", "redesign_required", "enhanced_due_diligence", "insufficient_evidence", "conditionally_eligible", "eligible"];
const worst = (a: DecisionState, b: DecisionState) => (STATE_ORDER.indexOf(a) <= STATE_ORDER.indexOf(b) ? a : b);

export function evaluateIntegrity(policy: PolicyRules, f: IntegrityFacts) {
  const rules: RuleHit[] = [];
  const findings: Finding[] = [];
  const outstanding: string[] = [];
  const remediation: string[] = [];
  let state: DecisionState = "eligible";
  const text = f.text.toLowerCase();

  // Base classification and sector method.
  const sector = policy.sectorClasses.find(s => new RegExp(s.pattern, "i").test(text));
  let classification: Classification = sector?.classification ?? "conditional_redesign";
  const method = sector?.method ?? null;
  if (!sector) { outstanding.push("Technology / sector not recorded: classification provisional"); state = worst(state, "insufficient_evidence"); }
  rules.push({ rule: "sector_class", outcome: sector ? "pass" : "unknown", basis: sector ? `Sector method "${sector.method}" (${sector.classification.replace(/_/g, " ")})` : "No sector pattern matched" });

  // 1. Exclusions (configurable). A match is a hard stop pending human review of the evidence.
  for (const x of policy.exclusions) if (new RegExp(x.pattern, "i").test(text)) {
    rules.push({ rule: `exclusion:${x.key}`, outcome: "fail", basis: x.why });
    findings.push({ kind: "concern", domain: "governance", text: x.why, source: "Project record text", provenance: "user_claim" });
    classification = "restricted_excluded"; state = worst(state, "excluded");
    remediation.push(`Excluded under "${x.key}": only an owner's documented review can reverse this`);
  }

  // 2. Sanctions.
  if (f.sanctions.confirmed) { rules.push({ rule: "sanctions", outcome: "fail", basis: `${f.sanctions.confirmed} confirmed sanctions match(es) among parties` }); classification = "restricted_excluded"; state = worst(state, "excluded"); }
  else if (f.sanctions.possible) { rules.push({ rule: "sanctions", outcome: "concern", basis: `${f.sanctions.possible} possible sanctions match(es) awaiting review` }); state = worst(state, "human_review"); outstanding.push("Review possible sanctions matches (Network → Sanctions screening)"); }
  else rules.push({ rule: "sanctions", outcome: "pass", basis: "No unresolved sanctions matches among recorded parties" });

  // 3. Community and rights (IFC PS5 / PS7).
  const refused = f.community.consent.filter(c => ["withheld", "withdrawn"].includes(c));
  if (refused.length) {
    rules.push({ rule: "consent", outcome: "fail", basis: `Consent ${refused.join(", ")}` });
    findings.push({ kind: "concern", domain: "community", text: `Community consent ${refused.join(", ")}`, source: "Regenera consent register", provenance: "official" });
    state = worst(state, "human_review"); remediation.push("Do not advance while consent is withheld or withdrawn; a person decides with the community record");
  } else if (f.community.rightsOpen) {
    rules.push({ rule: "rights", outcome: "concern", basis: `${f.community.rightsOpen} open land / community rights issue(s) of medium or higher materiality` });
    findings.push({ kind: "concern", domain: "community", text: `${f.community.rightsOpen} open rights issue(s)`, source: "Regenera rights register", provenance: "official" });
    state = worst(state, "enhanced_due_diligence");
  } else if (!f.community.recorded) {
    rules.push({ rule: "community", outcome: "unknown", basis: "No community or rights record" });
    outstanding.push("Community and land-rights screening (stakeholders, tenure, consent requirement)");
    findings.push({ kind: "uncertainty", domain: "community", text: "No community or rights information recorded", source: "", provenance: "missing" });
  } else rules.push({ rule: "community", outcome: "pass", basis: `${f.community.recorded} communities recorded, no open material rights issues` });

  // 4. Spatial constraints (IFC PS6). OSM boundaries are not legal boundaries: overlap routes to redesign, not exclusion.
  const nature = method === "nature";
  if (!f.exactLocation) {
    rules.push({ rule: "spatial", outcome: "unknown", basis: "No site point or boundary: spatial checks cannot run" });
    outstanding.push("Site location or boundary (spatial constraint screening needs it)");
    state = worst(state, "insufficient_evidence");
  } else if (!f.spatial.checked) {
    rules.push({ rule: "spatial", outcome: "unknown", basis: `Constraint screening unavailable${f.spatial.error ? `: ${f.spatial.error}` : ""}` });
    outstanding.push("Re-run constraint screening (OpenStreetMap service unavailable)");
  } else {
    if (f.spatial.protectedOverlap) {
      if (nature) { rules.push({ rule: "protected_area", outcome: "pass", basis: "Inside a mapped protected area: compatible with a conservation / restoration method (confirm with the managing authority)" }); findings.push({ kind: "positive", domain: "biodiversity", text: "Conservation / restoration inside a mapped protected area", source: f.spatial.source, provenance: "third_party" }); }
      else {
        rules.push({ rule: "protected_area", outcome: "fail", basis: "Site overlaps a mapped protected area" });
        findings.push({ kind: "concern", domain: "biodiversity", text: "Site overlaps a mapped protected area (OSM; not the legal boundary)", source: f.spatial.source, provenance: "third_party" });
        classification = classification === "restricted_excluded" ? classification : "conditional_redesign"; state = worst(state, "redesign_required");
        remediation.push("Move the footprint outside the protected area, or obtain the authority's written compatibility confirmation; verify the legal boundary (WDPA via IBAT or the national registry)");
      }
    } else if (f.spatial.protectedNearestKm !== null && f.spatial.protectedNearestKm <= policy.protectedNearKm) {
      rules.push({ rule: "protected_area", outcome: "concern", basis: `Mapped protected area ${f.spatial.protectedNearestKm.toFixed(1)} km away` });
      findings.push({ kind: "concern", domain: "biodiversity", text: `Protected area within ${policy.protectedNearKm} km`, source: f.spatial.source, provenance: "third_party" });
      state = worst(state, "enhanced_due_diligence");
    } else rules.push({ rule: "protected_area", outcome: "pass", basis: "No mapped protected area within the screened area" });
    if (f.spatial.wetlandOverlap && !nature) { rules.push({ rule: "wetland", outcome: "concern", basis: "Site overlaps a mapped wetland" }); findings.push({ kind: "concern", domain: "water", text: "Mapped wetland on site", source: f.spatial.source, provenance: "third_party" }); state = worst(state, "redesign_required"); remediation.push("Avoid the wetland or design for no net loss with hydrological study"); }
    if (f.spatial.forestOverlap && !nature) { rules.push({ rule: "forest", outcome: "concern", basis: "Site overlaps mapped forest / woodland" }); findings.push({ kind: "concern", domain: "land", text: "Forest / woodland on site: land conversion risk", source: f.spatial.source, provenance: "third_party" }); state = worst(state, "enhanced_due_diligence"); remediation.push("Prefer degraded or previously disturbed land; quantify any clearing"); }
    if (f.spatial.settlementOverlap) { rules.push({ rule: "settlement", outcome: "concern", basis: "Site overlaps mapped residential land / settlement" }); findings.push({ kind: "concern", domain: "community", text: "Settlement on or at the site: displacement risk (IFC PS5)", source: f.spatial.source, provenance: "third_party" }); state = worst(state, "enhanced_due_diligence"); }
  }

  // 5. Water stress for water-intensive uses.
  if (new RegExp(policy.waterIntensive, "i").test(text)) {
    if (!f.water.stress) { outstanding.push("Water availability and demand (water-intensive use)"); rules.push({ rule: "water", outcome: "unknown", basis: "Water-intensive use; no water-stress reading" }); }
    else if (/high|extremely/i.test(f.water.stress)) { rules.push({ rule: "water", outcome: "concern", basis: `Water-intensive use in ${f.water.stress} baseline water stress` }); findings.push({ kind: "concern", domain: "water", text: `Water-intensive use where baseline water stress is ${f.water.stress}`, source: f.water.source, provenance: "third_party" }); state = worst(state, "redesign_required"); remediation.push("Redesign for water efficiency / reuse, or confirm allocation with the water authority"); }
    else rules.push({ rule: "water", outcome: "pass", basis: `Baseline water stress ${f.water.stress}` });
  }

  // 6. Sector method evidence (never regenerative by default).
  if (method && policy.methodEvidence[method]) {
    const need = policy.methodEvidence[method];
    const missing = need.fields.filter(x => !f.evidenceFields.includes(x));
    if (missing.length) {
      rules.push({ rule: `method:${method}`, outcome: "concern", basis: `${need.why}. Missing: ${missing.join(", ")}` });
      findings.push({ kind: "uncertainty", domain: method === "waste" ? "resources" : "governance", text: `Evidence still needed: ${missing.join(", ")}`, source: "", provenance: "missing" });
      if (classification !== "restricted_excluded") classification = "conditional_redesign";
      state = worst(state, "enhanced_due_diligence");
      outstanding.push(...missing.map(m => `Evidence: ${m.replace(/_/g, " ")}`));
    } else rules.push({ rule: `method:${method}`, outcome: "pass", basis: "Required method evidence recorded" });
  }

  // 7. Evidence base.
  if (!f.claims.total && !f.siteScreen.done) { state = worst(state, "insufficient_evidence"); outstanding.push("Any sourced evidence (claims with sources, site screen)"); }

  if (state === "eligible" && (outstanding.length || findings.some(x => x.kind === "uncertainty"))) state = "conditionally_eligible";
  if (classification === "restricted_excluded") state = worst(state, "excluded");

  const confidence: "low" | "medium" | "high" = f.claims.verified + f.claims.sourced >= 4 && f.siteScreen.done >= 6 && f.exactLocation ? "high" : (f.claims.total || f.siteScreen.done) && f.exactLocation ? "medium" : "low";
  const concerns = findings.filter(x => x.kind === "concern").length;
  const positives = findings.filter(x => x.kind === "positive").length;
  const readings: Reading[] = [
    { key: "commercial_readiness", label: "Commercial readiness", value: f.readiness.label, basis: f.readiness.blocking.length ? `Blocking: ${f.readiness.blocking.join(", ")}` : "Sector readiness rubric" },
    { key: "regenerative_potential", label: "Regenerative potential", value: classification === "regenerative_core" && !concerns ? "Strong (regenerative-core method, no concerns found)" : classification === "regenerative_core" ? "Present, conditional on resolving concerns" : classification === "transition_enabling" ? "Transition / enabling" : classification === "restricted_excluded" ? "None (excluded)" : "Depends on redesign", basis: sector ? `Sector method ${sector.method}${positives ? `; ${positives} positive finding(s)` : ""}` : "Sector not recorded" },
    { key: "es_risk", label: "Environmental & social risk", value: state === "excluded" ? "Unacceptable" : concerns >= 3 ? "High" : concerns ? "Elevated" : f.exactLocation && f.spatial.checked ? "No material concerns found" : "Unknown (not screened)", basis: `${concerns} concern(s); IFC PS1–8 categories` },
    { key: "strategic_alignment", label: "Strategic alignment", value: f.regeneraSector && f.country && policy.priorityCountries.includes(f.country) ? "Strong (core sector, priority geography)" : f.regeneraSector ? "Core sector" : "Outside core sectors", basis: `Sector ${f.sectorKey ?? "not recorded"} · country ${f.country ?? "not recorded"}` },
    { key: "evidence_confidence", label: "Evidence confidence", value: confidence === "high" ? "High" : confidence === "medium" ? "Medium" : "Low", basis: `${f.claims.verified} verified, ${f.claims.sourced} source-provided, ${f.claims.inferred} inferred claims; ${f.siteScreen.done} site-screen stages` },
    { key: "implementation_feasibility", label: "Implementation feasibility", value: f.readiness.blocking.length ? "Blocked until critical gaps close" : f.readiness.reading === "insufficient_evidence" ? "Unknown" : "Plausible on current evidence", basis: `${f.eligibleFunding} eligible funding match(es)` },
    { key: "additionality", label: "Additionality potential", value: state === "excluded" ? "None" : f.readiness.workPackages.length ? `Clear: Regenera can close ${f.readiness.workPackages.length} readiness gap(s)` : concerns ? "Redesign advisory" : "Limited (project already advanced)", basis: f.readiness.workPackages.join(", ") || "No open work packages" },
  ];
  return { classification, state, rules, findings, outstanding: [...new Set(outstanding)], remediation: [...new Set(remediation)], confidence, readings, method };
}
