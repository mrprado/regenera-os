// Demo data (master build instruction §89–91). Everything lives in a separate entity, "DEMO — Regenera sample data",
// every name starts "DEMO —", every email is @example.test, portal users / data rooms / layers carry is_demo, and the
// sample Atlas layers say "DEMO / SAMPLE DATA". Nothing here is presented as live or official data: no place facts,
// prices or third-party figures are fabricated (place profiles come from the real sources when the job runs).
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  brokerProfiles, capitalMandates, capitalStackLayers, capitalStructures, fundingPathways, capitalProfiles, capitalRequirements, capitalTranches, constraints, contacts, dataRoomDocuments, dataRooms, documentRequests,
  bids, documents, events, mandateMembers, networkProfiles, procurementPackages, mandates, notifications, organizations, playbooks, stageGates, triggerRules, portalUsers, projectParties, projectUpdates, projects, referralRegistrations, risks, spatialLayers, tasks,
} from "@/db/schema";
import { addMilestone } from "@/lib/delivery/engine";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { ensureRulesAndGates } from "@/lib/events/engine";
import { ensurePlaybooks } from "@/lib/playbooks/engine";
import { createProject, setReadiness } from "@/lib/projects/engine";
import { createPathway } from "@/lib/capital/pathways";
import { createStructure, saveStructure } from "@/lib/capital/stack";
import { BUILT_DEMO_TABLES, seedBuiltDemo } from "@/lib/built/seed";

export const DEMO_MANDATE = "mandate_demo";
const D = (s: string) => `DEMO — ${s}`;

const YUCATAN_SITE = { type: "Polygon", coordinates: [[[-89.668, 21.012], [-89.612, 21.014], [-89.605, 20.968], [-89.664, 20.962], [-89.668, 21.012]]] };

export async function seedDemo(db: Db, ownerEmail: string) {
  const [exists] = await db.select({ id: mandates.id }).from(mandates).where(eq(mandates.id, DEMO_MANDATE));
  if (exists) return { created: false };
  await db.insert(mandates).values({ id: DEMO_MANDATE, slug: "demo", name: "DEMO — Regenera sample data", type: "development", rules: { massAllowed: false, approvalRequired: true } });
  await db.insert(mandateMembers).values({ mandateId: DEMO_MANDATE, email: ownerEmail, role: "owner" });
  const M = DEMO_MANDATE;

  const org = async (name: string, country: string, sector?: string, lat?: number, lng?: number) => {
    const [o] = await db.insert(organizations).values({ mandateId: M, name: D(name), nameNormalized: normalizeOrgName(D(name)), country, sector: sector ?? null, lat: lat ?? null, lng: lng ?? null, source: "other", description: "Demo record for training and walkthroughs; not a real organization." }).returning();
    return o;
  };
  const person = async (orgId: string, first: string, last: string, title: string) => {
    const [c] = await db.insert(contacts).values({ mandateId: M, orgId, firstName: first, lastName: last, fullName: D(`${first} ${last}`), nameNormalized: `${first} ${last}`.toLowerCase(), title, email: `${first}.${last}@example.test`.toLowerCase(), emailLower: `${first}.${last}@example.test`.toLowerCase(), source: "other" }).returning();
    return c;
  };

  const sponsor = await org("Península Renewables SA de CV", "MEX", "energy", 20.97, -89.62);
  const family = await org("Monteverde Family Office", "USA", undefined, 25.76, -80.19);
  const dfi = await org("Global Infrastructure DFI", "GBR", undefined, 51.51, -0.13);
  const epc = await org("Sol Norte EPC", "MEX", "energy", 19.43, -99.13);
  const brokerOrg = await org("Puente Introductions", "MEX", undefined, 25.67, -100.31);
  const advisor = await org("Delta Environmental Advisors", "MEX", undefined, 21.16, -86.85);
  const developer = await org("Kilimanjaro Energy Developers", "KEN", "energy", -1.29, 36.82);
  await person(sponsor.id, "Lucia", "Herrera", "CEO");
  const fo = await person(family.id, "Daniel", "Weiss", "Principal");
  await person(dfi.id, "Priya", "Nair", "Investment Officer");
  await person(epc.id, "Mateo", "Ruiz", "Business Development");

  const mk = async (name: string, extra: Partial<typeof projects.$inferInsert>) => createProject(db, { mandateId: M, name: D(name), ownerEmail, originationSource: "Demo data", ...extra }, "demo");
  const solar = await mk("Mexico Solar 100 MW", { assetClass: "solar", sector: "energy", technology: "Single-axis tracker PV + 40 MWh BESS", capacity: 100, capacityUnit: "MW", capex: 92_000_000, currency: "USD", country: "MEX", subdivision: "Yucatán", municipality: "Mérida", lat: 20.988, lng: -89.636, geometry: JSON.stringify(YUCATAN_SITE), stage: "development", regeneraRole: "development_office", description: "Illustrative utility-scale solar project used for demos. Figures are sample assumptions, not a real project." });
  const eco = await mk("Yucatán Eco Park", { assetClass: "mixed_use", sector: "land_built_environment", country: "MEX", subdivision: "Yucatán", lat: 21.05, lng: -89.55, stage: "screening", description: "Illustrative mixed-use eco-industrial park for demos." });
  const nz = await mk("New Zealand Solar", { assetClass: "solar", sector: "energy", capacity: 60, capacityUnit: "MW", capex: 55_000_000, currency: "NZD", country: "NZL", lat: -39.49, lng: 176.91, stage: "diagnostic", description: "Illustrative project for demos." });
  const kenya = await mk("Africa Energy Project", { assetClass: "hydro", sector: "energy", capacity: 25, capacityUnit: "MW", capex: 60_000_000, currency: "USD", country: "KEN", lat: -0.52, lng: 37.45, stage: "opportunity", description: "Illustrative run-of-river hydro for demos." });

  await db.insert(projectParties).values([
    { projectId: solar.id, mandateId: M, orgId: sponsor.id, role: "sponsor", confirmed: "confirmed" },
    { projectId: solar.id, mandateId: M, orgId: epc.id, role: "epc", confirmed: "proposed" },
    { projectId: solar.id, mandateId: M, orgId: advisor.id, role: "advisor", confirmed: "confirmed" },
    { projectId: kenya.id, mandateId: M, orgId: developer.id, role: "developer", confirmed: "proposed" },
  ]);
  for (const [d, s] of [["land", "substantially_ready"], ["grid", "blocked"], ["permitting", "in_progress"], ["environmental", "in_progress"], ["commercial", "early"], ["financial", "early"]] as const)
    await setReadiness(db, solar.id, d, { status: s, evidence: "DEMO evidence (illustrative)" }, "demo");
  await db.insert(constraints).values([
    { projectId: solar.id, mandateId: M, category: "grid", description: "DEMO: substation at capacity until network upgrade", severity: "critical", owner: "Sponsor", resolutionAction: "Apply for network upgrade", deadline: "2026-12-15" },
    { projectId: solar.id, mandateId: M, category: "water", description: "DEMO: module cleaning water in a stressed aquifer", severity: "medium", owner: "EPC" },
  ]);
  await db.insert(risks).values([
    { projectId: solar.id, mandateId: M, category: "fx", description: "DEMO: MXN revenue vs USD debt", likelihood: "likely", impact: "high", mitigation: "Partial USD indexation in PPA" },
    { projectId: solar.id, mandateId: M, category: "permitting", description: "DEMO: MIA approval timing", likelihood: "possible", impact: "high" },
  ]);
  const [dev] = await db.insert(capitalRequirements).values([
    { projectId: solar.id, mandateId: M, purpose: "Development capital", instrument: "development_capital", target: 3_000_000, secured: 750_000, currency: "USD", targetClose: "2027-02-28", status: "seeking" },
    { projectId: solar.id, mandateId: M, purpose: "Senior debt", instrument: "senior_debt", target: 62_000_000, currency: "USD", targetClose: "2028-03-31", status: "planned" },
  ]).returning();
  await db.insert(capitalTranches).values({ projectId: solar.id, requirementId: dev.id, mandateId: M, name: "Development tranche A", instrument: "development_capital", target: 2_250_000, targetInvestorType: "family offices, impact funds" });
  const [cp] = await db.insert(capitalProfiles).values([
    { mandateId: M, orgId: family.id, contactId: fo.id, name: D("Monteverde Family Office"), capitalType: "family_office", geographies: ["MEX", "Latin America"], sectors: ["energy"], stages: ["development"], instruments: ["development_capital", "project_equity"], ticketMin: 1_000_000, ticketMax: 5_000_000, currency: "USD", source: "Demo data" },
    { mandateId: M, orgId: dfi.id, name: D("Global Infrastructure DFI"), capitalType: "dfi", geographies: ["global"], sectors: ["energy", "infrastructure"], stages: ["financial_close"], instruments: ["senior_debt"], ticketMin: 20_000_000, ticketMax: 150_000_000, currency: "USD", source: "Demo data" },
  ]).returning();
  await db.insert(capitalMandates).values({ mandateId: M, profileId: cp.id, name: D("Energy transition fund II"), geographies: ["MEX"], sectors: ["energy"], stages: ["development"], instruments: ["development_capital"], ticketMin: 1_000_000, ticketMax: 5_000_000, currency: "USD", source: "Demo data" });

  // Capital stack scenario and a funding pathway (illustrative assumptions, labelled DEMO).
  const stack = await createStructure(db, solar.id, "DEMO: base structure", "demo");
  await saveStructure(db, stack.id, { name: "DEMO: base structure", currency: "USD", totalCost: 92_000_000, costSource: "DEMO sample assumption", status: "working", notes: "Illustrative only." }, [
    { layer: "senior_debt", provider: "DEMO: Global Infrastructure DFI", currency: "USD", amount: 62_000_000, pricing: "DEMO: SOFR + 325 bp", ratePct: 7.6, tenorYears: 18, amortization: "Sculpted", security: "Project assets", status: "indicative", conditions: "", source: "DEMO sample assumption", assumptionStatus: "assumption" },
    { layer: "development_equity", provider: "DEMO: Monteverde Family Office", currency: "USD", amount: 3_000_000, pricing: "", ratePct: null, tenorYears: null, amortization: "", security: "", status: "in_discussion", conditions: "", source: "DEMO sample assumption", assumptionStatus: "assumption" },
    { layer: "sponsor_equity", provider: "DEMO: Sponsor", currency: "USD", amount: 22_000_000, pricing: "", ratePct: 14, tenorYears: null, amortization: "", security: "", status: "assumption", conditions: "", source: "DEMO sample assumption", assumptionStatus: "assumption" },
  ], "demo");
  await createPathway(db, { projectId: solar.id, name: "DEMO: DFI senior loan", sourceType: "dfi", provider: "DEMO: Global Infrastructure DFI", amount: 62_000_000, currency: "USD", deadline: new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10), notes: "Illustrative pathway." }, "demo");

  const land = await addMilestone(db, { projectId: solar.id, name: "DEMO: land lease executed", durationDays: 30, category: "land", owner: "Sponsor" }, "demo");
  await addMilestone(db, { projectId: solar.id, name: "DEMO: interconnection study submitted", durationDays: 60, category: "grid", dependsOn: [land.id], dueDate: "2026-12-15", evidence: "DEMO PPA clause 7.2" }, "demo");
  await db.insert(tasks).values([
    { mandateId: M, projectId: solar.id, type: "follow_up", title: "DEMO: follow up with the family office on the development tranche", dueAt: new Date().toISOString().slice(0, 10) },
    { mandateId: M, projectId: eco.id, type: "other", title: "DEMO: schedule site visit", dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) },
  ]);
  const [doc1, doc2] = await db.insert(documents).values([
    { mandateId: M, title: D("Land lease (executed)"), category: "land", status: "executed", projectId: solar.id, url: "https://example.test/demo/land-lease.pdf" },
    { mandateId: M, title: D("Investor teaser"), category: "capital", status: "approved", projectId: solar.id, url: "https://example.test/demo/teaser.pdf" },
  ]).returning();
  const [room] = await db.insert(dataRooms).values({ mandateId: M, name: D("Mexico Solar data room"), projectId: solar.id, audience: "capital", status: "open", isDemo: true, ndaText: "DEMO confidentiality undertaking (illustrative)." }).returning();
  await db.insert(dataRoomDocuments).values([{ dataRoomId: room.id, documentId: doc1.id, folder: "land", addedBy: "demo" }, { dataRoomId: room.id, documentId: doc2.id, folder: "capital", addedBy: "demo" }]);
  await db.insert(documentRequests).values({ mandateId: M, projectId: solar.id, title: "DEMO: grid connection study", description: "Latest utility response", dueDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10), createdBy: "demo" });
  await db.insert(projectUpdates).values({ mandateId: M, projectId: solar.id, title: "DEMO: September update", body: "Land lease executed; interconnection study in preparation. (Demo content.)", audiences: ["sponsor", "capital"], approvedBy: "demo", publishedAt: new Date().toISOString(), createdBy: "demo" });
  const [bu] = await db.insert(portalUsers).values({ mandateId: M, email: "demo.introducer@example.test", name: D("Introducer (portal)"), kind: "broker", orgId: brokerOrg.id, status: "invited", isDemo: true }).returning();
  const [bp] = await db.insert(brokerProfiles).values({ mandateId: M, portalUserId: bu.id, orgId: brokerOrg.id, roleType: "introducer", jurisdictions: ["MX"], complianceStatus: "under_review" }).returning();
  await db.insert(referralRegistrations).values({ mandateId: M, brokerId: bp.id, targetType: "investor", name: D("Sierra Madre Capital"), organization: D("Sierra Madre Capital"), jurisdiction: "MX", status: "conflict_review", conflicts: [{ kind: "role", detail: "Investor introduction by a non-licensed role: counsel to confirm" }] });
  const sample = (name: string, category: "grid" | "substations" | "water" | "protected_areas", fc: object) =>
    db.insert(spatialLayers).values({ mandateId: M, name: `DEMO / SAMPLE DATA — ${name}`, category, provider: "DEMO / SAMPLE DATA (illustrative, not an official source)", license: "Demo only", confidence: "low", coverage: "Mérida area", geojson: JSON.stringify(fc), featureCount: (fc as { features: unknown[] }).features.length, west: -89.9, south: 20.8, east: -89.4, north: 21.2, isDemo: true, createdBy: "demo" });
  await sample("sample 115 kV corridor", "grid", { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[-89.85, 20.86], [-89.7, 20.95], [-89.62, 20.99], [-89.45, 21.12]] }, properties: { name: "Sample corridor" } }] });
  await sample("sample substations", "substations", { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-89.64, 20.98] }, properties: { name: "Sample substation A" } }, { type: "Feature", geometry: { type: "Point", coordinates: [-89.5, 21.08] }, properties: { name: "Sample substation B" } }] });
  await sample("sample cenote zone", "water", { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[-89.72, 20.9], [-89.66, 20.9], [-89.66, 20.94], [-89.72, 20.94], [-89.72, 20.9]]] }, properties: { name: "Sample karst / cenote sensitivity zone" } }] });
  await ensurePlaybooks(db, M);
  await ensureRulesAndGates(db, M);
  await seedBuiltDemo(db, M, [eco.id, solar.id, nz.id, kenya.id]);
  return { created: true, projects: [solar.id, eco.id, nz.id, kenya.id] };
}

/** Removes every demo record by deleting the demo entity's rows (tables are mandate-scoped). */
export async function removeDemo(db: Db) {
  const scoped = [...BUILT_DEMO_TABLES, bids, procurementPackages, networkProfiles, fundingPathways, capitalStackLayers, capitalStructures, notifications, events, triggerRules, stageGates, playbooks, referralRegistrations, brokerProfiles, portalUsers, spatialLayers, projectUpdates, documentRequests, dataRooms, documents, tasks, capitalMandates, capitalProfiles, risks, constraints, projectParties, capitalTranches, capitalRequirements, projects, contacts, organizations];
  for (const t of scoped) await db.delete(t).where(inArray((t as unknown as { mandateId: typeof projects.mandateId }).mandateId, [DEMO_MANDATE]));
  await db.delete(mandateMembers).where(eq(mandateMembers.mandateId, DEMO_MANDATE));
  await db.delete(mandates).where(eq(mandates.id, DEMO_MANDATE));
}
