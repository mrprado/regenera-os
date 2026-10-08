// Site intelligence, phase 21 stages: capital & opportunities, partners, and the saved preliminary assessment.
// Deterministic only. Programme fit is geography + stage lanes (lib/capital/programmes), funding calls are open/
// forthcoming records whose listed countries include the site's country, partners are Network organizations already
// recorded in that country. Nothing here contacts anyone; the assessment is saved as a confidential document marked
// preliminary, and one review task is created per run.
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { events, fundingOpportunities, generatedDocuments, organizations, projects, siteIntelRuns, tasks } from "@/db/schema";
import type { StageFact, StageState } from "@/db/siteintel";
import { matchProgrammes } from "@/lib/capital/programmes";
import { country as countryOf } from "@/lib/scan/countries";
import { SECTORS } from "@/lib/vocab";

type Project = typeof projects.$inferSelect;
type Out = { summary: string; facts: StageFact[] };

const SECTOR_OF_TECH: [RegExp, keyof typeof SECTORS][] = [
  [/solar|wind|hydro|storage|bess|geotherm|power|energy|grid/i, "energy"],
  [/waste|landfill|biogas|recycl/i, "waste_resource_systems"],
  [/water|forest|agri|restor|nature|carbon/i, "water_food_nature"],
  [/real estate|tourism|hospitality|urban|housing/i, "land_built_environment"],
];
export function projectSector(p: Pick<Project, "technology" | "assetClass" | "name">): keyof typeof SECTORS | null {
  const t = `${p.technology ?? ""} ${p.assetClass ?? ""} ${p.name}`;
  return SECTOR_OF_TECH.find(([re]) => re.test(t))?.[1] ?? null;
}

/** Pure: does a funding record's listed geography include this country (or is it global / unstated)? */
export function fundingCovers(countries: string[] | null, iso3: string | null): "listed" | "global" | "unstated" | "no" {
  if (!countries?.length) return "unstated";
  const c = iso3 ? countryOf(iso3) : null;
  const hay = countries.join(" | ").toLowerCase();
  if (c && (hay.includes(c.name.toLowerCase()) || countries.some(x => x.toUpperCase() === c.iso3 || x.toUpperCase() === c.iso2))) return "listed";
  if (/global|worldwide|any country|all countries|developing countries/.test(hay)) return "global";
  return "no";
}

export async function capitalStage(db: Db, p: Project): Promise<Out> {
  const facts: StageFact[] = [];
  // Without a country, geography cannot be checked: no programme is claimed to "cover" the site.
  const progs = p.country ? matchProgrammes({ country: p.country, stage: p.stage, capacity: p.capacity, capacityUnit: p.capacityUnit }).slice(0, 8) : [];
  for (const m of progs) facts.push({ label: `Programme: ${m.programme.name}`, value: `${m.met.join("; ") || "criteria to confirm"}${m.verify.length ? ` · verify: ${m.verify.slice(0, 2).join("; ")}` : ""}`, source: `${m.programme.owner} · ${m.programme.url}`, kind: "inference", data: { key: m.programme.key, url: m.programme.url } });
  const sector = projectSector(p);
  const open = await db.select({ id: fundingOpportunities.id, title: fundingOpportunities.title, funder: fundingOpportunities.funder, countries: fundingOpportunities.countries, sectors: fundingOpportunities.sectors, deadline: fundingOpportunities.deadline, url: fundingOpportunities.url, source: fundingOpportunities.source, status: fundingOpportunities.status })
    .from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, p.mandateId), ne(fundingOpportunities.status, "closed"))).limit(2000);
  const hits = open.map(o => ({ o, geo: fundingCovers(o.countries, p.country) }))
    .filter(x => (x.geo === "listed" || x.geo === "global") && (!sector || !x.o.sectors?.length || x.o.sectors.includes(sector)))
    .sort((a, b) => (a.geo === "listed" ? 0 : 1) - (b.geo === "listed" ? 0 : 1) || String(a.o.deadline ?? "9999").localeCompare(String(b.o.deadline ?? "9999"))).slice(0, 8);
  for (const { o, geo } of hits) facts.push({
    label: `Funding ${o.status}: ${o.title.slice(0, 120)}`,
    value: `${o.funder ?? o.source} · ${geo === "listed" ? "lists this country" : "global eligibility"}${sector ? ` · sector ${SECTORS[sector]}` : ""} · deadline ${o.deadline ?? "not stated (unverified)"}`,
    source: `${o.source} · ${o.url ?? ""}`, kind: "observed", data: { opportunityId: o.id },
  });
  if (!p.country) facts.push({ label: "Gap", value: "Country not recorded: programme and funding geography cannot be checked", source: "Project record", kind: "inference" });
  facts.push({ label: "Reading", value: "Programme fit is geography and stage lane only; eligibility, ticket size and current calls must be confirmed with each institution. Past awards are not available money.", source: "Regenera evidence policy", kind: "inference" });
  if (!p.country) return { summary: "Country not recorded: programmes and funding geography cannot be checked (set the country on the site record)", facts };
  return { summary: `${progs.length} programme(s) cover the geography and stage · ${hits.length} open/forthcoming funding record(s) list the country${sector ? ` for ${SECTORS[sector]}` : ""}`, facts };
}

const PARTNER_ROLES = ["epc", "developer", "lender", "investor", "dfi", "advisor", "oem", "offtaker"];
export async function partnersStage(db: Db, p: Project): Promise<Out> {
  if (!p.country) return { summary: "Country not recorded: partners cannot be screened by geography", facts: [] };
  const sector = projectSector(p);
  const orgs = await db.select({ id: organizations.id, name: organizations.name, sector: organizations.sector, roles: organizations.roles })
    .from(organizations).where(and(eq(organizations.mandateId, p.mandateId), eq(organizations.country, p.country), isNull(organizations.archivedAt))).limit(500);
  const ranked = orgs.map(o => ({ o, roles: (o.roles ?? []).filter(r => PARTNER_ROLES.includes(r)), sectorFit: !!sector && o.sector === sector }))
    .filter(x => x.roles.length || x.sectorFit)
    .sort((a, b) => Number(b.sectorFit) - Number(a.sectorFit) || b.roles.length - a.roles.length).slice(0, 10);
  const facts: StageFact[] = ranked.map(x => ({ label: x.o.name, value: [x.roles.join(", ") || null, x.sectorFit ? `sector ${SECTORS[sector!]}` : null].filter(Boolean).join(" · "), source: "Regenera Network (recorded organization)", kind: "observed", data: { orgId: x.o.id } }));
  facts.push({ label: "Find more", value: "Run a partner scan from the project's Capital or Matches tab (EPC, OEM, lenders, DFIs) for organizations not yet in Network.", source: "Regenera scans", kind: "inference" });
  return { summary: `${ranked.length} recorded partner organization(s) in ${countryOf(p.country)?.name ?? p.country}${orgs.length ? ` of ${orgs.length} recorded there` : ""}`, facts };
}

/** Assembles every finished stage of the run into a versioned, confidential "Preliminary site assessment". */
export async function assessmentStage(db: Db, p: Project, runId: string, actor = "system:site-intel"): Promise<Out> {
  const [run] = await db.select().from(siteIntelRuns).where(eq(siteIntelRuns.id, runId));
  const stages: StageState[] = (run?.stages ?? []).filter(s => s.key !== "assessment");
  const done = stages.filter(s => s.status === "done"), failed = stages.filter(s => s.status === "failed");
  const kindLabel = (k?: string) => (k === "modelled" ? "modelled" : k === "inference" ? "inference" : "observed/recorded");
  const lines = [
    `# Preliminary site assessment: ${p.name}`,
    "",
    `Location: ${p.lat?.toFixed(5)}, ${p.lng?.toFixed(5)} (${p.locationSource ?? "recorded location"}). Country: ${p.country ? countryOf(p.country)?.name ?? p.country : "not recorded"}.`,
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from site-intelligence run ${runId.slice(0, 8)}. SCREENING GRADE: every figure needs professional verification; proximity to grid infrastructure is not evidence of available interconnection capacity.`,
    "",
    ...done.flatMap(s => [`## ${s.key.replace(/_/g, " ")}`, s.summary ?? "", ...(s.facts ?? []).map(f => `- ${f.label}: ${f.value} — ${f.source} [${kindLabel(f.kind)}]`), ""]),
    "## Not available in this run",
    ...(failed.length ? failed.map(s => `- ${s.key.replace(/_/g, " ")}: ${s.error ?? "failed"}`) : ["- None"]),
    "",
    "## Next actions (for a person to decide)",
    "- Confirm site control, boundary and land rights.",
    "- Request grid capacity / connection information from the utility or TSO.",
    "- Shortlist programmes and funding calls above and confirm eligibility with each institution.",
  ];
  const body = lines.join("\n");
  const [prev] = await db.select({ id: generatedDocuments.id, version: generatedDocuments.version }).from(generatedDocuments)
    .where(and(eq(generatedDocuments.entityType, "project"), eq(generatedDocuments.entityId, p.id), eq(generatedDocuments.templateKey, "site_assessment"))).orderBy(desc(generatedDocuments.createdAt)).limit(1);
  const [doc] = await db.insert(generatedDocuments).values({
    mandateId: p.mandateId, templateKey: "site_assessment", title: `Preliminary site assessment · ${p.name}`, entityType: "project", entityId: p.id,
    values: { runId }, body, version: (prev?.version ?? 0) + 1, previousId: prev?.id ?? null, legal: false, legalReviewStatus: "not_required", confidential: true, createdBy: actor,
  }).returning({ id: generatedDocuments.id, version: generatedDocuments.version });
  const [openTask] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.status, "open"), inArray(tasks.title, [`Review site assessment: ${p.name}`]))).limit(1);
  if (!openTask) await db.insert(tasks).values({ mandateId: p.mandateId, projectId: p.id, type: "other", title: `Review site assessment: ${p.name}`, body: `Preliminary site assessment v${doc.version} is saved in Documents. Decide whether to advance, gather evidence or drop.`, dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
  await db.insert(events).values({ mandateId: p.mandateId, type: "SITE_ASSESSED", entityType: "project", entityId: p.id, payload: { summary: `Site assessment v${doc.version}: ${done.length} sections, ${failed.length} unavailable`, documentId: doc.id, runId }, actor });
  return { summary: `Saved preliminary site assessment v${doc.version} (${done.length} sections, ${failed.length} unavailable) and a review task`, facts: [{ label: "Assessment document", value: `v${doc.version}`, source: `Documents · generated ${doc.id}`, kind: "inference", data: { documentId: doc.id } }] };
}
