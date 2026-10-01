// Prepared live records (not DEMO): the EMC Renewables EPC origination pilot (from EMC's public website, 2026-09-30)
// and the RA-ESG group (from RA-ESG's own documents supplied by the user). Idempotent by name. Sender claims are
// recorded as client-provided and unverified; nothing here is marked verified, compliant or financeable.
// Per the user's instruction, no role for Alan Prado at RA-ESG is recorded.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalProfiles, commercialMandates, contacts, documentLinks, documents, organizations, projectParties, projects } from "@/db/schema";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { createProject } from "@/lib/projects/engine";
import { createMandate, requestApproval } from "./engine";

const AT = "2026-09-30";
const EMC_SRC = [{ label: "EMC Renewables: home", url: "https://emcrenewables.com/", at: AT }, { label: "EMC Renewables: about (leadership)", url: "https://emcrenewables.com/about/", at: AT }, { label: "EMC Renewables: projects", url: "https://emcrenewables.com/projects/", at: AT }, { label: "EMC Renewables: careers (BD, estimating, contracts roles)", url: "https://emcrenewables.com/careers/", at: AT }];
const RA_DIR = "C:\\Users\\KM\\OneDrive\\Desktop\\RA-ESG";

async function org(db: Db, ws: string, name: string, v: Partial<typeof organizations.$inferInsert>) {
  const norm = normalizeOrgName(name);
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, ws), v.domain ? eq(organizations.domain, v.domain) : eq(organizations.nameNormalized, norm)));
  if (o) return o.id;
  const [n] = await db.insert(organizations).values({ mandateId: ws, name, nameNormalized: norm, source: "other", ...v }).onConflictDoNothing().returning({ id: organizations.id });
  return n?.id ?? (await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, ws), eq(organizations.nameNormalized, norm))))[0].id;
}

async function person(db: Db, ws: string, orgId: string, fullName: string, title: string, note: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.mandateId, ws), eq(contacts.orgId, orgId), eq(contacts.nameNormalized, fullName.toLowerCase())));
  if (c) return c.id;
  const [first, ...rest] = fullName.split(" ");
  const [n] = await db.insert(contacts).values({ mandateId: ws, orgId, firstName: first, lastName: rest.join(" "), fullName, nameNormalized: fullName.toLowerCase(), title, source: "other", notes: note } as typeof contacts.$inferInsert).returning({ id: contacts.id });
  return n.id;
}

export async function seedEmcPilot(db: Db, ws: string, actor: string) {
  const name = "EMC Renewables: U.S. utility-scale PV + BESS EPC origination pilot";
  const [have] = await db.select({ id: commercialMandates.id }).from(commercialMandates).where(and(eq(commercialMandates.mandateId, ws), eq(commercialMandates.name, name)));
  if (have) return { id: have.id, created: false };
  const emc = await org(db, ws, "EMC Renewables", { domain: "emcrenewables.com", website: "https://emcrenewables.com", country: "USA", location: "3120 Sabre Dr, Southlake, TX 76092", industry: "Utility-scale PV and BESS EPC",
    description: "EPC for utility-scale photovoltaic and battery energy storage (engineering & design, logistics & procurement, construction, commissioning, O&M). Customers: utilities, IPPs, developers, private infrastructure investors. Parent: Elmya. Website lists completed projects in Spain and the UK (Vidco, Caparacena, Hijar I+II+III, Cuenca, San Fernando, Villanueva del Rey, Abispark, Pattingham, Bolotana A+B); capacities not published. Source: emcrenewables.com, read 2026-09-30." });
  await org(db, ws, "Elmya", { industry: "EPC / renewable energy (EMC Renewables parent)", description: "Named on emcrenewables.com/about as EMC Renewables' parent. Source: emcrenewables.com/about, 2026-09-30." });
  for (const [n, t] of [["Carlos Guzmán", "President"], ["Pablo Bouvier", "VP Preconstruction"], ["Drew Zarallo", "VP Construction"]] as const) await person(db, ws, emc, n, t, "Leadership listed on emcrenewables.com/about (2026-09-30). No contact details recorded.");
  const m = await createMandate(db, {
    mandateId: ws, name, type: "epc_origination", clientName: "EMC Renewables", clientOrgId: emc, clientEntity: "EMC Renewables (Southlake, TX)", owner: actor, lead: actor, originator: "Regenera",
    sector: "energy", subsector: "Utility-scale solar and storage", assetClass: "Infrastructure", technologies: ["solar", "bess", "solar_bess"],
    geography: { countries: ["US"], isos: ["ERCOT", "SPP", "MISO", "CAISO", "WECC", "PJM"], states: [] },
    criteria: { minSolarMw: 50, minStorageMw: 50, minStorageMwh: 100, stages: ["mid_development", "late_development"], procurementHorizonMonths: 30, minEpcValue: 40_000_000, counterpartyTypes: ["ipp", "developer", "utility", "infrastructure_fund"], epcStructure: ["full_epc", "epc_procurement"], knownAccounts: [] },
    exclusions: "Projects with a definitively awarded EPC; sub-scale distributed generation; queue positions withdrawn, suspended, under construction or operating; markets EMC cannot currently execute (to confirm with EMC).",
    qualificationNote: "Qualified EPC opportunity: a solar / BESS project meeting EMC's agreed geography, technology, minimum capacity, development stage and likely procurement horizon, with an identified and credible sponsor, EPC not definitively awarded, material contract value, technical blockers reviewed, evidence recorded and a next action. Engagement-qualified adds a verified decision-maker and an established conversation; active pursuit needs EMC's approval by name and an owner.",
    successDefinition: "Pilot question: can Regenera identify and qualify actionable U.S. utility-scale PV / BESS EPC opportunities that EMC's commercial team should be pursuing and did not already know? Measures: actionable opportunities found, share not already known to EMC, intelligence accuracy, conversion to approved pursuit, meetings, RFQs / RFPs, time saved, pipeline value influenced.",
    complianceRequirements: "Commercial outreach to developers / IPPs only with EMC's approval per target (no mass messaging; do-not-contact and prior-relationship checks; consent / legitimate-interest basis recorded). Not a securities or capital-raising activity. Success fees only on Regenera-originated opportunities, terms subject to counsel review.",
    confidentiality: "confidential", outreachPermission: "approval_each", reportingCadence: "weekly", engagementModel: "pilot", breadth: "national", termMonths: 1.5, pilotFee: 12_500, retainer: 0,
    successEconomics: { structure: "fixed_milestone", milestones: [{ label: "Qualified shortlist / RFP received on a Regenera-originated opportunity", amount: 25_000 }, { label: "EPC award bonus on a Regenera-originated opportunity (range 150k–300k, to negotiate)", amount: 150_000 }], cap: 300_000, attributionWindowMonths: 18, appliesTo: "Regenera-originated opportunities approved by EMC by name", exclusions: "EMC-originated (Already known) and pre-existing accounts; partner-originated per contract", paymentEvent: "RFP receipt (milestone); EPC contract execution (award bonus)", counselReviewed: false },
    attributionRules: "Regenera originated: Regenera discovered the project / account and initiated the pathway, and EMC approved it by name in the approval queue. EMC originated: EMC marked it Already known or it is on EMC's pre-existing account list (no success fee). Regenera assisted / jointly / partner originated: per contract. Attribution window 18 months from approval.",
    deliveryFloor: [{ metric: "screened", target: 150, period: "month" }, { metric: "updated", target: 30, period: "month" }, { metric: "qualified", target: 12, period: "month" }, { metric: "priority", target: 8, period: "month" }, { metric: "pathways", target: 4, period: "month" }],
    status: "proposed", priority: "high", startDate: null,
    nextAction: "Send the pilot proposal to Pablo Bouvier (VP Preconstruction): 45-day scope, delivery floor, attribution and IP terms (Regenera retains the OS; EMC receives licensed access and deliverables).",
    publicLabel: "UTILITY SOLAR + BESS · U.S. · EPC ORIGINATION", sources: EMC_SRC,
  }, actor);
  return { id: m.id, created: true };
}

type RaProject = { name: string; country: string; region: string; mw: number; bess: string; gwh: number; tariff: string; om: string; land: string; revenue: string; epc: number; finance: string; valuation: string; note: string; offtake: string };
const RA_PROJECTS: RaProject[] = [
  { name: "Carreau Accacia (MUR1)", country: "MUS", region: "South Mauritius", mw: 40, bess: "4 h 20 min, Na-ion", gwh: 82, tariff: "$0.10/kWh", om: "7.5%", land: "~6.2%", revenue: "$7.3m p.a.", epc: 44e6, finance: "80% local bank / 20% seed capital, 10-year loan", valuation: "$59.6m", offtake: "Central Electricity Board (CEB) tender scheme", note: "Grid-connected; supplies the CEB under the tender scheme." },
  { name: "Bras D'eau (MUR2)", country: "MUS", region: "North-East Mauritius", mw: 10, bess: "4 h 20 min, Na-ion", gwh: 21, tariff: "$0.10/kWh", om: "7.5%", land: "~10%", revenue: "$1.8m p.a.", epc: 12e6, finance: "80% local bank / 20% seed capital, 10-year loan", valuation: "$14.9m", offtake: "CEB tender scheme", note: "26 ha site." },
  { name: "Puri Farm, Alaska (ZIM1)", country: "ZWE", region: "Zimbabwe", mw: 100, bess: "Na-ion (duration TBA)", gwh: 192.2, tariff: "$0.089/kWh (ZESA $0.0897; SAPP $0.16)", om: "5%", land: "~8%", revenue: "$19m p.a.", epc: 108e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$149.6m", offtake: "Multinational mining and steel off-takers", note: "2 × 50 MW; acquired 2024 per the group report. Data room lists grid connection agreement, EIA and generation licence (subject to NCNDA)." },
  { name: "Msonga Mine (TANZ1)", country: "TZA", region: "Tanzania", mw: 25, bess: "120 min, Na-ion", gwh: 44.2, tariff: "$0.10/kWh ($0.12 if paid in gold)", om: "5%", land: "~8%", revenue: "$5m p.a.", epc: 27e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$35m + asset", offtake: "Mine (energy-for-gold commodity swap)", note: "Stated: EPC cost guaranteed by 440,000 oz of gold per a geological study; RA-ESG holds a substantial shareholding. Unverified." },
  { name: "Keetmanshoop (NAM1)", country: "NAM", region: "30 km east of Keetmanshoop", mw: 54, bess: "180 min, Na-ion", gwh: 100, tariff: "$0.08/kWh (NamPower $0.09)", om: "5%", land: "~10%", revenue: "$8.5m p.a.", epc: 60e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$80m", offtake: "NamPower via Kokerboom HV substation", note: "Near the 2.9 MW Neckertal hydro dam." },
  { name: "How Mine, Bulawayo (ZIM3)", country: "ZWE", region: "Bulawayo", mw: 300, bess: "240 min, Na-ion", gwh: 778, tariff: "~$0.10/kWh", om: "5%", land: "~0%", revenue: "$54m p.a.", epc: 320e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$447m", offtake: "How gold mine", note: "Private land." },
  { name: "Triangle (ZIM4)", country: "ZWE", region: "Zimbabwe", mw: 45, bess: "240 min, Na-ion", gwh: 100, tariff: "$0.089/kWh", om: "5%", land: "~20%", revenue: "$8m p.a.", epc: 55e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$67m", offtake: "Mining and steel off-takers", note: "Project sheet overview text incomplete in the source (placeholder)." },
  { name: "Beitbridge (ZIM5)", country: "ZWE", region: "Zimbabwe / South Africa border", mw: 46, bess: "300 min, Na-ion", gwh: 121, tariff: "$0.089/kWh", om: "5%", land: "~20%", revenue: "$8.5m p.a.", epc: 55e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$68.5m", offtake: "Border-post loads / ZESA", note: "Phase 1 46 MW, expansion to 100 MW stated." },
  { name: "Brandvlei (RSA1)", country: "ZAF", region: "Northern Cape", mw: 1000, bess: "TBA (awaiting Eskom), Na-ion", gwh: 3200, tariff: "$0.07–0.08/kWh (estimated)", om: "5%", land: "~10%", revenue: "$220m p.a.", epc: 1e9, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$1.5b", offtake: "Eskom (awaiting)", note: "4 phases of 250 MW; land partner also owns the Namibian site." },
  { name: "Boane Agro, Maputo (MOZ-1)", country: "MOZ", region: "Beluluane extension, Boane", mw: 10, bess: "120 min, Na-ion", gwh: 18, tariff: "$0.08/kWh + profit share", om: "7%", land: "~0%", revenue: "$1.8m p.a.", epc: 12e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$12.8m", offtake: "Agro-industrial estate and food processing zone", note: "Phased pilot energy scheme." },
  { name: "Somina, Nikšić (MONT-1)", country: "MNE", region: "Nikšić", mw: 240, bess: "360 MWh, Na-ion", gwh: 457, tariff: "$0.10/kWh", om: "5%", land: "~0%", revenue: "$47m p.a.", epc: 200e6, finance: "95% FEPC / 5% seed capital; debt + equity", valuation: "$375m", offtake: "Not stated", note: "Newly acquired, under final negotiation per the report." },
];
const RA_LISTED_ONLY = [["Belle Rive", "MUS"], ["Virginia Savinia", "MUS"], ["Rose Belle", "MUS"], ["Inchwe Estate", "BWA"], ["Somerset East", "ZAF"]] as const;
const RA_DOCS = [
  ["RA-ESG Group Report 2025/6 (structure, shareholding, project sheets as of 1 Dec 2025)", "RA-ESG_Group_Overview.pdf", "corporate", "reviewed"],
  ["RA-ESG Investment Memorandum Part 1: Executive Summary", "Executive-Summary.pdf", "capital", "reviewed"],
  ["RA-ESG Investment Memorandum Part 1 (second copy)", "Executive Summary.pdf", "capital", "not reviewed"],
  ["RA-ESG Introducer Agreement (template, 01.03.2024)", "RA-ESG-Introducer-Agreement_01.03.2024.pdf", "legal", "reviewed"],
  ["RA-ESG investment onboarding process chart", "Process-Chart.pdf", "capital", "reviewed"],
  ["RA-ESG Investor FAQs", "Investor-Faqs.pdf", "capital", "not reviewed"],
  ["RA-ESG 101: Broker (06-06-2024)", "101-Broker-06-06-2024-.pdf", "capital", "not reviewed"],
  ["RA-ESG 101: Investor (06-06-2024)", "101-Investor-06-06-2024.pdf", "capital", "not reviewed"],
] as const;

export async function seedRaEsg(db: Db, ws: string, actor: string) {
  const name = "RA-ESG: project capital introductions (Africa / Europe solar + storage)";
  const [have] = await db.select({ id: commercialMandates.id }).from(commercialMandates).where(and(eq(commercialMandates.mandateId, ws), eq(commercialMandates.name, name)));
  if (have) return { id: have.id, created: false };
  const src = "RA-ESG documents supplied by the user (Group Report 2025/6, Investment Memorandum, Introducer Agreement); sender-stated, unverified";
  const ra = await org(db, ws, "RA-ESG PLC", { domain: "ra-esg.com", website: "https://ra-esg.com", country: "GBR", location: "71-75 Shelton Street, Covent Garden, London WC2H 9JQ (registered office); head office Barry, Wales",
    description: `UK PLC (Companies House 15115086) funding, developing and delivering utility-scale solar + storage, mainly in sub-Saharan Africa. Stated pipeline ~2.1 GW in 11 projects; group entities RA-ESG LLC (Dubai), RA-ESG PLC (UK), RA-ESG Inc (USA); offices London, Mauritius, Johannesburg, Harare, Mexico, Delaware, Dubai, Tamil Nadu. Divisions: solar farms, RA-Decimate (building energy analytics), RA-Guard (surface sanitiser), RA-Gold (energy-for-gold). Issues bonds listed on the Vienna MTF (via Bond Capital House) with a security trustee (Amicorp). Financial figures in its report (fixed assets $166.2m, net assets $117.6m) are self-reported and unaudited here. Source: ${src}.` });
  const affiliates: [string, string, string, string][] = [
    ["Go Commercial Finance Ltd", "gocommercialfinance.com", "GBR", "FCA-authorised commercial finance broker; stated finance partner of RA-ESG with mutual directors and shareholders (Companies House 08591990)."],
    ["Amicorp (UK) Ltd", "amicorp.com", "GBR", "Named security trustee for RA-ESG bondholders under a Security Trust Deed (Companies House 03705431)."],
    ["EST Accountants Ltd", "est-group.co.uk", "GBR", "Named accountants preparing RA-ESG management accounts (ACCA)."],
    ["Harper James Ltd", "harperjames.co.uk", "GBR", "Named legal counsel to RA-ESG (SRA-regulated)."],
    ["Bond Capital House GmbH", "bondcapitalhouse.com", "CHE", "Named listing and paying agent for RA-ESG bonds (Vienna MTF)."],
    ["Knightsbridge Finance Ltd", "", "ARE", "Named MEASEA representative office of RA-ESG (Dubai Digital Park)."],
  ];
  for (const [n, d, c, desc] of affiliates) await org(db, ws, n, { ...(d ? { domain: d, website: `https://${d}` } : {}), country: c, description: `${desc} Source: ${src}.` });
  await person(db, ws, ra, "David Vieira", "Managing Director", `Named in the RA-ESG Investment Memorandum. Source: ${src}.`);
  await person(db, ws, ra, "Tim Jonck", "Technical Director (non-executive)", `Named in the RA-ESG Investment Memorandum. Source: ${src}.`);

  const projectIds: string[] = [];
  for (const p of RA_PROJECTS) {
    const [ex] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.mandateId, ws), eq(projects.name, p.name)));
    const id = ex?.id ?? (await createProject(db, {
      mandateId: ws, name: p.name, assetClass: "solar", sector: "energy", technology: "Solar PV + BESS (Na-ion)", capacity: p.mw, capacityUnit: "MW", capex: p.epc, currency: "USD", stage: "opportunity", country: p.country, subdivision: p.region,
      originationSource: "RA-ESG Group Report 2025/6",
      description: `RA-ESG project sheet (sender-stated, unverified): ${p.mw} MW, ~${p.gwh} GWh p.a.; storage ${p.bess}; tariff ${p.tariff}; O&M ${p.om}; land ${p.land}; revenue ${p.revenue}; EPC ${(p.epc / 1e6).toLocaleString("en-US")}m; financing ${p.finance}; RA-ESG valuation ${p.valuation} (DCF at 6.72% WACC, 32-year life, $1m/MW EPC, 40% residual). Offtake: ${p.offtake}. ${p.note} Data room (cashflow, BoQ, energy / BESS / design reports, land lease, PPA, EPC contract) is subject to NCNDA and has not been reviewed.`,
    }, actor)).id;
    projectIds.push(id);
    const [pp] = await db.select({ id: projectParties.id }).from(projectParties).where(and(eq(projectParties.projectId, id), eq(projectParties.orgId, ra)));
    if (!pp) await db.insert(projectParties).values({ projectId: id, mandateId: ws, orgId: ra, role: "sponsor", confirmed: "proposed", note: "Stated in the RA-ESG Group Report." });
  }
  for (const [n, c] of RA_LISTED_ONLY) {
    const nm = `${n} (RA-ESG, listed)`;
    const [ex] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.mandateId, ws), eq(projects.name, nm)));
    if (!ex) { const pr = await createProject(db, { mandateId: ws, name: nm, sector: "energy", technology: "Solar PV", stage: "opportunity", country: c, originationSource: "RA-ESG Group Report 2025/6", description: "Named in the RA-ESG group structure chart; no project sheet supplied. Capacity, stage and status unknown." }, actor); projectIds.push(pr.id); }
  }

  for (const [title, file, category, reviewed] of RA_DOCS) {
    const [ex] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.mandateId, ws), eq(documents.title, title)));
    if (ex) continue;
    const [d] = await db.insert(documents).values({ mandateId: ws, title, category: category as never, status: "approved" as never, confidentiality: "confidential", counterpartyOrgId: ra, owner: actor, notes: `Local file: ${RA_DIR}\\${file} (not uploaded; R2 storage not enabled). Content ${reviewed === "reviewed" ? "read into the OS (projects, organizations, terms)" : "not yet reviewed"}. Supplied by the user.` }).returning({ id: documents.id });
    await db.insert(documentLinks).values({ documentId: d.id, mandateId: ws, entity: "organization", entityId: ra });
  }

  const m = await createMandate(db, {
    mandateId: ws, name, type: "project_capital", clientName: "RA-ESG PLC", clientOrgId: ra, clientEntity: "RA-ESG PLC (UK)", owner: actor, lead: actor, originator: "Regenera",
    sector: "energy", subsector: "Utility-scale solar + storage", assetClass: "Infrastructure", technologies: ["solar", "solar_bess"],
    geography: { countries: ["ZWE", "ZAF", "NAM", "MUS", "TZA", "MOZ", "BWA", "MNE"], states: [], isos: [] },
    criteria: { capitalType: "construction_equity", projectStage: "Development to construction-ready (per RA-ESG)", technologies: ["solar", "solar_bess"], investorTypes: ["infrastructure_fund", "dfi", "family_office", "strategic", "bank"], raiseAmount: 108_000_000 },
    exclusions: "Retail investors and US residents (RA-ESG's own introducer terms: it does not accept investment from retail investors or residents of the United States). Any party previously contracted with RA-ESG (non-circumvention).",
    qualificationNote: "A qualified capital counterparty has a current mandate covering sub-Saharan Africa (or the specific country), utility-scale solar + storage, the project's stage and ticket, and an identifiable decision-maker; investor qualification and KYC follow RA-ESG's onboarding process. No introduction without RA-ESG board consent and a signed qualifying document from the investor.",
    successDefinition: "Introductions of qualified institutional or professional capital to specific RA-ESG projects (project finance, construction equity, DFI / blended), leading to signed term sheets.",
    complianceRequirements: "LEGAL / SECURITIES REVIEW REQUIRED before any outreach or fee. (1) RA-ESG's introducer model pays transaction-based commissions on funds raised (stated tiers 15% / 10% / 5–10%); in the US this is broker-dealer territory, and RA-ESG's own terms exclude US residents. (2) RA-ESG materials describe 'guaranteed' bond and preference-share returns; the OS records these as issuer claims, never as facts, and Regenera must not repeat them in outreach. (3) Financial promotion restrictions apply per jurisdiction (UK FSMA s21, EU, UAE). (4) Investor qualification / KYC / source of funds are RA-ESG's onboarding steps and stay owner-only in the OS. Distinguish project-finance introductions to institutions from promotion of RA-ESG securities.",
    legalRestrictions: "English law introducer agreement; non-circumvention and 5-year confidentiality; GDPR; no unsolicited email naming RA-ESG (clause 9.7).",
    confidentiality: "strictly_confidential", outreachPermission: "approval_each", reportingCadence: "biweekly", engagementModel: "strategic", breadth: "multi_country",
    successEconomics: { structure: "pct_capital_raised", appliesTo: "Per RA-ESG introducer schedule (Annexure A): through-the-door or trail commission; email of 2025-09-11 states 15% (seed, $10k–$1m), 10% (mezzanine, $1m–$5m), 5–10% negotiated (main funding > $5m).", exclusions: "Any party previously engaged with RA-ESG; unsigned investors", paymentEvent: "Funds cleared and completed contract received by RA-ESG", counselReviewed: false },
    attributionRules: "Introducer code on every introduction; investor must sign RA-ESG's qualifying document before any discussion; commissions only on completed, funded contracts; clawback on cancellation.",
    deliveryFloor: [{ metric: "screened", target: 40, period: "month" }, { metric: "qualified", target: 6, period: "month" }, { metric: "approved", target: 3, period: "month" }],
    status: "draft", priority: "high",
    nextAction: "Securities / broker-dealer counsel review of the introducer model and of RA-ESG's 'guaranteed return' language before any outreach; then verify the Puri Farm (100 MW) data room under NCNDA.",
    publicLabel: "UTILITY SOLAR + STORAGE · SUB-SAHARAN AFRICA · PROJECT CAPITAL", sources: [{ label: "RA-ESG Group Report 2025/6 (local file)", url: "https://ra-esg.com", at: AT }],
  }, actor);
  await requestApproval(db, { mandateId: ws, kind: "mandate", entityType: "commercial_mandates", entityId: m.id, commercialMandateId: m.id, title: "Counsel review: RA-ESG introducer commissions and 'guaranteed return' marketing before any outreach", detail: "Transaction-based commissions on capital raised; RA-ESG excludes US residents; financial-promotion rules per jurisdiction. Approve only with counsel's written view.", approver: null }, actor);

  // Capital counterparties already in correspondence (from email): profiles with unknown criteria until verified.
  const proximo = await org(db, ws, "Proximo Capital", { domain: "proximocapital.com", website: "https://www.proximocapital.com", description: "Requested its New Deal Intake Form before an intro call with its managing partners (email 2025-09-24)." });
  const [pc] = await db.select({ id: capitalProfiles.id }).from(capitalProfiles).where(and(eq(capitalProfiles.mandateId, ws), eq(capitalProfiles.orgId, proximo)));
  if (!pc) await db.insert(capitalProfiles).values({ mandateId: ws, orgId: proximo, name: "Proximo Capital", capitalType: "other", source: "Email 2025-09-24 (intake form requested)", notes: "Criteria unknown: complete their intake form to record mandate, ticket and geography." }).onConflictDoNothing();
  return { id: m.id, created: true, projects: projectIds.length };
}
