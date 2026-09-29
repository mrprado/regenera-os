// Community rights, knowledge governance and community economic participation engine.
// - Knowledge: a permission is effective only when recorded for the exact activity, unexpired, not withdrawn, and
//   approved by a verified authority of the same community holding the power the activity needs. The holder who
//   shared knowledge is a separate entity and can never approve. Existence-only records never allow anything.
// - Withdrawal and expiry propagate: every recorded use is flagged and a remediation task is created; nothing is deleted.
// - Consent: consultation is never consent; a grant needs a verified authority, evidence and a date.
// - Economics: community terms run through the project finance model (as costs before distributions, plus an equity
//   share of distributions), so investor, lender and community figures come from one calculation. The three ledgers
//   (mitigation / participation / development) are totalled separately and never summed into one figure.
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  communities, communityAuthorities, communityCommitments, communityGrievances, communityLedger, communityRights, consentRecords, finModels, knowledgePermissions,
  knowledgeRecords, knowledgeUses, participationStructures, projects, tasks,
} from "@/db/schema";
import type { StructureTerms } from "@/db/community";
import type { Db } from "@/db";
import { audit } from "@/lib/audit";
import { calculate, irr, npv } from "@/lib/finance/calc";
import type { ModelDefinition, OpexLine } from "@/lib/finance/types";
import {
  ACTIVITY_POWER, AI_ACTIVITIES, CONSENT_GRANTED, DISCLOSURES, EXISTENCE_ONLY, LEDGER_OF, type AccessStatus, type Activity, type ConsentStatus, type Ledger, type ParticipationType,
} from "./vocab";

type KRecord = typeof knowledgeRecords.$inferSelect;
type Structure = typeof participationStructures.$inferSelect;
type Authority = typeof communityAuthorities.$inferSelect;

// ---------------- Knowledge governance ----------------
export const isExistenceOnly = (r: Pick<KRecord, "accessStatus">) => EXISTENCE_ONLY.includes(r.accessStatus as AccessStatus);

/** What anyone allowed to see the record at all may see. Existence-only records reveal only that governed knowledge exists. */
export function publicView(r: KRecord) {
  if (isExistenceOnly(r)) return { id: r.id, title: "Culturally governed knowledge exists", description: "Access restricted. Contact the authorised custodian.", category: r.category, accessStatus: r.accessStatus, restricted: true, location: null as string | null };
  return { id: r.id, title: r.title, description: r.descriptionPublic, category: r.category, accessStatus: r.accessStatus, restricted: r.accessStatus !== "public", location: r.spatialSensitivity === "none" ? r.generalizedArea : r.spatialSensitivity === "generalise" ? r.generalizedArea : null };
}

export async function createKnowledgeRecord(db: Db, input: Omit<typeof knowledgeRecords.$inferInsert, "id" | "createdAt" | "updatedAt" | "createdBy">, actor: string) {
  const existence = EXISTENCE_ONLY.includes((input.accessStatus ?? "restricted") as AccessStatus);
  const values = {
    ...input, createdBy: actor,
    // Minimal metadata only for sacred / existence-only knowledge: no description, no content pointer, no location.
    ...(existence ? { descriptionPublic: "", protectedContentRef: null, generalizedArea: "", spatialSensitivity: "hide" as const, governanceStatus: input.accessStatus === "sacred" || input.accessStatus === "non_digitizable" ? "sacred_do_not_digitize" as const : "restricted" as const } : {}),
  };
  const [r] = await db.insert(knowledgeRecords).values(values).returning();
  // Restrictive defaults: every AI activity starts prohibited until an authority decides otherwise.
  await db.insert(knowledgePermissions).values(AI_ACTIVITIES.map(activity => ({ mandateId: r.mandateId, recordId: r.id, activity, status: "prohibited" as const, notes: "Default: AI use prohibited until authorised", createdBy: actor })));
  await audit(db, { actor, action: "knowledge.create", entity: "knowledge_record", entityId: r.id, after: { category: r.category, accessStatus: r.accessStatus } });
  return r;
}

export type PermissionCheck = { allowed: boolean; conditions: string; reason: string };
/** The single gate every knowledge use passes through (UI, exports, portal, AI context, map layers). */
export async function checkPermission(db: Db, recordId: string, activity: Activity, now = new Date()): Promise<PermissionCheck> {
  const [r] = await db.select().from(knowledgeRecords).where(eq(knowledgeRecords.id, recordId));
  if (!r || r.deletedAt) return { allowed: false, conditions: "", reason: "Record not found" };
  if (r.withdrawn) return { allowed: false, conditions: "", reason: "Permission withdrawn for this record" };
  if (isExistenceOnly(r)) return { allowed: false, conditions: "", reason: "Existence-only record: no use of its content is possible through the OS" };
  const [p] = await db.select().from(knowledgePermissions).where(and(eq(knowledgePermissions.recordId, recordId), eq(knowledgePermissions.activity, activity), isNull(knowledgePermissions.deletedAt)));
  if (!p) return { allowed: false, conditions: "", reason: "No permission recorded for this activity" };
  if (p.status !== "allowed" && p.status !== "allowed_with_conditions") return { allowed: false, conditions: "", reason: `Permission ${p.status.replace(/_/g, " ")}` };
  if (p.expiryDate && p.expiryDate < now.toISOString().slice(0, 10)) return { allowed: false, conditions: "", reason: `Permission expired ${p.expiryDate}` };
  const [a] = p.approvingAuthorityId ? await db.select().from(communityAuthorities).where(eq(communityAuthorities.id, p.approvingAuthorityId)) : [];
  const why = authorityProblem(a, r, activity);
  if (why) return { allowed: false, conditions: "", reason: why };
  return { allowed: true, conditions: p.conditions, reason: p.status === "allowed_with_conditions" ? `Allowed with conditions: ${p.conditions}` : "Allowed" };
}

function authorityProblem(a: Authority | undefined, r: Pick<KRecord, "communityId" | "category">, activity: Activity): string | null {
  if (!a) return "No approving authority recorded (the person who shared knowledge is not an authority)";
  if (a.deletedAt) return "Approving authority removed";
  if (a.verificationStatus !== "verified") return "Approving authority not verified";
  if (r.communityId && a.communityId !== r.communityId) return "Approving authority belongs to another community";
  const power = ACTIVITY_POWER[activity];
  if (power && !a.powers.includes(power)) return `Authority has no recorded power to authorise ${power === "ai" ? "AI use" : power}`;
  if (!power && a.powers.length === 0) return "Authority has no recorded powers";
  if (a.knowledgeCategories.length && !a.knowledgeCategories.includes(r.category)) return `Authority does not govern ${r.category} knowledge`;
  if (a.termEnd && a.termEnd < new Date().toISOString().slice(0, 10)) return "Authority's term has ended";
  return null;
}

export async function setPermission(db: Db, input: { recordId: string; activity: Activity; status: "allowed" | "allowed_with_conditions" | "prohibited" | "pending"; authorityId: string | null; conditions?: string; expiryDate?: string | null; evidence?: string }, actor: string) {
  const [r] = await db.select().from(knowledgeRecords).where(eq(knowledgeRecords.id, input.recordId));
  if (!r) throw new Error("Record not found");
  if (input.status === "allowed" || input.status === "allowed_with_conditions") {
    if (isExistenceOnly(r)) throw new Error("Existence-only records cannot be opened to any use through the OS");
    if (r.withdrawn) throw new Error("Permission was withdrawn for this record; a new authorisation is needed from the authority");
    const [a] = input.authorityId ? await db.select().from(communityAuthorities).where(eq(communityAuthorities.id, input.authorityId)) : [];
    const why = authorityProblem(a, r, input.activity);
    if (why) throw new Error(why);
    if (!input.evidence?.trim()) throw new Error("Record the evidence of the authorisation (document, minutes, recorded decision)");
    if (input.status === "allowed_with_conditions" && !input.conditions?.trim()) throw new Error("State the conditions");
  }
  const values = { status: input.status, approvingAuthorityId: input.authorityId, conditions: input.conditions ?? "", expiryDate: input.expiryDate ?? null, evidence: input.evidence ?? "", approvalDate: input.status.startsWith("allowed") ? new Date().toISOString().slice(0, 10) : null, updatedBy: actor, updatedAt: new Date().toISOString() };
  const [existing] = await db.select().from(knowledgePermissions).where(and(eq(knowledgePermissions.recordId, input.recordId), eq(knowledgePermissions.activity, input.activity)));
  if (existing) await db.update(knowledgePermissions).set(values).where(eq(knowledgePermissions.id, existing.id));
  else await db.insert(knowledgePermissions).values({ ...values, mandateId: r.mandateId, recordId: input.recordId, activity: input.activity, createdBy: actor });
  await audit(db, { actor, action: "knowledge.permission", entity: "knowledge_record", entityId: input.recordId, before: existing ? { status: existing.status } : undefined, after: { activity: input.activity, status: input.status } });
}

/** Record that knowledge was used in an output. Refused unless the activity is currently permitted. */
export async function recordUse(db: Db, recordId: string, activity: Activity, output: { type: string; ref: string; description?: string }, actor: string) {
  const c = await checkPermission(db, recordId, activity);
  if (!c.allowed) {
    await audit(db, { actor, action: "knowledge.use_refused", entity: "knowledge_record", entityId: recordId, after: { activity, reason: c.reason } });
    throw new Error(`Not permitted: ${c.reason}`);
  }
  const [r] = await db.select({ mandateId: knowledgeRecords.mandateId }).from(knowledgeRecords).where(eq(knowledgeRecords.id, recordId));
  await db.insert(knowledgeUses).values({ mandateId: r.mandateId, recordId, activity, outputType: output.type, outputRef: output.ref, description: output.description ?? "", usedBy: actor });
  await audit(db, { actor, action: "knowledge.use", entity: "knowledge_record", entityId: recordId, after: { activity, output } });
}

/** Withdrawal: restrict the record (or one activity), flag derivative outputs and create remediation tasks. Audit history is kept. */
export async function withdraw(db: Db, recordId: string, actor: string, reason: string, activity?: Activity) {
  if (!reason.trim()) throw new Error("Record the withdrawal instruction (who, when, how received)");
  const [r] = await db.select().from(knowledgeRecords).where(eq(knowledgeRecords.id, recordId));
  if (!r) throw new Error("Record not found");
  const at = new Date().toISOString();
  if (activity) await db.update(knowledgePermissions).set({ status: "withdrawn", updatedBy: actor, updatedAt: at, notes: reason }).where(and(eq(knowledgePermissions.recordId, recordId), eq(knowledgePermissions.activity, activity)));
  else {
    await db.update(knowledgePermissions).set({ status: "withdrawn", updatedBy: actor, updatedAt: at, notes: reason }).where(eq(knowledgePermissions.recordId, recordId));
    await db.update(knowledgeRecords).set({ withdrawn: true, publicationStatus: "prohibited", updatedBy: actor, updatedAt: at }).where(eq(knowledgeRecords.id, recordId));
  }
  return propagate(db, r, activity ? [activity] : null, `Withdrawn: ${reason}`, actor);
}

async function propagate(db: Db, r: KRecord, activities: Activity[] | null, why: string, actor: string) {
  const uses = await db.select().from(knowledgeUses).where(and(eq(knowledgeUses.recordId, r.id), eq(knowledgeUses.status, "active")));
  const hit = uses.filter(u => !activities || activities.includes(u.activity as Activity));
  for (const u of hit) {
    await db.update(knowledgeUses).set({ status: "flagged", flaggedReason: why }).where(eq(knowledgeUses.id, u.id));
    await db.insert(tasks).values({ mandateId: r.mandateId, projectId: r.projectId, type: "other", title: `Remediate knowledge use: ${u.outputType} ${u.outputRef}`.slice(0, 200), body: `${why}. The output used restricted knowledge under "${u.activity}". Withdraw, redact or re-authorise it; keep the governance record.`, dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) });
  }
  await audit(db, { actor, action: "knowledge.propagate", entity: "knowledge_record", entityId: r.id, after: { why, flagged: hit.length } });
  return { flagged: hit.length };
}

/** Tick job: expire permissions past their date and propagate. */
export async function expirePermissions(db: Db, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const due = await db.select().from(knowledgePermissions).where(and(inArray(knowledgePermissions.status, ["allowed", "allowed_with_conditions"]), lte(knowledgePermissions.expiryDate, today)));
  let flagged = 0;
  for (const p of due) {
    if (!p.expiryDate || p.expiryDate >= today) continue;
    await db.update(knowledgePermissions).set({ status: "expired", updatedAt: now.toISOString(), updatedBy: "system" }).where(eq(knowledgePermissions.id, p.id));
    const [r] = await db.select().from(knowledgeRecords).where(eq(knowledgeRecords.id, p.recordId));
    if (r) flagged += (await propagate(db, r, [p.activity as Activity], `Permission expired ${p.expiryDate}`, "system")).flagged;
  }
  return { expired: due.length, flagged };
}

// ---------------- Consent / FPIC ----------------
export function consentLabel(s: ConsentStatus) {
  return CONSENT_GRANTED.includes(s) ? "Documented consent" : s === "consultation_underway" || s === "engagement_initiated" ? "Engagement ongoing (not consent)" : s;
}
export function missingDisclosures(d: Record<string, boolean | undefined>) { return Object.keys(DISCLOSURES).filter(k => !d[k]); }

export async function setConsentStatus(db: Db, id: string, to: ConsentStatus, actor: string, o: { note?: string; evidence?: string; date?: string; conditions?: string; expiryDate?: string | null } = {}) {
  const [c] = await db.select().from(consentRecords).where(eq(consentRecords.id, id));
  if (!c) throw new Error("Consent record not found");
  const warnings: string[] = [];
  if (CONSENT_GRANTED.includes(to)) {
    const [a] = c.authorityId ? await db.select().from(communityAuthorities).where(eq(communityAuthorities.id, c.authorityId)) : [];
    if (!a || a.verificationStatus !== "verified") throw new Error("Consent can only be recorded from a verified authority of the community");
    if (a.communityId !== c.communityId) throw new Error("The authority belongs to another community");
    if (c.consentType === "fpic" && !a.powers.includes("consent")) throw new Error("This authority has no recorded power to give or withhold project consent");
    if (!(o.evidence ?? c.evidence).trim()) throw new Error("Record the evidence of consent (signed record, assembly minutes, recording reference)");
    if (!(o.date ?? c.consentDate)) throw new Error("Record the consent date");
    if (to === "granted_with_conditions" && !(o.conditions ?? c.conditions).trim()) throw new Error("State the conditions of consent");
    const miss = missingDisclosures(c.disclosures as Record<string, boolean>);
    if (miss.length) warnings.push(`Not disclosed before consent: ${miss.join(", ")}`);
  }
  if ((to === "withheld" || to === "withdrawn" || to === "suspended") && !o.note?.trim()) throw new Error("Record what was communicated and by whom");
  const history = [...c.history, { at: new Date().toISOString(), from: c.status, to, by: actor, note: [o.note, ...warnings].filter(Boolean).join(" · ") || undefined }];
  await db.update(consentRecords).set({
    status: to, history, evidence: o.evidence ?? c.evidence, consentDate: o.date ?? c.consentDate, conditions: o.conditions ?? c.conditions,
    expiryDate: o.expiryDate === undefined ? c.expiryDate : o.expiryDate, updatedBy: actor, updatedAt: new Date().toISOString(),
  }).where(eq(consentRecords.id, id));
  if (c.knowledgeRecordId) await db.update(knowledgeRecords).set({ consentStatus: to, updatedAt: new Date().toISOString() }).where(eq(knowledgeRecords.id, c.knowledgeRecordId));
  // Withdrawal of consent tied to a knowledge record withdraws its permissions too.
  if (to === "withdrawn" && c.knowledgeRecordId) await withdraw(db, c.knowledgeRecordId, actor, `Consent withdrawn: ${o.note}`);
  await audit(db, { actor, action: "consent.status", entity: "consent_record", entityId: id, before: { status: c.status }, after: { status: to, warnings } });
  return { warnings };
}

// ---------------- Economics ----------------
export type CommunityYear = {
  year: number; revenue: number; leasePayments: number; revenueShare: number; royalties: number; stewardship: number; fixed: number; equityDistributions: number; stakeFlow: number;
  participation: number; development: number; investorDistributions: number; cumulative: number; real: number; discounted: number;
};
const CODE = { lease: "cp_lease", rev: "cp_revenue_share", roy: "cp_royalty", stew: "cp_stewardship", fund: "cp_fund", fixed: "cp_fixed" };
const opex = (id: string, label: string, kind: OpexLine["kind"], amount: number, esc = 0): OpexLine => ({ id, label, kind, amount, escalationPct: esc, source: "Community participation structure", date: null, owner: null, confidence: "moderate", status: "preliminary" });

/** Adds community contractual payments to a model as operating costs (paid before debt service and distributions). */
export function withCommunityTerms(def: ModelDefinition, structures: Pick<Structure, "id" | "type" | "terms" | "inflationIndexed" | "name">[], inflationPct = 0): ModelDefinition {
  const lines: OpexLine[] = [];
  for (const s of structures) {
    const t = s.terms as StructureTerms;
    const esc = s.inflationIndexed ? inflationPct : (t.leaseEscalationPct ?? 0);
    if (t.leasePerYear) lines.push(opex(`${CODE.lease}:${s.id}`, `${s.name}: land lease`, "fixed", t.leasePerYear, esc));
    if (t.revenueSharePct && s.type !== "net_revenue_share" && s.type !== "profit_participation" && s.type !== "fcf_participation") lines.push(opex(`${CODE.rev}:${s.id}`, `${s.name}: gross revenue share`, "pct_revenue", t.revenueSharePct));
    if (t.royaltyPct) lines.push(opex(`${CODE.roy}:${s.id}`, `${s.name}: royalty`, "pct_revenue", t.royaltyPct));
    if (t.stewardshipPerYear) lines.push(opex(`${CODE.stew}:${s.id}`, `${s.name}: stewardship contract`, "fixed", t.stewardshipPerYear, s.inflationIndexed ? inflationPct : 0));
    if (t.fundPctOfRevenue) lines.push(opex(`${CODE.fund}:${s.id}`, `${s.name}: community fund allocation`, "pct_revenue", t.fundPctOfRevenue));
    if (t.fixedPerYear) lines.push(opex(`${CODE.fixed}:${s.id}`, `${s.name}: fixed payment`, "fixed", t.fixedPerYear, s.inflationIndexed ? inflationPct : 0));
  }
  return { ...def, opex: [...def.opex.filter(o => !o.id.startsWith("cp_")), ...lines] };
}

/** Year-by-year community and investor cash flows for one scenario, computed from the project model. */
export function communityEconomics(def: ModelDefinition, structures: Structure[], o: { inflationPct: number; discountPct: number }) {
  const m = withCommunityTerms(def, structures, o.inflationPct);
  const out = calculate(m);
  const equity = structures.filter(s => /equity/.test(s.type) || s.type === "land_for_equity" || s.type === "lease_to_equity");
  const eqPct = Math.min(100, equity.reduce((a, s) => a + ((s.terms as StructureTerms).equityPct ?? 0), 0)) / 100;
  const carried = equity.some(s => s.type === "carried_equity" || (s.terms as StructureTerms).stakeFunding === "sponsor_funded");
  const netShare = structures.filter(s => s.type === "net_revenue_share" || s.type === "profit_participation" || s.type === "fcf_participation").reduce((a, s) => a + ((s.terms as StructureTerms).revenueSharePct ?? 0), 0) / 100;
  const ops = out.periods.filter(p => p.phase === "operations");
  const opIdx = new Map(ops.map((p, i) => [p, i + 1]));
  const share = (p: (typeof out.periods)[number], kind: "fixed" | "pct_revenue", idPrefix: string) => m.opex.filter(l => l.id.startsWith(idPrefix)).reduce((a, l) => {
    const y = opIdx.get(p) ?? 0; if (!y) return a;
    return a + (l.kind === "fixed" ? l.amount * (1 + l.escalationPct / 100) ** (y - 1) : (l.amount / 100) * p.revenue);
  }, 0);
  const isDev = (id: string) => { const sid = id.split(":")[1]; const s = structures.find(x => x.id === sid); return s ? LEDGER_OF[s.type as ParticipationType] === "development" : false; };
  let cum = 0;
  const rows: CommunityYear[] = out.periods.map((p, i) => {
    const dist = Math.max(0, p.equityFlow);
    const contrib = Math.min(0, p.equityFlow);
    const netPart = p.phase === "operations" ? netShare * dist : 0;
    const commEq = eqPct * (dist - netPart);
    const stakeFlow = carried ? 0 : eqPct * contrib;
    const lease = share(p, "fixed", CODE.lease), rev = share(p, "pct_revenue", CODE.rev), roy = share(p, "pct_revenue", CODE.roy), stew = share(p, "fixed", CODE.stew), fixed = share(p, "fixed", CODE.fixed);
    const devAmt = m.opex.filter(l => l.id.startsWith("cp_") && isDev(l.id)).reduce((a, l) => { const y = opIdx.get(p) ?? 0; if (!y) return a; return a + (l.kind === "fixed" ? l.amount * (1 + l.escalationPct / 100) ** (y - 1) : (l.amount / 100) * p.revenue); }, 0);
    const fund = share(p, "pct_revenue", CODE.fund);
    const participation = lease + rev + roy + stew + fixed + fund + commEq + netPart + stakeFlow - devAmt;
    const investorDistributions = (1 - eqPct) * (dist - netPart) + (carried ? contrib : (1 - eqPct) * contrib);
    cum += participation;
    const t = i + 1;
    return { year: p.year, revenue: p.revenue, leasePayments: lease, revenueShare: rev + netPart, royalties: roy, stewardship: stew, fixed: fixed + fund - devAmt, equityDistributions: commEq, stakeFlow, participation, development: devAmt, investorDistributions, cumulative: cum, real: participation / (1 + o.inflationPct / 100) ** t, discounted: participation / (1 + o.discountPct / 100) ** t };
  });
  const invFlows = rows.map(r => r.investorDistributions);
  const commFlows = rows.map(r => r.participation);
  const opRows = rows.filter((_, i) => out.periods[i].phase === "operations");
  const invIn = -invFlows.filter(x => x < 0).reduce((a, b) => a + b, 0), invOut = invFlows.filter(x => x > 0).reduce((a, b) => a + b, 0);
  return {
    rows, projectIrr: out.projectIrr, investorIrr: irr(invFlows), investorMoic: invIn > 0 ? invOut / invIn : null, minDscr: out.minDscr, debt: out.debt,
    communityNominal: commFlows.reduce((a, b) => a + b, 0), communityReal: rows.reduce((a, r) => a + r.real, 0), communityNpv: npv(o.discountPct, commFlows),
    communityIrr: rows.some(r => r.stakeFlow < 0) ? irr(commFlows) : null, annualAverage: opRows.length ? opRows.reduce((a, r) => a + r.participation, 0) / opRows.length : 0,
    developmentNominal: rows.reduce((a, r) => a + r.development, 0), shareOfProjectCash: out.periods.reduce((a, p) => a + Math.max(0, p.revenue), 0) ? commFlows.reduce((a, b) => a + b, 0) / out.periods.reduce((a, p) => a + Math.max(0, p.revenue), 0) : 0,
    equityPct: eqPct, carried,
  };
}

export async function scenarioComparison(db: Db, projectId: string, modelId: string, o: { inflationPct: number; discountPct: number }) {
  const [m] = await db.select().from(finModels).where(and(eq(finModels.id, modelId), eq(finModels.projectId, projectId)));
  if (!m) throw new Error("Model not found");
  const all = (await db.select().from(participationStructures).where(and(eq(participationStructures.projectId, projectId), isNull(participationStructures.deletedAt)))).filter(s => s.status !== "terminated");
  const names = [...new Set(all.map(s => s.scenario))];
  const base = communityEconomics(m.definition, [], o);
  return {
    model: { id: m.id, name: m.name, version: m.version }, withoutCommunity: { projectIrr: base.projectIrr, investorIrr: base.investorIrr, investorMoic: base.investorMoic, minDscr: base.minDscr },
    scenarios: names.map(name => { const ss = all.filter(s => s.scenario === name); return { name, structures: ss, result: communityEconomics(m.definition, ss, o) }; }),
  };
}

export function ledgerTotals(entries: (typeof communityLedger.$inferSelect)[]) {
  const by: Record<Ledger, { paid: number; scheduled: number; projected: number; overdue: number }> = { mitigation: { paid: 0, scheduled: 0, projected: 0, overdue: 0 }, participation: { paid: 0, scheduled: 0, projected: 0, overdue: 0 }, development: { paid: 0, scheduled: 0, projected: 0, overdue: 0 } };
  for (const e of entries) { if (e.status === "cancelled" || e.status === "disputed") continue; by[e.ledger][e.status === "overdue" ? "overdue" : e.status] += e.amount; }
  return by;
}

/** Compensation recorded as participation or development (the OS never lets these blur). */
export function misclassified(entries: (typeof communityLedger.$inferSelect)[]) {
  return entries.filter(e => e.ledger !== "mitigation" && /compensat|remediat|displace|resettle|damage|indemn/i.test(`${e.category} ${e.description}`));
}

// ---------------- Rights, gates, capital fit, alerts ----------------
export async function projectCommunityState(db: Db, projectId: string) {
  const [cs, rights, consents, structures, krs, commitments, grievances] = await Promise.all([
    db.select().from(communities).where(and(eq(communities.projectId, projectId), isNull(communities.deletedAt))),
    db.select().from(communityRights).where(and(eq(communityRights.projectId, projectId), isNull(communityRights.deletedAt))),
    db.select().from(consentRecords).where(and(eq(consentRecords.projectId, projectId), isNull(consentRecords.deletedAt))),
    db.select().from(participationStructures).where(and(eq(participationStructures.projectId, projectId), isNull(participationStructures.deletedAt))),
    db.select().from(knowledgeRecords).where(and(eq(knowledgeRecords.projectId, projectId), isNull(knowledgeRecords.deletedAt))),
    db.select().from(communityCommitments).where(and(eq(communityCommitments.projectId, projectId), isNull(communityCommitments.deletedAt))),
    db.select().from(communityGrievances).where(and(eq(communityGrievances.projectId, projectId), isNull(communityGrievances.deletedAt))),
  ]);
  const auths = cs.length ? await db.select().from(communityAuthorities).where(and(inArray(communityAuthorities.communityId, cs.map(c => c.id)), isNull(communityAuthorities.deletedAt))) : [];
  return { communities: cs, rights, consents, structures, knowledge: krs, commitments, grievances, authorities: auths };
}

export function communityGates(s: Awaited<ReturnType<typeof projectCommunityState>>) {
  const fpic = s.consents.filter(c => c.consentType === "fpic" && c.consentRequired);
  const openMaterial = s.rights.filter(r => (r.materiality === "high" || r.materiality === "critical") && r.resolution === "open");
  return {
    screened: s.communities.length > 0 || s.rights.length > 0,
    identified: s.communities.length > 0,
    rights_mapped: s.rights.length > 0,
    authority_identified: s.authorities.some(a => a.verificationStatus === "verified"),
    engaging: s.consents.some(c => c.status !== "not_started"),
    kg_framework: s.knowledge.length === 0 || s.knowledge.every(k => k.governanceStatus !== "unknown"),
    structures_evaluated: s.structures.length > 0,
    consent_progressing: fpic.length > 0 && fpic.every(c => c.status !== "not_started"),
    structures_modelled: s.structures.some(x => x.status !== "concept"),
    rights_resolved: openMaterial.length === 0,
    commitments_recorded: s.commitments.every(c => !!c.owner),
    consent_granted: fpic.length > 0 && fpic.every(c => CONSENT_GRANTED.includes(c.status as ConsentStatus)),
    agreements_executed: s.structures.filter(x => x.status !== "concept" && x.status !== "modelled").every(x => x.status === "executed" || x.status === "active"),
  } as Record<string, boolean>;
}

export type FitDimension = { dimension: string; result: "fit" | "conditional" | "no_fit" | "unknown"; why: string };
/** Explainable community-structure fit of a capital profile against a project's participation structures. */
export function communityFit(alignment: { flags: string[]; preference: string; supported: string[] }, structures: Pick<Structure, "type">[]): FitDimension[] {
  const types = new Set(structures.map(s => s.type));
  const hasEquity = [...types].some(t => /equity/.test(t));
  const hasRevenue = [...types].some(t => /revenue|royalty/.test(t));
  const hasTrust = types.has("trust") || types.has("intergenerational_fund");
  const out: FitDimension[] = [];
  const p = alignment.preference;
  if (!structures.length) out.push({ dimension: "Community participation", result: p === "required" ? "no_fit" : "unknown", why: p === "required" ? "Mandate requires community participation; none is structured yet" : "No participation structure yet" });
  else out.push({ dimension: "Community participation", result: p === "excluded" ? "no_fit" : p === "unknown" ? "unknown" : p === "case_by_case" ? "conditional" : "fit", why: `Mandate preference: ${p.replace(/_/g, " ")}` });
  if (hasEquity) out.push({ dimension: "Community equity", result: alignment.supported.includes("community_equity") || alignment.supported.includes("indigenous_ownership") || alignment.supported.includes("local_ownership") ? "fit" : alignment.supported.length ? "conditional" : "unknown", why: alignment.supported.includes("community_equity") ? "Supports community equity" : "Community equity not listed among supported structures" });
  if (hasRevenue) out.push({ dimension: "Revenue share / royalty", result: alignment.supported.includes("revenue_share") || alignment.supported.includes("royalty") ? "fit" : alignment.supported.length ? "conditional" : "unknown", why: "Revenue-based participation reduces cash available for debt service and distributions" });
  if (hasTrust) out.push({ dimension: "Community trust", result: alignment.supported.includes("trust") ? "fit" : "unknown", why: "Trust / intergenerational fund in structure" });
  if (alignment.flags.includes("blended") || alignment.flags.includes("concessional")) out.push({ dimension: "Blended / concessional funding of the community stake", result: "fit", why: "Mandate lists blended or concessional appetite" });
  return out;
}

export async function communityAttention(db: Db, mandateIds: string[], today: string) {
  if (!mandateIds.length) return [];
  const in60 = new Date(Date.parse(today) + 60 * 86_400_000).toISOString().slice(0, 10);
  const [consents, commits, rights, grievances] = await Promise.all([
    db.select().from(consentRecords).where(and(inArray(consentRecords.mandateId, mandateIds), isNull(consentRecords.deletedAt))),
    db.select().from(communityCommitments).where(and(inArray(communityCommitments.mandateId, mandateIds), isNull(communityCommitments.deletedAt), inArray(communityCommitments.status, ["agreed", "active", "overdue"]))),
    db.select().from(communityRights).where(and(inArray(communityRights.mandateId, mandateIds), isNull(communityRights.deletedAt), eq(communityRights.resolution, "open"), inArray(communityRights.materiality, ["high", "critical"]))),
    db.select().from(communityGrievances).where(and(inArray(communityGrievances.mandateId, mandateIds), isNull(communityGrievances.deletedAt), inArray(communityGrievances.status, ["received", "acknowledged", "investigating", "escalated"]))),
  ]);
  const items: { key: string; entity: string; issue: string; severity: "critical" | "high" | "medium" | "low"; due: string | null; href: string }[] = [];
  for (const c of consents) {
    if (CONSENT_GRANTED.includes(c.status as ConsentStatus) && c.expiryDate && c.expiryDate < today) items.push({ key: `consent-exp:${c.id}`, entity: "Consent", issue: `Consent expired ${c.expiryDate}: treat as not granted until renewed`, severity: "critical", due: c.expiryDate, href: `/projects/${c.projectId}?tab=community&sec=consent` });
    else if (CONSENT_GRANTED.includes(c.status as ConsentStatus) && c.expiryDate && c.expiryDate <= in60) items.push({ key: `consent-soon:${c.id}`, entity: "Consent", issue: `Consent expires ${c.expiryDate}: plan re-engagement`, severity: "high", due: c.expiryDate, href: `/projects/${c.projectId}?tab=community&sec=consent` });
    if (c.reviewDate && c.reviewDate <= today && c.status !== "not_applicable") items.push({ key: `consent-review:${c.id}`, entity: "Consent", issue: "Consent review due", severity: "medium", due: c.reviewDate, href: `/projects/${c.projectId}?tab=community&sec=consent` });
  }
  for (const c of commits) if (c.dueDate && c.dueDate < today && c.status !== "fulfilled") items.push({ key: `commit:${c.id}`, entity: "Community commitment", issue: `Overdue: ${c.description.slice(0, 80)}`, severity: c.type === "payment" ? "critical" : "high", due: c.dueDate, href: `/projects/${c.projectId}?tab=community&sec=commitments` });
  for (const r of rights) items.push({ key: `right:${r.id}`, entity: "Community right", issue: `Unresolved ${r.materiality} ${r.rightType.replace(/_/g, " ")} right`, severity: r.materiality === "critical" ? "critical" : "high", due: null, href: `/projects/${r.projectId}?tab=community&sec=rights` });
  for (const g of grievances) items.push({ key: `grv:${g.id}`, entity: "Grievance", issue: `Open grievance received ${g.received}`, severity: g.status === "escalated" ? "critical" : "medium", due: null, href: `/projects/${g.projectId}?tab=community&sec=commitments` });
  return items;
}

/** Portfolio totals for the community dashboard (each ledger and metric separate). */
export async function communityPortfolio(db: Db, mandateIds: string[]) {
  if (!mandateIds.length) return null;
  const sc = (col: Parameters<typeof inArray>[0]) => inArray(col, mandateIds);
  const [cs, rights, consents, structures, ledger, commits, grievances, krs, ps] = await Promise.all([
    db.select().from(communities).where(and(sc(communities.mandateId), isNull(communities.deletedAt))),
    db.select().from(communityRights).where(and(sc(communityRights.mandateId), isNull(communityRights.deletedAt))),
    db.select().from(consentRecords).where(and(sc(consentRecords.mandateId), isNull(consentRecords.deletedAt))),
    db.select().from(participationStructures).where(and(sc(participationStructures.mandateId), isNull(participationStructures.deletedAt))),
    db.select().from(communityLedger).where(and(sc(communityLedger.mandateId), isNull(communityLedger.deletedAt))),
    db.select().from(communityCommitments).where(and(sc(communityCommitments.mandateId), isNull(communityCommitments.deletedAt))),
    db.select().from(communityGrievances).where(and(sc(communityGrievances.mandateId), isNull(communityGrievances.deletedAt))),
    db.select({ id: knowledgeRecords.id, accessStatus: knowledgeRecords.accessStatus, projectId: knowledgeRecords.projectId, withdrawn: knowledgeRecords.withdrawn }).from(knowledgeRecords).where(and(sc(knowledgeRecords.mandateId), isNull(knowledgeRecords.deletedAt))),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(sc(projects.mandateId)),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return {
    communities: cs, projects: ps, rightsOpen: rights.filter(r => r.resolution === "open" && r.materiality !== "low").length,
    consentByStatus: consents.reduce<Record<string, number>>((a, c) => { a[c.status] = (a[c.status] ?? 0) + 1; return a; }, {}),
    activeStructures: structures.filter(s => ["agreed", "executed", "active"].includes(s.status)).length, structures,
    ledger: ledgerTotals(ledger), misclassified: misclassified(ledger).length,
    commitmentsOutstanding: commits.filter(c => !["fulfilled", "terminated"].includes(c.status)).length, commitmentsOverdue: commits.filter(c => c.dueDate && c.dueDate < today && c.status !== "fulfilled" && c.status !== "terminated").length,
    grievancesOpen: grievances.filter(g => !["resolved", "closed"].includes(g.status)).length, restrictedKnowledge: krs.filter(k => k.accessStatus !== "public").length,
  };
}
