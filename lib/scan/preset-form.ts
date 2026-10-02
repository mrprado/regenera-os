// Scan preset form <-> configuration (phase 16 §2). Pure, so save → reload → run is testable as a round trip. Every
// supported setting is carried; nothing is silently truncated or dropped: an over-long field, an unreadable number or an
// unknown country is returned as a named error and the form keeps what the person typed.
import { audience } from "./audiences";
import { configProblems, SCAN_PROVIDERS, SCAN_SECTIONS, zScanConfig, type ScanConfig, type ScanProvider, type ScanSection } from "./config";
import { parseGeography } from "./countries";

/** Visible character limits; the inputs show them (maxLength) and the server enforces the same numbers. */
export const PRESET_LIMITS = { name: 120, note: 500, geography: 4000, terms: 2000, excludeTerms: 2000, titles: 1000, seniorities: 300, signalCriteria: 1000, capabilities: 1000, stages: 500, sector: 120, sizeUnit: 20 } as const;

export type PresetFormValues = Record<string, string | string[]>;
export type PresetParse =
  | { ok: true; name: string; section: ScanSection; note: string; config: ScanConfig }
  | { ok: false; errors: string[] };

const list = (s: string) => s.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
const LABEL: Record<string, string> = { name: "Name", note: "Note", geography: "Geography", terms: "Organization terms", excludeTerms: "Exclusions", titles: "Decision-maker titles", seniorities: "Seniorities", signalCriteria: "Buying events", capabilities: "Capabilities", stages: "Stages", sector: "Sector", sizeUnit: "Size unit" };

/** Reads a FormData (or plain record) into a preset. Errors name the field and the limit. */
export function presetFromForm(form: FormData | PresetFormValues): PresetParse {
  const get = (k: string): string => {
    const v = form instanceof FormData ? form.get(k) : form[k];
    return typeof v === "string" ? v.trim() : Array.isArray(v) ? v.join(", ") : "";
  };
  const getAll = (k: string): string[] => (form instanceof FormData ? form.getAll(k).map(String) : ([] as string[]).concat(form[k] ?? []));
  const errors: string[] = [];
  const text = (k: keyof typeof PRESET_LIMITS) => {
    const v = get(k);
    if (v.length > PRESET_LIMITS[k]) errors.push(`${LABEL[k]} is ${v.length} characters; the limit is ${PRESET_LIMITS[k]}. Shorten it (nothing was saved).`);
    return v;
  };
  const num = (k: string, label: string, opts: { int?: boolean; min?: number; max?: number } = {}): number | undefined => {
    const v = get(k);
    if (!v) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || (opts.int && !Number.isInteger(n)) || (opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) {
      errors.push(`${label} must be ${opts.int ? "a whole number" : "a number"}${opts.min != null ? ` from ${opts.min}` : ""}${opts.max != null ? ` to ${opts.max}` : ""} (got "${v}").`);
      return undefined;
    }
    return n;
  };

  const name = text("name");
  if (name.length < 3) errors.push("Name needs at least 3 characters.");
  const sectionRaw = get("section");
  const section = (sectionRaw in SCAN_SECTIONS ? sectionRaw : "") as ScanSection;
  if (!section) errors.push("Choose a section.");
  const mode = get("mode") === "opportunities" ? "opportunities" : "organizations";
  const aud = get("audience") || (mode === "opportunities" ? "objective" : "");
  if (mode === "organizations" && !audience(aud)) errors.push("Choose the audience to search for.");

  // Picker selections (one canonical code or region key per value) plus anything pasted into the free-text box.
  const geoText = [...getAll("geography"), get("geographyText")].map(x => x.trim()).filter(Boolean).join(", ");
  if (geoText.length > PRESET_LIMITS.geography) errors.push(`Geography is ${geoText.length} characters; the limit is ${PRESET_LIMITS.geography}.`);
  const { geography, unknown } = parseGeography(geoText);
  if (unknown.length) errors.push(`Geography not recognized: ${unknown.join(", ")}. Use a country name, ISO code or region; nothing was saved.`);

  const providers = getAll("providers").filter(p => p in SCAN_PROVIDERS) as ScanProvider[];
  const draft = {
    mode, audience: aud, objectiveId: get("objectiveId") || undefined, geography,
    sector: text("sector") || undefined,
    terms: list(text("terms")), excludeTerms: list(text("excludeTerms")),
    audienceExclusions: get("audienceExclusions") === "ignore" ? "ignore" : "apply",
    headcountMin: num("headcountMin", "Minimum headcount", { int: true, min: 0 }), headcountMax: num("headcountMax", "Maximum headcount", { int: true, min: 1 }),
    titles: list(text("titles")), seniorities: list(text("seniorities")), signalCriteria: text("signalCriteria"),
    freshnessDays: num("freshnessDays", "Freshness (days)", { int: true, min: 1, max: 3650 }),
    providers,
    capabilities: list(text("capabilities")),
    sizeMin: num("sizeMin", "Minimum size", { min: 0 }) ?? null, sizeMax: num("sizeMax", "Maximum size", { min: 0 }) ?? null, sizeUnit: text("sizeUnit") || null,
    stages: list(text("stages")),
    maxOrganizations: num("maxOrganizations", "Maximum new organizations", { int: true, min: 1, max: 500 }),
    maxPeoplePerOrg: num("maxPeoplePerOrg", "People per organization", { int: true, min: 0, max: 10 }),
    researchBudgetUsd: num("researchBudgetUsd", "Research budget (USD)", { min: 0, max: 50 }),
    // Not choices: scans never enrich contacts, always merge on strong identifiers only and always need human review.
    enrichmentBudget: 0, dedupe: "merge_strong_ids", requireReview: true,
  };
  const note = text("note");
  if (errors.length) return { ok: false, errors };
  const parsed = zScanConfig.safeParse(Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined)));
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join(".") || "Configuration"}: ${i.message}`) };
  const problems = configProblems(parsed.data);
  if (problems.length) return { ok: false, errors: problems };
  return { ok: true, name, section, note, config: parsed.data };
}

/** Form values for an existing configuration (edit and reload). presetFromForm(presetFormValues(x)) returns x. */
export function presetFormValues(p: { name: string; section: string; note: string; config: ScanConfig }): PresetFormValues {
  const c = p.config;
  const s = (n: number | null | undefined) => (n == null ? "" : String(n));
  return {
    name: p.name, section: p.section, note: p.note, mode: c.mode, audience: c.audience, objectiveId: c.objectiveId ?? "",
    geography: c.geography, sector: c.sector ?? "", terms: c.terms.join(", "), excludeTerms: c.excludeTerms.join(", "), audienceExclusions: c.audienceExclusions,
    headcountMin: s(c.headcountMin), headcountMax: s(c.headcountMax), titles: c.titles.join(", "), seniorities: c.seniorities.join(", "), signalCriteria: c.signalCriteria,
    freshnessDays: s(c.freshnessDays), providers: c.providers, capabilities: c.capabilities.join(", "), sizeMin: s(c.sizeMin), sizeMax: s(c.sizeMax), sizeUnit: c.sizeUnit ?? "",
    stages: c.stages.join(", "), maxOrganizations: s(c.maxOrganizations), maxPeoplePerOrg: s(c.maxPeoplePerOrg), researchBudgetUsd: s(c.researchBudgetUsd),
  };
}

/** Preset key from its name: saving under the same name updates that preset; a new name makes a new one. */
export const presetKey = (name: string) => `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50)}`;
