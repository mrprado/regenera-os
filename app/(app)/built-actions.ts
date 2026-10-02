"use server";

// Built Environment actions. Every record is re-loaded through the user's workspace scope. Sustainability wording is
// checked against recorded claims; governed knowledge needs its custodian, access state and consent fields.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { beCompanyProfiles, beKnowledge, beMatches, beMaterials, beSignals, beTechnologies, mandates, networkProfiles, organizations, projectAttributes, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { createPartnership, rfiFromMatch, runBuiltIntelligence, setMatchStatus } from "@/lib/built/engine";
import { guardedClaimIssues } from "@/lib/built/fit";
import { seedBuiltDemo } from "@/lib/built/seed";
import { CLAIM_STATES, CLIMATES, ENGAGEMENT_KINDS, FEE_MODELS, HAZARDS, IMPORTANCE, KNOWLEDGE_ACCESS, MATURITY, PROJECT_TYPES, REGIONS, REL_STATUSES, SIGNAL_TYPES, TAXONOMY } from "@/lib/built/vocab";

const zId = z.string().uuid();
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const list = (f: FormData, k: string) => str(f, k, 1000).split(/[,;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 30);
const pick = <T extends Record<string, unknown>>(f: FormData, k: string, o: T) => f.getAll(k).map(String).filter(v => v in o);
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const back = (f: FormData, fallback: string) => z.string().startsWith("/").catch(fallback).parse(f.get("back") || fallback);
const errText = (e: unknown) => (e instanceof z.ZodError ? "Check the form: a required field is missing or invalid." : e instanceof Error ? e.message : "Something went wrong.");
type Scope = Parameters<typeof mandateCondition>[0];

async function projectIn(scope: Scope, id: string) {
  const [p] = await appDb().select({ id: projects.id, mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}
async function orgIn(scope: Scope, id: string) {
  const [o] = await appDb().select({ id: organizations.id, mandateId: organizations.mandateId }).from(organizations).where(and(eq(organizations.id, id), mandateCondition(scope, organizations.mandateId)));
  if (!o) throw new Error("Organization not found");
  return o;
}

export async function runBuiltAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "";
  try { await withOsUser(async user => { await projectIn(user.scope, projectId); const r = await runBuiltIntelligence(appDb(), projectId, user.email); msg = `Solution stack built: ${r.stack.reduce((a, g) => a + g.items.length, 0)} recommendation(s) across ${r.stack.length} categories. Climate: ${r.site.climateBasis}.`; }); } catch (e) { msg = errText(e); }
  redirect(note(back(formData, `/projects/${projectId}?tab=built`), msg));
}

export async function matchStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Updated.";
  try {
    await withOsUser(async user => {
      const [m] = await appDb().select({ id: beMatches.id }).from(beMatches).where(and(eq(beMatches.id, id), mandateCondition(user.scope, beMatches.mandateId)));
      if (!m) throw new Error("Recommendation not found");
      await setMatchStatus(appDb(), id, z.enum(["suggested", "shortlisted", "rejected"]).parse(formData.get("status")), user.email);
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/intelligence/built?tab=fit"), msg));
}

export async function rfiFromMatchAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let target = "/intelligence/built?tab=procurement", msg = "";
  try {
    await withOsUser(async user => {
      const [m] = await appDb().select({ id: beMatches.id }).from(beMatches).where(and(eq(beMatches.id, id), mandateCondition(user.scope, beMatches.mandateId)));
      if (!m) throw new Error("Recommendation not found");
      const pkg = await rfiFromMatch(appDb(), id, user.email);
      target = `/projects/${pkg.projectId}?tab=procurement&pkg=${pkg.id}`;
      msg = "RFI opened in the project's procurement pipeline with the providers invited. Compare responses criterion by criterion there.";
    });
  } catch (e) { msg = errText(e); }
  redirect(note(target, msg));
}

export async function createPartnershipAction(formData: FormData) {
  let dealId = "", msg = "";
  const b = back(formData, "/intelligence/built?tab=partnerships");
  try {
    await withOsUser(async user => {
      const o = await orgIn(user.scope, zId.parse(formData.get("orgId")));
      const projectIds = formData.getAll("projectIds").map(String).filter(x => zId.safeParse(x).success);
      if (projectIds.length) { const ok = await appDb().select({ id: projects.id }).from(projects).where(and(inArray(projects.id, projectIds), mandateCondition(user.scope, projects.mandateId))); if (ok.length !== projectIds.length) throw new Error("Project not found"); }
      const r = await createPartnership(appDb(), { mandateId: o.mandateId, orgId: o.id, title: z.string().trim().min(3).max(200).parse(formData.get("title")), kinds: pick(formData, "kinds", ENGAGEMENT_KINDS), projectIds, feeModels: pick(formData, "feeModels", FEE_MODELS), regeneraAssets: str(formData, "regeneraAssets", 1000), signalId: zId.safeParse(formData.get("signalId")).data ?? null }, user.email);
      dealId = r.dealId;
    });
  } catch (e) { msg = errText(e); }
  redirect(dealId ? note(`/deals/${dealId}`, "Partnership opportunity created as a deal with an outreach task. Fee compliance is Unknown until reviewed; success fees need legal review.") : note(b, msg));
}

export async function saveSignalAction(formData: FormData) {
  let msg = "Signal recorded with its source.";
  try {
    await withOsUser(async user => {
      const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
      const org = orgId ? await orgIn(user.scope, orgId) : null;
      const source = z.string().trim().min(3).max(300).parse(formData.get("source"));
      await appDb().insert(beSignals).values({ mandateId: org?.mandateId ?? user.scope.mandateIds[0], date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get("date")), orgId, entity: str(formData, "entity", 200) || "—", type: z.enum(keys(SIGNAL_TYPES)).parse(formData.get("type")), summary: z.string().trim().min(5).max(500).parse(formData.get("summary")), source, sourceUrl: z.string().url().max(1000).nullable().catch(null).parse(formData.get("sourceUrl") || null), region: z.enum(keys(REGIONS)).nullable().catch(null).parse(formData.get("region") || null), importance: z.enum(keys(IMPORTANCE)).catch("medium").parse(formData.get("importance")), why: str(formData, "why", 500), suggestedAction: str(formData, "suggestedAction", 300), origin: "user_entered" });
      await audit(appDb(), { actor: user.email, action: "built_signal_add", entity: "be_signals", entityId: orgId ?? "" });
    });
  } catch (e) { msg = errText(e); }
  redirect(note("/intelligence/built?tab=signals", msg));
}

export async function saveCompanyProfileAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  let msg = "Profile saved.";
  try {
    await withOsUser(async user => {
      const o = await orgIn(user.scope, orgId);
      const summary = str(formData, "summary", 2000);
      const claims = await appDb().select({ claim: projectAttributes.claim, verification: projectAttributes.verification }).from(projectAttributes).where(and(eq(projectAttributes.subjectType, "company"), eq(projectAttributes.subjectId, orgId)));
      const guarded = guardedClaimIssues(summary, claims);
      if (guarded.length) throw new Error(`"${guarded.join('", "')}" needs a recorded, non-unverified claim with its source before it can describe this company.`);
      const v = {
        taxonomy: pick(formData, "taxonomy", TAXONOMY), subsectors: list(formData, "subsectors"), operatingRegions: pick(formData, "regions", REGIONS), buildingSegments: pick(formData, "segments", PROJECT_TYPES), maturity: z.enum(keys(MATURITY)).catch("pilot").parse(formData.get("maturity")),
        summary, problemSolved: str(formData, "problemSolved", 1000), relationshipStatus: z.enum(keys(REL_STATUSES)).catch("none").parse(formData.get("relationshipStatus")), relationshipOwner: str(formData, "relationshipOwner", 200) || null,
        nextAction: str(formData, "nextAction", 300) || null, nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null).parse(formData.get("nextActionDate") || null), fundingStage: str(formData, "fundingStage", 40) || null, latestRound: str(formData, "latestRound", 120),
        investorNames: list(formData, "investorNames"), certifications: list(formData, "certifications"), sourceUrl: z.string().url().max(1000).nullable().catch(null).parse(formData.get("sourceUrl") || null), updatedAt: new Date().toISOString(),
      };
      const [existing] = await appDb().select({ id: beCompanyProfiles.id }).from(beCompanyProfiles).where(and(eq(beCompanyProfiles.orgId, orgId), eq(beCompanyProfiles.mandateId, o.mandateId)));
      if (existing) await appDb().update(beCompanyProfiles).set(v).where(eq(beCompanyProfiles.id, existing.id));
      else await appDb().insert(beCompanyProfiles).values({ mandateId: o.mandateId, orgId, ...v, origin: "user_entered" });
      await audit(appDb(), { actor: user.email, action: "built_profile_save", entity: "be_company_profiles", entityId: orgId });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, `/intelligence/built?tab=companies&open=${orgId}`), msg));
}

export async function addTechnologyAction(formData: FormData) {
  let msg = "Technology recorded.";
  try {
    await withOsUser(async user => {
      const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
      const o = orgId ? await orgIn(user.scope, orgId) : null;
      await appDb().insert(beTechnologies).values({ mandateId: o?.mandateId ?? user.scope.mandateIds[0], orgId, name: z.string().trim().min(2).max(200).parse(formData.get("name")), category: z.enum(keys(TAXONOMY)).parse(formData.get("category")), subcategory: str(formData, "subcategory", 120), maturity: z.enum(keys(MATURITY)).catch("pilot").parse(formData.get("maturity")), trl: z.number().int().min(1).max(9).nullable().catch(null).parse(Number(formData.get("trl")) || null), climates: pick(formData, "climates", CLIMATES), hazards: pick(formData, "hazards", HAZARDS), buildingTypes: pick(formData, "buildingTypes", PROJECT_TYPES), effects: {}, origin: "user_entered", sourceUrl: z.string().url().max(1000).nullable().catch(null).parse(formData.get("sourceUrl") || null) });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/intelligence/built?tab=technologies"), msg));
}

export async function addMaterialAction(formData: FormData) {
  let msg = "Material recorded. Embodied carbon stays unverified until an EPD or a verified claim is attached.";
  try {
    await withOsUser(async user => {
      const supplier = zId.safeParse(formData.get("supplierOrgId")).data ?? null;
      const o = supplier ? await orgIn(user.scope, supplier) : null;
      await appDb().insert(beMaterials).values({ mandateId: o?.mandateId ?? user.scope.mandateIds[0], name: z.string().trim().min(2).max(200).parse(formData.get("name")), family: z.string().trim().min(2).max(120).parse(formData.get("family")), supplierOrgId: supplier, origin: "user_entered", tags: formData.getAll("tags").map(String), climates: pick(formData, "climates", CLIMATES), hazards: pick(formData, "hazards", HAZARDS), originPlace: str(formData, "originPlace", 200), embodiedCarbonState: "unverified" });
    });
  } catch (e) { msg = errText(e); }
  redirect(note("/intelligence/built?tab=materials", msg));
}

export async function addClaimAction(formData: FormData) {
  let msg = "Claim recorded with its source and state.";
  const b = back(formData, "/intelligence/built");
  try {
    await withOsUser(async user => {
      const subjectType = z.enum(["company", "technology", "material"]).parse(formData.get("subjectType"));
      const subjectId = zId.parse(formData.get("subjectId"));
      const table = subjectType === "company" ? null : subjectType === "technology" ? beTechnologies : beMaterials;
      let mandateId: string;
      if (!table) mandateId = (await orgIn(user.scope, subjectId)).mandateId;
      else { const [r] = await appDb().select({ m: table.mandateId }).from(table).where(and(eq(table.id, subjectId), mandateCondition(user.scope, table.mandateId))); if (!r) throw new Error("Record not found"); mandateId = r.m; }
      const source = z.string().trim().min(3).max(300).parse(formData.get("source"));
      await appDb().insert(projectAttributes).values({ mandateId, subjectType, subjectId, attribute: str(formData, "attribute", 60) || "sustainability", claim: z.string().trim().min(3).max(500).parse(formData.get("claim")), source, methodology: str(formData, "methodology", 500), scope: str(formData, "scope", 200), verification: z.enum(keys(CLAIM_STATES)).catch("unverified").parse(formData.get("verification")), verifier: str(formData, "verifier", 200) || null, claimDate: str(formData, "date", 10) || null, confidence: z.enum(["high", "moderate", "low", "unknown"]).catch("unknown").parse(formData.get("confidence")), createdBy: user.email });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(b, msg));
}

export async function qualifySupplierAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  let msg = "Supplier qualification saved.";
  try {
    await withOsUser(async user => {
      const o = await orgIn(user.scope, orgId);
      const v = { approvedStatus: z.enum(["not_assessed", "in_review", "approved", "conditional", "not_approved"]).parse(formData.get("approvedStatus")), technicalQualification: str(formData, "technical", 500), financialQualification: str(formData, "financial", 500), insurance: str(formData, "insurance", 300), certifications: list(formData, "certifications"), references: str(formData, "references", 500), warranty: str(formData, "warranty", 200), deliveryTime: str(formData, "deliveryTime", 120), paymentTerms: str(formData, "paymentTerms", 120), pricingNote: str(formData, "pricingNote", 300), updatedAt: new Date().toISOString() };
      const [np] = await appDb().select({ id: networkProfiles.id }).from(networkProfiles).where(and(eq(networkProfiles.orgId, orgId), eq(networkProfiles.mandateId, o.mandateId)));
      if (np) await appDb().update(networkProfiles).set(v).where(eq(networkProfiles.id, np.id));
      else await appDb().insert(networkProfiles).values({ mandateId: o.mandateId, orgId, roles: ["supplier"], ...v });
      await audit(appDb(), { actor: user.email, action: "supplier_qualify", entity: "network_profiles", entityId: orgId, after: { status: v.approvedStatus } });
    });
  } catch (e) { msg = errText(e); }
  redirect(note(back(formData, "/intelligence/built?tab=procurement"), msg));
}

export async function saveKnowledgeAction(formData: FormData) {
  let msg = "Governed record saved. It is not searchable and never reaches Ask the OS or MCP.";
  try {
    await withOsUser(async user => {
      const access = z.enum(keys(KNOWLEDGE_ACCESS)).parse(formData.get("access"));
      const community = str(formData, "community", 200), custodian = str(formData, "custodian", 200);
      if (!community && !custodian && access !== "public") throw new Error("Name the community or custodian: governed knowledge needs its holder.");
      await appDb().insert(beKnowledge).values({ mandateId: user.scope.mandateIds[0], title: z.string().trim().min(3).max(200).parse(formData.get("title")), knowledgeType: str(formData, "knowledgeType", 120) || "other", summary: str(formData, "summary", 2000), community: community || null, custodian: custodian || null, knowledgeHolder: str(formData, "knowledgeHolder", 200) || null, geographicContext: str(formData, "geographicContext", 300), culturalContext: str(formData, "culturalContext", 500), access, consentStatus: z.enum(["not_requested", "requested", "granted", "refused", "withdrawn"]).catch("not_requested").parse(formData.get("consentStatus")), authorizedUse: str(formData, "authorizedUse", 500), commercialUse: formData.get("commercialUse") === "on", publication: formData.get("publication") === "on", digitization: formData.get("digitization") === "on", attribution: str(formData, "attribution", 300), benefitSharingRequired: formData.get("benefitSharingRequired") !== "off", benefitSharing: str(formData, "benefitSharing", 500), restrictions: str(formData, "restrictions", 500), reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null).parse(formData.get("reviewDate") || null), source: str(formData, "source", 300), createdBy: user.email });
      await audit(appDb(), { actor: user.email, action: "governed_knowledge_add", entity: "be_knowledge" });
    }, { internal: true });
  } catch (e) { msg = errText(e); }
  redirect(note("/intelligence/built?tab=materials#knowledge", msg));
}

/** Loads the built-environment sample into an existing demo workspace (idempotent). */
export async function loadBuiltDemoAction() {
  let msg = "Built-environment sample data loaded into the DEMO workspace.";
  try {
    await withOsUser(async user => {
      const [m] = await appDb().select({ id: mandates.id }).from(mandates).where(eq(mandates.id, "mandate_demo"));
      if (!m || !user.scope.mandateIds.includes("mandate_demo")) throw new Error("Load the DEMO workspace first (Settings → Demo data).");
      const [have] = await appDb().select({ id: beCompanyProfiles.id }).from(beCompanyProfiles).where(eq(beCompanyProfiles.mandateId, "mandate_demo")).limit(1);
      if (have) { msg = "Sample data is already loaded."; return; }
      const ps = await appDb().select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.mandateId, "mandate_demo"), isNull(projects.archivedAt)));
      const order = ["Yucatán Eco Park", "Mexico Solar", "New Zealand", "Africa Energy"].map(n => ps.find(p => p.name.includes(n))?.id).filter((x): x is string => !!x);
      await seedBuiltDemo(appDb(), "mandate_demo", order.length ? order : ps.map(p => p.id));
      await audit(appDb(), { actor: user.email, action: "built_demo_load", entity: "mandates", entityId: "mandate_demo" });
    }, { owner: true, internal: true });
  } catch (e) { msg = errText(e); }
  redirect(note("/intelligence/built", msg));
}
