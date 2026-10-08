import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";
import { capitalFit } from "@/lib/integrity/capital-fit";
import { spatialChecks } from "@/lib/integrity/engine";
import { evaluateIntegrity, type IntegrityFacts } from "@/lib/integrity/evaluate";
import { POLICY_V1 } from "@/lib/integrity/policy";
import { compareVariant, REDESIGN_OPTIONS } from "@/lib/integrity/redesign";

const base = (over: Partial<IntegrityFacts> = {}): IntegrityFacts => ({
  name: "Hardap Solar", text: "Hardap 50 MW Solar PV", sectorKey: "energy", country: "NAM", stage: "screening", exactLocation: true,
  spatial: { checked: true, protectedOverlap: false, protectedNearestKm: null, wetlandOverlap: false, forestOverlap: false, settlementOverlap: false, source: "fixture" },
  water: { stress: null, source: "" }, forestLoss: { value: null, source: "" },
  community: { recorded: 1, rightsOpen: 0, consent: [] }, sanctions: { possible: 0, confirmed: 0 },
  evidenceFields: [], claims: { verified: 2, sourced: 2, inferred: 0, total: 4 }, siteScreen: { done: 6, failed: 0 },
  readiness: { reading: "early", label: "Early stage", blocking: [], workPackages: ["grid"] }, eligibleFunding: 1, regeneraSector: true,
  ...over,
});

describe("evaluateIntegrity", () => {
  it("clean solar with evidence is eligible, regenerative core, seven readings", () => {
    const r = evaluateIntegrity(POLICY_V1, base());
    expect(r.classification).toBe("regenerative_core");
    expect(r.state).toBe("eligible");
    expect(r.readings).toHaveLength(7);
    expect(r.confidence).toBe("high");
  });

  it("is deterministic: same facts, same decision", () => {
    expect(evaluateIntegrity(POLICY_V1, base())).toEqual(evaluateIntegrity(POLICY_V1, base()));
  });

  it("protected-area overlap requires redesign; inside for a restoration method is a positive", () => {
    const solar = evaluateIntegrity(POLICY_V1, base({ spatial: { ...base().spatial, protectedOverlap: true, protectedNearestKm: 0 } }));
    expect(solar.state).toBe("redesign_required");
    expect(solar.classification).toBe("conditional_redesign");
    expect(solar.remediation.join(" ")).toMatch(/protected area/);
    const restore = evaluateIntegrity(POLICY_V1, base({ text: "Mangrove restoration and watershed conservation", spatial: { ...base().spatial, protectedOverlap: true, protectedNearestKm: 0 } }));
    expect(restore.classification).toBe("regenerative_core");
    expect(restore.state).toBe("eligible");
    expect(restore.findings.some(f => f.kind === "positive")).toBe(true);
  });

  it("protected area nearby triggers enhanced due diligence", () => {
    expect(evaluateIntegrity(POLICY_V1, base({ spatial: { ...base().spatial, protectedNearestKm: 0.4 } })).state).toBe("enhanced_due_diligence");
  });

  it("exclusions and confirmed sanctions exclude; possible sanctions and withheld consent go to human review", () => {
    expect(evaluateIntegrity(POLICY_V1, base({ text: "New coal-fired power station" })).state).toBe("excluded");
    expect(evaluateIntegrity(POLICY_V1, base({ sanctions: { possible: 0, confirmed: 1 } })).classification).toBe("restricted_excluded");
    expect(evaluateIntegrity(POLICY_V1, base({ sanctions: { possible: 1, confirmed: 0 } })).state).toBe("human_review");
    expect(evaluateIntegrity(POLICY_V1, base({ community: { recorded: 1, rightsOpen: 0, consent: ["withheld"] } })).state).toBe("human_review");
  });

  it("waste-to-energy is never regenerative by default: conditional with named evidence needs", () => {
    const r = evaluateIntegrity(POLICY_V1, base({ text: "Municipal waste-to-energy incineration plant" }));
    expect(r.classification).toBe("conditional_redesign");
    expect(r.state).toBe("enhanced_due_diligence");
    expect(r.outstanding).toEqual(expect.arrayContaining(["Evidence: feedstock", "Evidence: emissions"]));
    const proven = evaluateIntegrity(POLICY_V1, base({ text: "Municipal waste-to-energy incineration plant", evidenceFields: ["feedstock", "emissions", "residues", "technology"] }));
    expect(proven.classification).toBe("transition_enabling");
  });

  it("no exact location → insufficient evidence; water-intensive use in high stress → redesign", () => {
    expect(evaluateIntegrity(POLICY_V1, base({ exactLocation: false })).state).toBe("insufficient_evidence");
    expect(evaluateIntegrity(POLICY_V1, base({ text: "Hyperscale data centre campus", water: { stress: "Extremely high (>80%)", source: "Aqueduct" } })).state).toBe("redesign_required");
  });

  it("patterns use word boundaries (Amsterdam is not a dam, Windhoek is not wind)", () => {
    expect(evaluateIntegrity(POLICY_V1, base({ text: "Amsterdam rooftop solar" })).classification).toBe("regenerative_core");
    expect(evaluateIntegrity(POLICY_V1, base({ text: "Windhoek municipal waste-to-energy" })).classification).toBe("conditional_redesign");
  });
});

describe("spatialChecks", () => {
  const park = turf.polygon([[[17, -24], [17.1, -24], [17.1, -23.9], [17, -23.9], [17, -24]]]);
  const layers = { protected: turf.featureCollection([park]) };
  it("detects overlap of a point and a boundary, and distance when outside", () => {
    expect(spatialChecks(null, [17.05, -23.95], layers).protectedOverlap).toBe(true);
    const site = turf.polygon([[[17.09, -23.95], [17.2, -23.95], [17.2, -23.85], [17.09, -23.85], [17.09, -23.95]]]);
    expect(spatialChecks(site, null, layers).protectedOverlap).toBe(true);
    const out = spatialChecks(null, [17.105, -23.95], layers);
    expect(out.protectedOverlap).toBe(false);
    expect(out.protectedNearestKm!).toBeGreaterThan(0.3);
    expect(out.protectedNearestKm!).toBeLessThan(1);
  });
});

describe("compareVariant", () => {
  it("financial lines are assumptions without a screening model, modelled with one", () => {
    const opts = REDESIGN_OPTIONS.renewable;
    const a = compareVariant("regenerative", opts, false);
    expect(a.find(x => x.dimension === "Capital expenditure")!.basis).toBe("assumption");
    expect(compareVariant("regenerative", opts, true).find(x => x.dimension === "Capital expenditure")!.basis).toBe("modelled");
    expect(compareVariant("original", [], false).every(x => x.basis === "unknown")).toBe(true);
  });
});

describe("capitalFit", () => {
  it("blocked decisions and profile exclusions are never a fit; unscreened is unknown", () => {
    expect(capitalFit({}, null, "x").fit).toBe("unknown");
    expect(capitalFit({}, { state: "excluded", classification: "restricted_excluded" }, "x").fit).toBe("no");
    expect(capitalFit({ exclusions: ["incinerat"] }, { state: "eligible", classification: "transition_enabling" }, "Waste incineration").fit).toBe("no");
    expect(capitalFit({ safeguardStandard: "IFC PS" }, { state: "eligible", classification: "regenerative_core" }, "Solar").fit).toBe("possible");
    expect(capitalFit({}, { state: "redesign_required", classification: "conditional_redesign" }, "Solar").fit).toBe("conditional");
  });
});
