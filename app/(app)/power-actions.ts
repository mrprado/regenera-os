"use server";

// Power stack: PPAs, grid interconnection, storage specifications and large loads.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { gridConnections, largeLoads, ppas, projects, storageSpecs } from "@/db/schema";
import type { PpaCondition } from "@/db/power";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { ALLOCATION, CHEMISTRIES, CONFIDENCE, LOAD_STAGES, LOAD_TYPES, PPA_CONDITIONS, PPA_STATUS, PPA_TYPES, PROCUREMENT, PROFILES, REDUNDANCY, RISKS, STORAGE_SERVICES, STUDY_STAGES, TRISTATE } from "@/lib/power/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 600) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const cur = (f: FormData, dflt = "USD") => z.string().regex(/^[A-Z]{3}$/).catch(dflt).parse(str(f, "currency", 3).toUpperCase());
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const tab = (projectId: string, sec: string) => `/projects/${projectId}?tab=power&sec=${sec}`;

async function scopedProject(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}

export async function savePpaAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const ppaId = zId.safeParse(formData.get("ppaId")).data;
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const riskAllocation = Object.fromEntries(Object.keys(RISKS).map(k => [k, z.enum(keys(ALLOCATION)).catch("unknown").parse(formData.get(`risk_${k}`))]));
    const tri = (k: string) => z.enum(keys(TRISTATE)).catch("unknown").parse(formData.get(k));
    const conditions: PpaCondition[] = PPA_CONDITIONS.map(c => ({ condition: c, status: z.enum(["open", "satisfied", "waived"]).catch("open").parse(formData.get(`cond_${c}`)) })).filter(c => formData.get(`cond_${c.condition}`) !== "na");
    const values = {
      name: str(formData, "name", 160) || "PPA", type: z.enum(keys(PPA_TYPES)).parse(formData.get("type")), status: z.enum(keys(PPA_STATUS)).catch("prospect").parse(formData.get("status")),
      buyerName: str(formData, "buyerName", 200), guarantorName: str(formData, "guarantorName", 200), generatorEntity: str(formData, "generatorEntity", 200),
      contractedMw: num(formData, "contractedMw"), contractedMwhYear: num(formData, "contractedMwhYear"), startDate: date(formData, "startDate"), termYears: num(formData, "termYears"),
      price: num(formData, "price"), escalationPct: num(formData, "escalationPct"), indexation: str(formData, "indexation", 200), currency: cur(formData, p.currency ?? "USD"),
      deliveryNode: str(formData, "deliveryNode", 120), settlementNode: str(formData, "settlementNode", 120), profile: z.enum(keys(PROFILES)).catch("unknown").parse(formData.get("profile")), volumeCommitment: str(formData, "volumeCommitment", 300),
      riskAllocation, credit: { rating: str(formData, "rating", 10), ratingAgency: str(formData, "ratingAgency", 40), lc: str(formData, "lc", 200), guarantee: str(formData, "guarantee", 200), deposit: str(formData, "deposit", 200), terminationPayment: str(formData, "terminationPayment", 300) },
      lenderRights: { assignment: tri("assignment"), stepIn: tri("stepIn"), directAgreement: tri("directAgreement") }, conditions, signedDate: date(formData, "signedDate"), notes: str(formData, "notes", 1000), updatedAt: new Date().toISOString(),
    };
    if (ppaId) {
      await appDb().update(ppas).set(values).where(and(eq(ppas.id, ppaId), eq(ppas.projectId, projectId)));
      await audit(appDb(), { actor: user.email, action: "ppa.update", entity: "ppa", entityId: ppaId, after: { status: values.status } });
    } else {
      const [row] = await appDb().insert(ppas).values({ ...values, mandateId: p.mandateId, projectId, createdBy: user.email }).returning();
      await audit(appDb(), { actor: user.email, action: "ppa.create", entity: "ppa", entityId: row.id, after: { type: row.type, buyer: row.buyerName } });
    }
  });
  redirect(note(tab(projectId, "ppa"), "PPA saved. Bankability is reassessed from its terms."));
}

export async function saveGridAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const values = {
      operator: str(formData, "operator", 200), poi: str(formData, "poi", 200), voltageKv: num(formData, "voltageKv"), queueId: str(formData, "queueId", 80), applicationDate: date(formData, "applicationDate"),
      studyStage: z.enum(keys(STUDY_STAGES)).catch("none").parse(formData.get("studyStage")), requestedMw: num(formData, "requestedMw"), approvedMw: num(formData, "approvedMw"),
      direction: z.enum(["injection", "withdrawal", "both"]).catch("injection").parse(formData.get("direction")), networkUpgrades: str(formData, "networkUpgrades", 600), upgradeCost: num(formData, "upgradeCost"),
      costAllocation: str(formData, "costAllocation", 300), securityDeposit: num(formData, "securityDeposit"), currency: cur(formData, p.currency ?? "USD"), curtailmentRisk: str(formData, "curtailmentRisk", 300),
      transmissionConstraints: str(formData, "transmissionConstraints", 600), targetEnergization: date(formData, "targetEnergization"), dependencies: str(formData, "dependencies", 600), evidence: str(formData, "evidence", 300), updatedAt: new Date().toISOString(),
    };
    const [existing] = await appDb().select({ id: gridConnections.id }).from(gridConnections).where(eq(gridConnections.projectId, projectId));
    if (existing) await appDb().update(gridConnections).set(values).where(eq(gridConnections.id, existing.id));
    else await appDb().insert(gridConnections).values({ ...values, mandateId: p.mandateId, projectId, createdBy: user.email });
    await audit(appDb(), { actor: user.email, action: "grid.save", entity: "project", entityId: projectId, after: { stage: values.studyStage, requestedMw: values.requestedMw } });
  });
  redirect(note(tab(projectId, "grid"), "Interconnection saved."));
}

export async function saveStorageAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Storage specification saved.";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const powerMw = num(formData, "powerMw"), energyMwh = num(formData, "energyMwh");
    if (!powerMw || !energyMwh) { msg = "Power (MW) and energy (MWh) are required."; return; }
    const aug = str(formData, "augmentation", 600).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).map(x => { const m = /^y?(\d+)\s*[:=]\s*([\d.]+)\s*(?:@\s*([\d.]+))?$/i.exec(x); if (!m) throw new Error(`Augmentation "${x}" should look like 10:60@150 (year:MWh@$/kWh)`); return { year: Number(m[1]), mwh: Number(m[2]), costPerKwh: Number(m[3] ?? 0) }; });
    const services = Object.keys(STORAGE_SERVICES).map(k => ({ service: k, sharePct: num(formData, `svc_${k}`) ?? 0, contracted: formData.get(`svcc_${k}`) === "on" })).filter(x => x.sharePct > 0);
    const values = {
      name: str(formData, "name", 120) || "Storage", chemistry: z.enum(keys(CHEMISTRIES)).catch("lfp").parse(formData.get("chemistry")), powerMw, energyMwh, cyclesPerYear: num(formData, "cyclesPerYear"),
      roundTripPct: num(formData, "roundTripPct"), degradationPctYear: num(formData, "degradationPctYear"), usefulLifeYears: num(formData, "usefulLifeYears"), augmentation: aug, warrantyYears: num(formData, "warrantyYears"),
      thermalManagement: str(formData, "thermalManagement", 200), fireSuppression: str(formData, "fireSuppression", 200), ems: str(formData, "ems", 200), pcs: str(formData, "pcs", 200),
      capexPerKwh: num(formData, "capexPerKwh"), capexPerKw: num(formData, "capexPerKw"), fixedOmPerKwYear: num(formData, "fixedOmPerKwYear"), chargingCostPerMwh: num(formData, "chargingCostPerMwh"), currency: cur(formData, p.currency ?? "USD"),
      services, costSource: str(formData, "costSource", 300), updatedAt: new Date().toISOString(),
    };
    const sid = zId.safeParse(formData.get("storageId")).data;
    if (sid) await appDb().update(storageSpecs).set(values).where(and(eq(storageSpecs.id, sid), eq(storageSpecs.projectId, projectId)));
    else await appDb().insert(storageSpecs).values({ ...values, mandateId: p.mandateId, projectId, createdBy: user.email });
    await audit(appDb(), { actor: user.email, action: "storage.save", entity: "project", entityId: projectId, after: { powerMw, energyMwh } });
  });
  redirect(note(tab(projectId, "storage"), msg));
}

export async function saveLoadAction(formData: FormData) {
  const loadId = zId.safeParse(formData.get("loadId")).data;
  let id = loadId ?? "";
  await withOsUser(async user => {
    const values = {
      name: str(formData, "name", 200), type: z.enum(keys(LOAD_TYPES)).parse(formData.get("type")), stage: z.enum(keys(LOAD_STAGES)).catch("prospect").parse(formData.get("stage")),
      country: str(formData, "country", 60) || null, region: str(formData, "region", 120), lat: num(formData, "lat"), lng: num(formData, "lng"), mw: num(formData, "mw"), mwhYear: num(formData, "mwhYear"),
      loadFactorPct: num(formData, "loadFactorPct"), redundancy: z.enum(keys(REDUNDANCY)).catch("unknown").parse(formData.get("redundancy")), uptimePct: num(formData, "uptimePct"), renewableTargetPct: num(formData, "renewableTargetPct"),
      carbonTarget: str(formData, "carbonTarget", 300), energizationDate: date(formData, "energizationDate"), procurement: formData.getAll("procurement").map(String).filter(x => x in PROCUREMENT), ramp: str(formData, "ramp", 300),
      waterNeeds: str(formData, "waterNeeds", 300), source: str(formData, "source", 300), sourceUrl: str(formData, "sourceUrl", 500) || null, confidence: z.enum(keys(CONFIDENCE)).catch("unknown").parse(formData.get("confidence")),
      asOf: date(formData, "asOf"), isDemo: /^DEMO\b/.test(str(formData, "name", 200)) ? "yes" : "no", notes: str(formData, "notes", 1000), updatedAt: new Date().toISOString(),
    };
    if (!values.name) throw new Error("Name required");
    if (loadId) {
      await appDb().update(largeLoads).set(values).where(and(eq(largeLoads.id, loadId), mandateCondition(user.scope, largeLoads.mandateId)));
    } else {
      const [row] = await appDb().insert(largeLoads).values({ ...values, mandateId: user.scope.mandateIds[0], createdBy: user.email }).returning();
      id = row.id;
    }
    await audit(appDb(), { actor: user.email, action: "large_load.save", entity: "large_load", entityId: id, after: { name: values.name, mw: values.mw } });
  });
  redirect(note(`/power?load=${id}`, "Large load saved. Matching generation is listed below with the reason for each dimension."));
}
