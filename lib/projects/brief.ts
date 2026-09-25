// Project brief (docs/master-spec.md part LXXXVI): identity, place, readiness, constraints, capital stack, regulatory
// status and agreements, as Markdown for the branded PDF renderer. Unknown stays visible as Unknown.
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalRequirements, capitalTranches, constraints, contracts, decisions, designPackages, economicCases, esIssues, insurancePolicies, organizations, permits, placeFacts, projectJurisdictions, projectParties, projectReadiness, projects, requirements, risks, studies } from "@/db/schema";
import { projectPlan, studyGaps } from "@/lib/delivery/engine";
import { DESIGN_STAGES, DISCIPLINES, ES_FRAMEWORKS, ES_STATUSES, ES_TOPICS, INSURANCE_STATUSES, INSURANCE_TYPES, MITIGATION_STEPS, STUDY_STATUSES, STUDY_TYPES } from "@/lib/delivery/vocab";
import { BOUNDARY, CASE_KINDS } from "@/lib/economics/vocab";
import { LIFECYCLE, typeLabel } from "@/lib/contracts/catalog";
import { JURISDICTION_ROLES, PERMIT_STATUSES, REQUIREMENT_STATUSES } from "@/lib/regulatory/vocab";
import { compactMoney, stageLabel } from "./labels";
import { ASSET_CLASSES, CAPITAL_STATUSES, CONSTRAINT_CATEGORIES, IMPACT, INSTRUMENTS, LIKELIHOOD, PARTY_ROLES, READINESS_DIMENSIONS, READINESS_STATUSES, REGENERA_ROLES, RISK_CATEGORIES, SEVERITIES } from "./vocab";

export async function projectBriefMarkdown(db: Db, projectId: string, today: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return null;
  const riskRows = await db.select().from(risks).where(eq(risks.projectId, projectId));
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
  const [plan, st, dp, es, ins, cases, openDecisions] = await Promise.all([
    projectPlan(db, projectId, today),
    db.select().from(studies).where(eq(studies.projectId, projectId)),
    db.select().from(designPackages).where(eq(designPackages.projectId, projectId)),
    db.select().from(esIssues).where(eq(esIssues.projectId, projectId)),
    db.select().from(insurancePolicies).where(eq(insurancePolicies.projectId, projectId)),
    db.select().from(economicCases).where(eq(economicCases.projectId, projectId)),
    db.select().from(decisions).where(eq(decisions.projectId, projectId)),
  ]);
  const gaps = studyGaps(p, st);
  const pc = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
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
    "## Risks",
    ...(riskRows.filter(x => x.status !== "closed").length ? riskRows.filter(x => x.status !== "closed").map(x => `- **${RISK_CATEGORIES[x.category]}** (${LIKELIHOOD[x.likelihood]} / ${IMPACT[x.impact]}): ${x.description}${x.mitigation ? ` · mitigation: ${x.mitigation}` : ""}`) : ["None recorded."]), "",
    "## Plan and critical path",
    ...(plan.milestones.length ? [
      ...(plan.cpm.finish ? [`Forecast finish of remaining work: ${plan.cpm.finish}.`] : []),
      ...plan.milestones.filter(m => m.status !== "cancelled").map(m => {
        const n = plan.cpm.nodes.get(m.id);
        return `- ${n?.critical ? "**Critical** " : ""}${m.name}: ${m.status === "done" ? `done ${m.completedAt}` : `forecast ${n?.finish ?? "?"}${m.dueDate ? `, due ${m.dueDate}` : ""}${n?.lateDays ? ` (${n.lateDays} days late)` : ""}`}${m.owner ? ` · ${m.owner}` : ""}${m.evidence ? ` · ${m.evidence}` : ""}`;
      }),
    ] : ["No milestones recorded."]),
    ...openDecisions.filter(d => d.status === "open").map(d => `- Decision needed: ${d.title}${d.dueDate ? ` by ${d.dueDate}` : ""}`), "",
    "## Engineering",
    ...(st.length ? st.map(s => `- ${STUDY_TYPES[s.type]}${s.title ? ` (${s.title})` : ""}: ${STUDY_STATUSES[s.status]}${s.provider ? ` · ${s.provider}` : ""}${s.reviewer ? ` · reviewed by ${s.reviewer}` : ""}`) : ["No studies recorded."]),
    ...(gaps.missing.length ? [`Missing studies: ${gaps.missing.map(t => STUDY_TYPES[t]).join(", ")}.`] : []),
    ...(dp.length ? [`Design: ${dp.filter(x => x.status !== "superseded").map(x => `${DISCIPLINES[x.discipline]} ${DESIGN_STAGES[x.stage]}`).join("; ")}.`] : []), "",
    "## Environmental and social",
    ...(es.filter(x => x.status !== "closed").length ? es.filter(x => x.status !== "closed").map(x => `- **${SEVERITIES[x.severity]}** ${ES_TOPICS[x.topic]} (${ES_FRAMEWORKS[x.framework]}${x.reference ? `, ${x.reference}` : ""}): ${x.description} · ${MITIGATION_STEPS[x.mitigationStep]} · ${ES_STATUSES[x.status]}`) : ["No open issues recorded."]), "",
    "## Insurance",
    ...(ins.length ? ins.map(x => `- ${INSURANCE_TYPES[x.type]}: ${INSURANCE_STATUSES[x.status]}${x.insurer ? ` · ${x.insurer}` : ""}${x.expiresAt ? ` · expires ${x.expiresAt}` : ""}`) : ["Not recorded."]), "",
    "## Capital stack",
    ...(reqs.length ? reqs.flatMap(r => [
      `- **${r.purpose}** (${INSTRUMENTS[r.instrument]}): ${compactMoney(r.target, r.currency)} target, ${compactMoney(r.secured, r.currency)} secured · ${CAPITAL_STATUSES[r.status]}${r.targetClose ? ` · close ${r.targetClose}` : ""}`,
      ...tranches.filter(t => t.requirementId === r.id).map(t => `- Tranche ${t.name}: ${compactMoney(t.target, t.currency)}${t.targetInvestorType ? ` for ${t.targetInvestorType}` : ""}`),
    ]) : ["No capital requirements recorded."]), "",
    "## Screening economics",
    ...(cases.filter(c => c.outputs).length ? [
      ...cases.filter(c => c.outputs).map(c => `- ${c.name} (${CASE_KINDS[c.kind]}): project IRR ${pc(c.outputs!.projectIrr)}, equity IRR ${pc(c.outputs!.equityIrr)}, min DSCR ${c.outputs!.minDscr === null ? "n/a" : c.outputs!.minDscr.toFixed(2) + "x"}, NPV ${compactMoney(c.outputs!.npv, c.inputs.currency)}${c.source ? ` · ${c.source}` : ""}`),
      BOUNDARY,
    ] : ["No economic case recorded."]), "",
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
