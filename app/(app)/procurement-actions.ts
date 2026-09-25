"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bids, boqItems, epds, networkProfiles, organizations, procurementPackages, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { awardBid } from "@/lib/procurement/engine";
import {
  BID_STATUSES, CIRCULARITY, CRITERIA, INCOTERMS, LCA_STAGES, MATERIAL_CATEGORIES, NETWORK_ROLES, PACKAGE_CATEGORIES, PACKAGE_STAGES, TRANSPORT_MODES,
  type Criterion, type LcaStage,
} from "@/lib/procurement/vocab";
import { ASSET_CLASSES } from "@/lib/projects/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const opt = (f: FormData, k: string, max = 300) => str(f, k, max) || null;
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const pct = (f: FormData, k: string) => { const n = num(f, k); return n === null ? null : Math.max(0, Math.min(100, n)); };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const pick = <T extends Record<string, string>>(o: T, f: FormData, k: string) => { const v = str(f, k); return (v in o ? v : null) as (keyof T & string) | null; };
const tabUrl = (id: string, tab: string) => `/projects/${id}?tab=${tab}`;
type Scope = Parameters<typeof mandateCondition>[0];

async function scopedProject(scope: Scope, id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}
async function scopedPackage(scope: Scope, id: string) {
  const [p] = await appDb().select().from(procurementPackages).where(and(eq(procurementPackages.id, id), mandateCondition(scope, procurementPackages.mandateId)));
  if (!p) throw new Error("Package not found");
  return p;
}
async function scopedBid(scope: Scope, id: string) {
  const [b] = await appDb().select().from(bids).where(and(eq(bids.id, id), mandateCondition(scope, bids.mandateId)));
  if (!b) throw new Error("Bid not found");
  return b;
}
async function scopedOrg(scope: Scope, id: string | null) {
  if (!id || !zId.safeParse(id).success) return null;
  const [o] = await appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.id, id), mandateCondition(scope, organizations.mandateId)));
  return o ?? null;
}

// Materials

export async function addBoqItemAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const material = z.string().trim().min(2).max(200).parse(formData.get("material"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    const epdId = str(formData, "epdId");
    if (epdId) {
      const [e] = await appDb().select({ id: epds.id }).from(epds).where(and(eq(epds.id, epdId), mandateCondition(user.scope, epds.mandateId)));
      if (!e) throw new Error("EPD not found");
    }
    await appDb().insert(boqItems).values({
      projectId: id, mandateId: p.mandateId, material, category: pick(MATERIAL_CATEGORIES, formData, "category") ?? "other", specification: str(formData, "specification", 500),
      quantity: num(formData, "quantity"), unit: opt(formData, "unit", 20), manufacturer: opt(formData, "manufacturer", 200), supplier: opt(formData, "supplier", 200),
      origin: opt(formData, "origin", 80), distanceKm: num(formData, "distanceKm"), transportMode: pick(TRANSPORT_MODES, formData, "transportMode"),
      unitCost: num(formData, "unitCost"), currency: opt(formData, "currency", 8) ?? p.currency ?? "USD", leadTimeWeeks: num(formData, "leadTimeWeeks"),
      recycledPct: pct(formData, "recycledPct"), biobasedPct: pct(formData, "biobasedPct"), epdId: epdId || null, serviceLifeYears: num(formData, "serviceLifeYears"),
      circularity: pick(CIRCULARITY, formData, "circularity") ?? "unknown", designForDisassembly: formData.get("designForDisassembly") === "on",
      endOfLife: str(formData, "endOfLife", 500), hazards: str(formData, "hazards", 500), certification: str(formData, "certification", 300),
    });
  });
  redirect(note(tabUrl(id, "materials"), "Material added."));
}

export async function updateBoqItemAction(formData: FormData) {
  const itemId = zId.parse(formData.get("itemId"));
  let projectId = "";
  await withOsUser(async user => {
    const [x] = await appDb().select().from(boqItems).where(and(eq(boqItems.id, itemId), mandateCondition(user.scope, boqItems.mandateId)));
    if (!x) throw new Error("Not found");
    projectId = x.projectId;
    const epdId = str(formData, "epdId");
    if (epdId) {
      const [e] = await appDb().select({ id: epds.id }).from(epds).where(and(eq(epds.id, epdId), mandateCondition(user.scope, epds.mandateId)));
      if (!e) throw new Error("EPD not found");
    }
    await appDb().update(boqItems).set({ epdId: epdId || null, quantity: formData.has("quantity") ? num(formData, "quantity") : x.quantity, circularity: pick(CIRCULARITY, formData, "circularity") ?? x.circularity, updatedAt: new Date().toISOString() }).where(eq(boqItems.id, x.id));
  });
  redirect(note(tabUrl(projectId, "materials"), "Material updated."));
}

export async function addEpdAction(formData: FormData) {
  const manufacturer = z.string().trim().min(2).max(200).parse(formData.get("manufacturer"));
  const product = z.string().trim().min(2).max(200).parse(formData.get("product"));
  const declaredUnit = z.string().trim().min(1).max(30).parse(formData.get("declaredUnit"));
  const back = str(formData, "back", 300).startsWith("/") ? str(formData, "back", 300) : "/network?tab=epds";
  await withOsUser(async user => {
    const gwp: Partial<Record<LcaStage, number>> = {};
    for (const s of Object.keys(LCA_STAGES) as LcaStage[]) { const v = num(formData, `gwp_${s}`); if (v !== null) gwp[s] = v; }
    if (gwp.a1a3 === undefined) throw new Error("A1–A3 GWP from the EPD is required");
    await appDb().insert(epds).values({
      mandateId: user.scope.mandateIds[0], manufacturer, product, category: pick(MATERIAL_CATEGORIES, formData, "category") ?? "other", declaredUnit, gwp,
      programOperator: str(formData, "programOperator", 120), registrationNumber: str(formData, "registrationNumber", 120), pcr: str(formData, "pcr", 200),
      geography: str(formData, "geography", 120), validFrom: date(formData, "validFrom"), validUntil: date(formData, "validUntil"),
      verified: formData.get("verified") === "on", verifier: opt(formData, "verifier", 120), url: opt(formData, "url", 500),
    });
  });
  redirect(note(back, "EPD added to the library."));
}

// Procurement

export async function addPackageAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  const category = z.enum(keys(PACKAGE_CATEGORIES)).parse(formData.get("category"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, id);
    await appDb().insert(procurementPackages).values({
      projectId: id, mandateId: p.mandateId, name, category, scope: str(formData, "scope", 3000), stage: pick(PACKAGE_STAGES, formData, "stage") ?? "need",
      budget: num(formData, "budget"), currency: opt(formData, "currency", 8) ?? p.currency ?? "USD", bidsDueAt: date(formData, "bidsDueAt"), awardTargetAt: date(formData, "awardTargetAt"),
      requiredOnSiteAt: date(formData, "requiredOnSiteAt"), esRequirements: str(formData, "esRequirements", 3000), localContentTargetPct: pct(formData, "localContentTargetPct"), owner: opt(formData, "owner", 120),
    });
  });
  redirect(note(tabUrl(id, "procurement"), "Package added."));
}

export async function updatePackageAction(formData: FormData) {
  const packageId = zId.parse(formData.get("packageId"));
  let projectId = "";
  await withOsUser(async user => {
    const pkg = await scopedPackage(user.scope, packageId);
    projectId = pkg.projectId;
    const stage = pick(PACKAGE_STAGES, formData, "stage") ?? pkg.stage;
    if (["award", "manufacturing", "logistics", "delivery"].includes(stage) && !pkg.awardedBidId) throw new Error("Award a bid first");
    const weights = { ...pkg.weights };
    for (const c of Object.keys(CRITERIA) as Criterion[]) { const v = num(formData, `w_${c}`); if (v !== null) weights[c] = Math.max(0, Math.min(100, v)); }
    await appDb().update(procurementPackages).set({
      stage, weights, bidsDueAt: formData.has("bidsDueAt") ? date(formData, "bidsDueAt") : pkg.bidsDueAt, awardTargetAt: formData.has("awardTargetAt") ? date(formData, "awardTargetAt") : pkg.awardTargetAt,
      requiredOnSiteAt: formData.has("requiredOnSiteAt") ? date(formData, "requiredOnSiteAt") : pkg.requiredOnSiteAt, updatedAt: new Date().toISOString(),
    }).where(eq(procurementPackages.id, pkg.id));
    if (stage !== pkg.stage) await audit(appDb(), { actor: user.email, action: "package_stage", entity: "procurement_packages", entityId: pkg.id, before: { stage: pkg.stage }, after: { stage } });
  });
  redirect(note(`${tabUrl(projectId, "procurement")}&pkg=${packageId}`, "Package updated."));
}

export async function addBidAction(formData: FormData) {
  const packageId = zId.parse(formData.get("packageId"));
  let projectId = "";
  await withOsUser(async user => {
    const pkg = await scopedPackage(user.scope, packageId);
    projectId = pkg.projectId;
    const org = await scopedOrg(user.scope, str(formData, "orgId"));
    const bidder = str(formData, "bidder", 200) || org?.name;
    if (!bidder) throw new Error("Bidder name or organization is required");
    const incoterms = str(formData, "incoterms", 3).toUpperCase();
    await appDb().insert(bids).values({
      packageId, projectId: pkg.projectId, mandateId: pkg.mandateId, orgId: org?.id ?? null, bidder, status: pick(BID_STATUSES, formData, "status") ?? (num(formData, "price") !== null ? "received" : "invited"),
      price: num(formData, "price"), currency: opt(formData, "currency", 8) ?? pkg.currency, scheduleWeeks: num(formData, "scheduleWeeks"), leadTimeWeeks: num(formData, "leadTimeWeeks"),
      warrantyYears: num(formData, "warrantyYears"), liquidatedDamages: str(formData, "liquidatedDamages", 500), originCountry: opt(formData, "originCountry", 80), factory: opt(formData, "factory", 200),
      incoterms: (INCOTERMS as readonly string[]).includes(incoterms) ? incoterms : null, port: opt(formData, "port", 120), localContentPct: pct(formData, "localContentPct"),
      financingSupport: str(formData, "financingSupport", 500), exceptions: str(formData, "exceptions", 2000), submittedAt: num(formData, "price") !== null ? new Date().toISOString().slice(0, 10) : null,
    });
  });
  redirect(note(`${tabUrl(projectId, "procurement")}&pkg=${packageId}`, "Bid recorded."));
}

export async function scoreBidAction(formData: FormData) {
  const bidId = zId.parse(formData.get("bidId"));
  let projectId = "", packageId = "";
  await withOsUser(async user => {
    const b = await scopedBid(user.scope, bidId);
    projectId = b.projectId; packageId = b.packageId;
    const scores = { ...b.scores };
    for (const c of Object.keys(CRITERIA) as Criterion[]) {
      if (!formData.has(`s_${c}`)) continue;
      const v = num(formData, `s_${c}`);
      if (v === null) delete scores[c]; else scores[c] = Math.max(0, Math.min(10, v));
    }
    const status = pick(BID_STATUSES, formData, "status") ?? b.status;
    if (status === "selected" && b.status !== "selected") throw new Error("Use Award to select a bid");
    await appDb().update(bids).set({ scores, status, price: formData.has("price") ? num(formData, "price") : b.price, updatedAt: new Date().toISOString() }).where(eq(bids.id, b.id));
    await audit(appDb(), { actor: user.email, action: "bid_scored", entity: "bids", entityId: b.id, before: { scores: b.scores, status: b.status }, after: { scores, status } });
  });
  redirect(note(`${tabUrl(projectId, "procurement")}&pkg=${packageId}`, "Scores saved."));
}

export async function awardBidAction(formData: FormData) {
  const bidId = zId.parse(formData.get("bidId"));
  let target = "/projects";
  await withOsUser(async user => {
    const b = await scopedBid(user.scope, bidId);
    const r = await awardBid(appDb(), b.id, user.email);
    target = note(`/contracts/${r.contractId}`, `Awarded to ${b.bidder}. A draft agreement is registered with the scope, price and E&S requirements; take it through counsel review.`);
  });
  redirect(target);
}

// Network

export async function saveNetworkProfileAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  const back = str(formData, "back", 300).startsWith("/") ? str(formData, "back", 300) : "/network";
  await withOsUser(async user => {
    const org = await scopedOrg(user.scope, orgId);
    if (!org) throw new Error("Organization not found");
    const [o] = await appDb().select({ mandateId: organizations.mandateId }).from(organizations).where(eq(organizations.id, org.id));
    const values = {
      roles: formData.getAll("roles").map(String).filter(r => r in NETWORK_ROLES), assetClasses: formData.getAll("assetClasses").map(String).filter(a => a in ASSET_CLASSES),
      technologies: str(formData, "technologies", 500), jurisdictions: str(formData, "jurisdictions", 500).split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 60),
      minProjectSize: num(formData, "minProjectSize"), maxProjectSize: num(formData, "maxProjectSize"), currency: opt(formData, "currency", 8) ?? "USD",
      completedAssets: num(formData, "completedAssets") === null ? null : Math.round(num(formData, "completedAssets")!), trackRecord: str(formData, "trackRecord", 2000),
      bonding: str(formData, "bonding", 300), insurance: str(formData, "insurance", 300), balanceSheet: str(formData, "balanceSheet", 300), warranty: str(formData, "warranty", 300),
      bankable: formData.get("bankable") === "on", references: str(formData, "references", 1000), performance: str(formData, "performance", 1000), updatedAt: new Date().toISOString(),
    };
    const [existing] = await appDb().select({ id: networkProfiles.id }).from(networkProfiles).where(and(eq(networkProfiles.orgId, org.id), mandateCondition(user.scope, networkProfiles.mandateId)));
    if (existing) await appDb().update(networkProfiles).set(values).where(eq(networkProfiles.id, existing.id));
    else await appDb().insert(networkProfiles).values({ ...values, orgId: org.id, mandateId: o.mandateId });
  });
  redirect(note(back, "Profile saved."));
}

export async function inviteFromNetworkAction(formData: FormData) {
  const packageId = zId.parse(formData.get("packageId"));
  const orgId = zId.parse(formData.get("orgId"));
  let projectId = "";
  await withOsUser(async user => {
    const pkg = await scopedPackage(user.scope, packageId);
    projectId = pkg.projectId;
    const org = await scopedOrg(user.scope, orgId);
    if (!org) throw new Error("Organization not found");
    const [dup] = await appDb().select({ id: bids.id }).from(bids).where(and(eq(bids.packageId, pkg.id), eq(bids.orgId, org.id)));
    if (!dup) await appDb().insert(bids).values({ packageId: pkg.id, projectId: pkg.projectId, mandateId: pkg.mandateId, orgId: org.id, bidder: org.name, status: "invited", currency: pkg.currency });
  });
  redirect(note(`${tabUrl(projectId, "procurement")}&pkg=${packageId}`, "Added to the bid list as Invited. Send the RFP yourself; nothing is emailed from here."));
}
