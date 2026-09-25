// Project brief (docs/master-spec.md part LXXXVI): identity, place, readiness, constraints, capital stack, regulatory
// status and agreements, as Markdown for the branded PDF renderer. Unknown stays visible as Unknown.
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalRequirements, capitalTranches, constraints, contracts, organizations, permits, placeFacts, projectJurisdictions, projectParties, projectReadiness, projects, requirements } from "@/db/schema";
import { LIFECYCLE, typeLabel } from "@/lib/contracts/catalog";
import { JURISDICTION_ROLES, PERMIT_STATUSES, REQUIREMENT_STATUSES } from "@/lib/regulatory/vocab";
import { compactMoney, stageLabel } from "./labels";
import { ASSET_CLASSES, CAPITAL_STATUSES, CONSTRAINT_CATEGORIES, INSTRUMENTS, PARTY_ROLES, READINESS_DIMENSIONS, READINESS_STATUSES, REGENERA_ROLES, SEVERITIES } from "./vocab";

export async function projectBriefMarkdown(db: Db, projectId: string, today: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return null;
  const [parties, readiness, cons, reqs, tranches, facts, juris, regs, permitRows, agreements] = await Promise.all([
    db.select({ role: projectParties.role, confirmed: projectParties.confirmed, name: organizations.name }).from(projectParties).leftJoin(organizations, eq(organizations.id, projectParties.orgId)).where(eq(projectParties.projectId, projectId)),
    db.select().from(projectReadiness).where(eq(projectReadiness.projectId, projectId)),
    db.select().from(constraints).where(eq(constraints.projectId, projectId)),
    db.select().from(capitalRequirements).where(eq(capitalRequirements.projectId, projectId)).orderBy(asc(capitalRequirements.targetClose)),
    db.select().from(capitalTranches).where(eq(capitalTranches.projectId, projectId)),
    db.select().from(placeFacts).where(eq(placeFacts.projectId, projectId)).orderBy(asc(placeFacts.dimension)),
    db.select().from(projectJurisdictions).where(eq(projectJurisdictions.projectId, projectId)),
    db.select().from(requirements).where(eq(requirements.projectId, projectId)),
    db.select().from(permits).where(eq(permits.projectId, projectId)),
    db.select().from(contracts).where(eq(contracts.projectId, projectId)),
  ]);
  const open = cons.filter(c => c.status === "open" || c.status === "in_progress");
  const where = [p.municipality, p.subdivision, p.country].filter(Boolean).join(", ") || "Location not recorded";
  const asset = [p.assetClass ? ASSET_CLASSES[p.assetClass] : null, p.technology, p.capacity ? `${p.capacity} ${p.capacityUnit ?? ""}` : null].filter(Boolean).join(" · ");
  const lines = [
    `# ${p.name}`, "",
    `**Stage:** ${stageLabel(p.stage)} · **Status:** ${p.status.replace(/_/g, " ")}`,
    `**Location:** ${where}${p.lat !== null ? ` (${p.lat}, ${p.lng})` : ""}`,
    `**Asset:** ${asset || "Not recorded"}`,
    `**CAPEX:** ${p.capex ? compactMoney(p.capex, p.currency ?? "USD") : "Not recorded"} · **Regenera role:** ${p.regeneraRole ? REGENERA_ROLES[p.regeneraRole] : "Not set"}`, "",
    ...(p.description ? [p.description, ""] : []),
    "## Parties",
    ...(parties.length ? parties.map(x => `- ${PARTY_ROLES[x.role]}: ${x.name ?? "person"}${x.confirmed === "proposed" ? " (proposed)" : ""}`) : ["Not recorded."]), "",
    "## Place",
    ...(facts.length ? facts.map(f => `- ${f.label}: ${f.value} (${f.integrationKey}, tier ${f.tier}, ${f.retrievedAt.slice(0, 10)}${f.state === "stale" ? ", stale" : ""})`) : ["No place profile yet."]), "",
    "## Readiness",
    ...Object.entries(READINESS_DIMENSIONS).map(([k, label]) => {
      const r = readiness.find(x => x.dimension === k);
      return `- ${label}: ${READINESS_STATUSES[r?.status ?? "unknown"]}${r?.evidence ? ` (${r.evidence})` : ""}`;
    }), "",
    "## Open constraints",
    ...(open.length ? open.map(c => `- **${SEVERITIES[c.severity]}** ${CONSTRAINT_CATEGORIES[c.category]}: ${c.description}${c.owner ? ` · owner ${c.owner}` : ""}${c.deadline ? ` · due ${c.deadline}` : ""}${c.resolutionAction ? ` · ${c.resolutionAction}` : ""}`) : ["None recorded."]), "",
    "## Capital stack",
    ...(reqs.length ? reqs.flatMap(r => [
      `- **${r.purpose}** (${INSTRUMENTS[r.instrument]}): ${compactMoney(r.target, r.currency)} target, ${compactMoney(r.secured, r.currency)} secured · ${CAPITAL_STATUSES[r.status]}${r.targetClose ? ` · close ${r.targetClose}` : ""}`,
      ...tranches.filter(t => t.requirementId === r.id).map(t => `- Tranche ${t.name}: ${compactMoney(t.target, t.currency)}${t.targetInvestorType ? ` for ${t.targetInvestorType}` : ""}`),
    ]) : ["No capital requirements recorded."]), "",
    "## Regulatory",
    ...(juris.length ? [`Jurisdictions: ${juris.map(j => `${JURISDICTION_ROLES[j.role]} ${j.jurisdiction}`).join("; ")}`] : ["Jurisdiction matrix not recorded."]),
    ...regs.map(r => `- ${r.track === "lender_standard" ? "Lender standard" : "Host law"}: ${r.title} · ${REQUIREMENT_STATUSES[r.status]}${r.reviewer ? ` (reviewed by ${r.reviewer})` : ""}`),
    ...permitRows.map(x => `- Permit ${x.name} (${x.authority || "authority not recorded"}): ${PERMIT_STATUSES[x.status]}${x.expiresAt ? `, expires ${x.expiresAt}` : ""}`), "",
    "## Agreements",
    ...(agreements.length ? agreements.map(c => `- ${c.title} · ${c.kind === "registered" ? typeLabel(c.category, c.contractType) : c.kind.replace(/_/g, " ")} · ${LIFECYCLE[c.lifecycle]}`) : ["None recorded."]), "",
    `Prepared ${today} from Regenera OS records. Facts carry their sources; this brief is not legal, engineering or investment advice.`,
  ];
  return { title: p.name, md: lines.join("\n") };
}
