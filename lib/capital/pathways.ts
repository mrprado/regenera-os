// Funding pathways (master build instruction §10): a route from a project to a specific source of capital, with
// eligibility kept separate from commercial fit, generic process steps, a deadline and an owner. Eligibility is only
// "confirmed" with a named source; the OS never infers it.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { fundingPathways, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { PATHWAY_SOURCES, type PathwayStep } from "./structure-vocab";

type SourceType = keyof typeof PATHWAY_SOURCES;

/** Generic process steps per source type (process, not facts about any programme). */
export const PATHWAY_TEMPLATES: Partial<Record<SourceType, string[]>> = {
  grant: ["Read the call guidelines and scoring criteria", "Confirm eligibility with the programme (in writing)", "Assemble consortium and letters of support", "Draft the application", "Internal review", "Submit"],
  dfi: ["Concept note to the DFI", "Eligibility and E&S category screen", "Mandate / engagement letter", "Due diligence (technical, E&S, legal)", "Credit or investment committee", "Term sheet"],
  eca: ["Identify the exporter and content eligibility", "Letter of interest from the ECA", "Lender and ECA due diligence", "Premium and cover terms", "Commitment"],
  climate_fund: ["Confirm an accredited entity partner", "Concept note", "Funding proposal", "Board approval", "Funded activity agreement"],
  blended: ["Identify the concessional tranche provider", "Blended finance rationale (additionality, minimum concessionality)", "Structuring with senior lenders", "Approvals"],
  commercial_bank: ["Teaser and information memorandum", "Indicative terms", "Credit approval", "Facility agreement"],
  project_finance: ["Bankability review of contracts", "Lender technical adviser engaged", "Financial model audit", "Indicative term sheet", "Credit approval", "Financial close"],
  infrastructure_fund: ["Fit with fund mandate", "NDA and data room", "Non-binding offer", "Due diligence", "Binding offer"],
  family_office: ["Fit with mandate and ticket", "Investor qualification confirmed (owner-only record)", "Introductory meeting", "Materials approved for distribution", "Term sheet"],
  foundation: ["Programme fit and PRI policy", "Letter of inquiry", "Full proposal", "Board approval"],
  green_bond: ["Green framework aligned with ICMA principles", "Second-party opinion", "Rating", "Arrangers and documentation", "Issuance"],
  sukuk: ["Shariah structure selected (ijara, murabaha, wakala …)", "Shariah board / scholar review", "Asset identification", "Documentation", "Issuance"],
  carbon: ["Methodology and registry selected", "Project design document", "Validation", "Registration", "Offtake / ERPA"],
  tax_incentive: ["Confirm the incentive rules with tax counsel", "Application or registration", "Compliance evidence plan"],
};

export function templateSteps(sourceType: SourceType): PathwayStep[] {
  return (PATHWAY_TEMPLATES[sourceType] ?? ["Confirm fit", "Confirm eligibility", "Prepare submission", "Submit", "Decision"]).map((label, i) => ({ id: `s${i + 1}`, label, due: null, done: false }));
}

export type PathwayInput = {
  projectId: string; name: string; sourceType: SourceType; provider: string; providerOrgId?: string | null; fundingOpportunityId?: string | null;
  capitalProfileId?: string | null; requirementId?: string | null; amount: number | null; currency: string; deadline: string | null; owner?: string | null; notes?: string;
};

export async function createPathway(db: Db, input: PathwayInput, actor: string) {
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, input.projectId));
  if (!p) throw new Error("Project not found");
  const [row] = await db.insert(fundingPathways).values({ ...input, mandateId: p.mandateId, notes: input.notes ?? "", steps: templateSteps(input.sourceType) }).returning();
  await audit(db, { actor, action: "funding_pathway_create", entity: "funding_pathways", entityId: row.id, after: { name: input.name, sourceType: input.sourceType } });
  return row;
}

export async function setPathwayEligibility(db: Db, id: string, eligibility: "unknown" | "likely" | "confirmed" | "not_eligible", notes: string, source: string, actor: string) {
  if (eligibility === "confirmed" && source.trim().length < 3) throw new Error("Confirmed eligibility needs its source (the programme's written confirmation, rules document or counsel).");
  const [row] = await db.update(fundingPathways).set({
    eligibility, eligibilityNotes: notes, eligibilitySource: source, updatedAt: new Date().toISOString(),
    ...(eligibility === "not_eligible" ? { status: "ineligible" as const } : {}),
  }).where(eq(fundingPathways.id, id)).returning();
  if (!row) throw new Error("Pathway not found");
  await audit(db, { actor, action: "funding_pathway_eligibility", entity: "funding_pathways", entityId: id, after: { eligibility, source } });
  return row;
}

export async function setPathwayStatus(db: Db, id: string, status: string, actor: string) {
  const [cur] = await db.select().from(fundingPathways).where(eq(fundingPathways.id, id));
  if (!cur) throw new Error("Pathway not found");
  if ((status === "eligible" || status === "preparing" || status === "submitted") && cur.eligibility === "not_eligible") throw new Error("This pathway is recorded as not eligible.");
  if (status === "eligible" && cur.eligibility === "unknown") throw new Error("Record the eligibility screen first.");
  await db.update(fundingPathways).set({ status: status as never, updatedAt: new Date().toISOString() }).where(eq(fundingPathways.id, id));
  await audit(db, { actor, action: "funding_pathway_status", entity: "funding_pathways", entityId: id, before: { status: cur.status }, after: { status } });
}

export async function updatePathwaySteps(db: Db, id: string, change: { toggle?: string; add?: { label: string; due: string | null }; due?: { id: string; due: string | null } }, actor: string) {
  const [cur] = await db.select().from(fundingPathways).where(eq(fundingPathways.id, id));
  if (!cur) throw new Error("Pathway not found");
  let steps = [...cur.steps];
  if (change.toggle) steps = steps.map(s => (s.id === change.toggle ? { ...s, done: !s.done } : s));
  if (change.add) steps.push({ id: `s${Date.now().toString(36)}`, label: change.add.label, due: change.add.due, done: false });
  if (change.due) steps = steps.map(s => (s.id === change.due!.id ? { ...s, due: change.due!.due } : s));
  await db.update(fundingPathways).set({ steps, updatedAt: new Date().toISOString() }).where(eq(fundingPathways.id, id));
  await audit(db, { actor, action: "funding_pathway_steps", entity: "funding_pathways", entityId: id, after: change });
  return steps;
}

export function pathwayProgress(steps: PathwayStep[]) {
  const done = steps.filter(s => s.done).length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0, next: steps.find(s => !s.done) ?? null };
}

const OPEN = ["identified", "screening", "eligible", "preparing", "submitted", "in_diligence"];

/** Deadlines within `days`, and overdue steps, for Today and notifications. */
export async function pathwayAlerts(db: Db, mandateIds: string[], today: string, days = 30) {
  if (!mandateIds.length) return [];
  const rows = await db.select({ id: fundingPathways.id, name: fundingPathways.name, projectId: fundingPathways.projectId, projectName: projects.name, deadline: fundingPathways.deadline, status: fundingPathways.status, steps: fundingPathways.steps, owner: fundingPathways.owner })
    .from(fundingPathways).innerJoin(projects, eq(projects.id, fundingPathways.projectId))
    .where(and(sql`${fundingPathways.mandateId} in ${mandateIds}`, sql`${fundingPathways.status} in ${OPEN}`)).orderBy(asc(fundingPathways.deadline));
  const limit = new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
  const out: { id: string; projectId: string; title: string; detail: string; due: string | null; severity: "high" | "medium"; owner: string | null }[] = [];
  for (const r of rows) {
    if (r.deadline && r.deadline <= limit) out.push({ id: r.id, projectId: r.projectId, title: `${r.name} deadline`, detail: `${r.projectName}: ${pathwayProgress(r.steps).done}/${r.steps.length} steps done`, due: r.deadline, severity: r.deadline < today ? "high" : "medium", owner: r.owner });
    for (const s of r.steps) if (!s.done && s.due && s.due < today) out.push({ id: `${r.id}:${s.id}`, projectId: r.projectId, title: `Overdue step: ${s.label}`, detail: `${r.name} · ${r.projectName}`, due: s.due, severity: "medium", owner: r.owner });
  }
  return out;
}
