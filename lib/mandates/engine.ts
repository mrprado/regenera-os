// Mandate engine (docs/plans/phase-14-mandates.md): create mandates, build the universe from canonical records and
// public queues, qualify with recorded checks, client responses (attribution), pursuits, approvals, signals, delivery
// floors, economics. Every function takes `db` so it is testable; scope filtering happens in queries.ts and actions.
// People decide: client responses, human checks, approvals, bid decisions and pursuit outcomes refuse non-human actors.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { currentCall } from "@/lib/funding/queries";
import type { Db } from "@/db";
import { approvals, capitalMandates, capitalProfiles, commercialMandates, fundingOpportunities, largeLoads, mandateCandidates, mandateDeliveries, mandateSignals, organizations, projects, pursuits, queueProjects, tasks, teamMembers, notifications } from "@/db/schema";
import type { CriterionCheck, StageEvent } from "@/db/mandates";
import { audit } from "@/lib/audit";
import { chunk } from "@/lib/db/chunk";
import { emitEvent } from "@/lib/events/engine";
import { getState, setState } from "@/lib/state";
import { canAdvance, estimateEpc, evaluate, machineChecks, machineStage, mergeChecks, priorityOf, probabilityOf, procurementWindow, stageFromQueue, tally, type Attrs, type MandateLike } from "./fit";
import { QUEUE_SOURCES } from "./queues";
import {
  APPROVAL_KINDS, ATTRIBUTION, BID_CRITERIA, BREADTH, CLIENT_RESPONSES, DEFAULT_SEAT_RATE, DELIVERY_METRICS, ENGAGEMENT_MODELS, flowFor, MANDATE_TYPES, PURSUIT_TYPE_FOR, qualificationFor, STAFFING, STAGE_ORDER,
  type ApprovalKind, type CandidateStage, type ClientResponse, type DeliveryMetric, type Evidence, type MandateType, type PursuitType, type Seat,
} from "./vocab";

export const isHuman = (actor: string) => /@/.test(actor) && !/^(ai|claude|system|mcp|job)[:@]/i.test(actor);
const requireHuman = (actor: string, what: string) => { if (!isHuman(actor)) throw new Error(`${what} is decided by a person.`); };
type Cm = typeof commercialMandates.$inferSelect;
type Cand = typeof mandateCandidates.$inferSelect;
const asLike = (m: Cm): MandateLike => ({ type: m.type as MandateType, technologies: m.technologies, geography: m.geography, criteria: m.criteria });
const ev = (from: string, to: string, by: string, reason: string, evidence?: string): StageEvent => ({ from, to, at: new Date().toISOString(), by, reason, evidence });

// ---------------------------------------------------------------- mandates
export type MandateInput = Partial<Omit<typeof commercialMandates.$inferInsert, "id" | "createdAt" | "updatedAt">> & { mandateId: string; name: string; type: MandateType };

export async function createMandate(db: Db, input: MandateInput, actor: string) {
  const [m] = await db.insert(commercialMandates).values({ ...input, desk: input.desk ?? MANDATE_TYPES[input.type].desk, createdBy: actor }).returning();
  await audit(db, { actor, action: "mandate.create", entity: "commercial_mandates", entityId: m.id, after: { name: m.name, type: m.type } });
  return m;
}

export async function updateMandate(db: Db, id: string, patch: Partial<typeof commercialMandates.$inferInsert>, actor: string) {
  const [before] = await db.select().from(commercialMandates).where(eq(commercialMandates.id, id));
  if (!before) throw new Error("Mandate not found");
  if (patch.publishApproved && !before.publishApproved) requireHuman(actor, "Anonymized publication");
  await db.update(commercialMandates).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(commercialMandates.id, id));
  await audit(db, { actor, action: "mandate.update", entity: "commercial_mandates", entityId: id, before: Object.fromEntries(Object.keys(patch).map(k => [k, (before as Record<string, unknown>)[k]])), after: patch as Record<string, unknown> });
}

// ---------------------------------------------------------------- universe
type Source = { entityType: string; entityId: string; name: string; attrs: Attrs; data: Record<string, unknown>; evidence: Evidence[]; accountOrgId?: string | null; projectId?: string | null; nextAction: string };

async function queueSources(db: Db, m: Cm): Promise<Source[]> {
  const techs = (m.technologies.length ? m.technologies : ["solar", "bess", "solar_bess"]).map(t => t.toLowerCase());
  const want = new Set(techs.flatMap(t => (t === "solar" || t === "bess" ? [t, "solar_bess"] : t === "solar_bess" ? ["solar_bess", "solar", "bess"] : [t])));
  const isos = (m.geography.isos ?? []).map(s => s.toUpperCase());
  const rows = await db.select().from(queueProjects).where(and(inArray(queueProjects.technology, [...want]), isNull(queueProjects.withdrawnDate), isos.length ? inArray(queueProjects.iso, isos) : sql`1 = 1`));
  return rows.filter(r => !/withdrawn|suspen|commercial operation|in service|done/i.test(`${r.status} ${r.iaStatus}`)).map(r => {
    const s = stageFromQueue(r.iso, r.status, r.studyPhase, r.iaStatus);
    const src = QUEUE_SOURCES[r.iso === "MISO" ? "miso" : "spp"];
    return {
      entityType: "queue_project", entityId: r.key, name: `${r.iso} ${r.number} · ${r.technology.replace("_", " + ")} ${r.mw ?? "?"} MW · ${[r.county, r.state].filter(Boolean).join(", ")}`,
      attrs: { technology: r.technology, mw: r.mw, state: r.state, iso: r.iso, country: "US", stage: s.stage, stageBasis: s.basis, cod: r.inServiceDate, epcAwarded: s.epcAwarded, sponsorKnown: false, source: src.label, sourceUrl: src.page },
      data: { iso: r.iso, number: r.number, state: r.state, county: r.county, poi: r.poi, transmissionOwner: r.transmissionOwner, fuel: r.fuel, mw: r.mw, inServiceDate: r.inServiceDate, queueDate: r.queueDate, status: r.status, studyPhase: r.studyPhase, iaStatus: r.iaStatus, lastSeenAt: r.lastSeenAt },
      evidence: [{ kind: "source", text: `${r.iso} queue ${r.number}: ${r.fuel || r.technology}, ${r.mw ?? "?"} MW, ${[r.county, r.state].filter(Boolean).join(", ")}; status "${[r.status, r.iaStatus].filter(Boolean).join(" / ")}"; requested in-service ${r.inServiceDate ?? "not stated"}.`, source: src.label, url: src.page, observedAt: r.lastSeenAt }],
      nextAction: "Identify the developer behind the queue position (county filings, POI owner, interconnection documents) before outreach.",
    };
  });
}

async function projectSources(db: Db, m: Cm): Promise<Source[]> {
  const rows = await db.select().from(projects).where(and(eq(projects.mandateId, m.mandateId), isNull(projects.archivedAt)));
  return rows.map(p => ({
    entityType: "project", entityId: p.id, name: p.name, projectId: p.id,
    attrs: { technology: (p.technology ?? p.sector ?? "").toLowerCase().includes("bess") || (p.technology ?? "").toLowerCase().includes("storage") ? ((p.technology ?? "").toLowerCase().includes("solar") ? "solar_bess" : "bess") : (p.technology ?? "").toLowerCase().includes("solar") ? "solar" : (p.technology ?? p.sector ?? null), mw: p.capacityUnit === "MW" ? p.capacity : null, mwh: p.capacityUnit === "MWh" ? p.capacity : null, country: p.country, state: p.subdivision, stage: p.stage === "development" ? "mid_development" : p.stage === "construction" ? "construction" : p.stage === "operations" ? "operating" : "early_development", stageBasis: `OS project stage: ${p.stage}`, value: p.capex, sponsorKnown: true, source: "Regenera OS project record" },
    data: { stage: p.stage, technology: p.technology, capacity: p.capacity, capacityUnit: p.capacityUnit, capex: p.capex, currency: p.currency, country: p.country },
    evidence: [{ kind: "internal", text: `Project record in the OS (stage ${p.stage}${p.originationSource ? `; origin ${p.originationSource}` : ""}).`, source: "Regenera OS" }],
    nextAction: "Review the project record and readiness before proposing it to the client.",
  }));
}

async function capitalSources(db: Db, m: Cm): Promise<Source[]> {
  const profs = await db.select().from(capitalProfiles).where(and(eq(capitalProfiles.mandateId, m.mandateId), isNull(capitalProfiles.archivedAt)));
  const cms = profs.length ? await db.select().from(capitalMandates).where(and(inArray(capitalMandates.profileId, profs.slice(0, 90).map(p => p.id)), eq(capitalMandates.active, true))) : [];
  return profs.map(p => {
    const c = cms.find(x => x.profileId === p.id);
    const geos = [...(c?.geographies ?? []), ...p.geographies];
    return {
      entityType: "capital_profile", entityId: p.id, name: p.name, accountOrgId: p.orgId,
      attrs: { technology: p.technologies[0] ?? p.sectors[0] ?? null, geographies: geos, ticketMin: c?.ticketMin ?? p.ticketMin, ticketMax: c?.ticketMax ?? p.ticketMax, sectors: [...p.sectors, ...p.technologies], stages: c?.stages ?? p.stages, sponsorKnown: true, source: p.source || "Capital profile" },
      data: { capitalType: p.capitalType, ticketMin: c?.ticketMin ?? p.ticketMin, ticketMax: c?.ticketMax ?? p.ticketMax, geographies: geos, stages: c?.stages ?? p.stages, relationship: p.relationshipStrength },
      evidence: [{ kind: p.lastVerifiedAt ? "verified" : "internal", text: `Capital profile${c ? ` with mandate "${c.name}"` : ""}${p.lastVerifiedAt ? ` (verified ${p.lastVerifiedAt.slice(0, 10)})` : " (not yet verified)"}.`, source: p.source || "Regenera OS" }],
      nextAction: "Confirm the investor's current mandate before any introduction (investor access needs approval).",
    };
  });
}

async function fundingSources(db: Db, m: Cm): Promise<Source[]> {
  const rows = await db.select().from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, m.mandateId), currentCall(new Date().toISOString().slice(0, 10)))).limit(400);
  return rows.map(o => ({
    entityType: "funding_opportunity", entityId: o.id, name: o.title,
    attrs: { geographies: o.countries ?? [], value: o.amountMax ?? o.amountMin, technology: (o.sectors ?? "").toString(), sponsorKnown: true, cod: o.deadline, source: o.source },
    data: { funder: o.funder, deadline: o.deadline, amountMin: o.amountMin, amountMax: o.amountMax, currency: o.currency, url: o.url },
    evidence: [{ kind: "source", text: `${o.funder}: ${o.title} (deadline ${o.deadline ?? "rolling / not stated"}).`, source: o.source, url: o.url ?? undefined }],
    nextAction: "Run eligibility on the funding opportunity before recommending apply / no-apply.",
  }));
}

async function loadSources(db: Db, m: Cm): Promise<Source[]> {
  const rows = await db.select().from(largeLoads).where(eq(largeLoads.mandateId, m.mandateId)).limit(300);
  return rows.map(l => ({
    entityType: "large_load", entityId: l.id, name: l.name, accountOrgId: l.orgId,
    attrs: { mw: l.mw, country: l.country, state: l.region, sponsorKnown: !!l.orgId, cod: l.energizationDate, source: l.source || "Large-load record" },
    data: { type: l.type, mw: l.mw, region: l.region, energization: l.energizationDate, isDemo: l.isDemo },
    evidence: [{ kind: l.isDemo === "yes" ? "unknown" : "internal", text: `${l.isDemo === "yes" ? "DEMO " : ""}Large load: ${l.type}, ${l.mw ?? "?"} MW.`, source: l.source || "Regenera OS", url: l.sourceUrl ?? undefined }],
    nextAction: "Confirm procurement appetite and timing with the buyer.",
  }));
}

async function orgSources(db: Db, m: Cm): Promise<Source[]> {
  const countries = (m.geography.countries ?? []).map(c => c.toUpperCase());
  const rows = await db.select().from(organizations).where(and(eq(organizations.mandateId, m.mandateId), isNull(organizations.archivedAt), countries.length ? inArray(organizations.country, countries) : sql`1 = 1`)).limit(400);
  return rows.map(o => ({
    entityType: "organization", entityId: o.id, name: o.name, accountOrgId: o.id,
    attrs: { country: o.country, technology: o.sector ?? o.industry, sponsorKnown: true, source: "CRM organization" },
    data: { sector: o.sector, industry: o.industry, country: o.country, domain: o.domain },
    evidence: [{ kind: "internal", text: `CRM organization (${o.sector ?? o.industry ?? "sector not set"}).`, source: "Regenera OS" }],
    nextAction: "Confirm the counterparty's current priorities before proposing.",
  }));
}

export async function sourcesFor(db: Db, m: Cm): Promise<Source[]> {
  switch (MANDATE_TYPES[m.type as MandateType]?.universe) {
    case "projects": return m.type === "epc_origination" ? [...(await queueSources(db, m)), ...(await projectSources(db, m)).filter(s => /solar|bess/.test(String(s.attrs.technology)))] : projectSources(db, m);
    case "capital": return capitalSources(db, m);
    case "funding": return fundingSources(db, m);
    case "loads": return loadSources(db, m);
    default: return orgSources(db, m);
  }
}

/** Runs statements in D1 batches (one round trip per batch instead of one per row). */
async function runBatched(db: Db, stmts: unknown[], size = 40) {
  for (let i = 0; i < stmts.length; i += size) {
    const part = stmts.slice(i, i + size);
    if (part.length) await db.batch(part as unknown as Parameters<Db["batch"]>[0]);
  }
}

export const UNIVERSE_SLICE = 400;

/** §5–9 One slice of a universe build (sources[offset, offset+limit)), writes batched. Human checks and stages are
 *  never lowered by a rerun. Returns the next offset, or null when the universe is complete. */
export async function buildUniverseSlice(db: Db, id: string, actor: string, now = new Date(), opts: { offset?: number; limit?: number } = {}) {
  const [m] = await db.select().from(commercialMandates).where(eq(commercialMandates.id, id));
  if (!m) throw new Error("Mandate not found");
  const offset = opts.offset ?? 0, limit = opts.limit ?? UNIVERSE_SLICE;
  const like = asLike(m);
  const all = await sourcesFor(db, m);
  const sources = all.slice(offset, offset + limit);
  const existing = new Map<string, Cand>();
  for (const part of chunk(sources.map(s => s.entityId), 90)) {
    for (const c of await db.select().from(mandateCandidates).where(and(eq(mandateCandidates.commercialMandateId, id), inArray(mandateCandidates.entityId, part)))) existing.set(`${c.entityType}:${c.entityId}`, c);
  }
  const known = new Set((m.criteria.knownAccounts as string[] | undefined ?? []).map(s => s.toLowerCase()));
  let created = 0, updated = 0;
  const at = now.toISOString();
  const stmts: unknown[] = [];
  for (const s of sources) {
    const fit = evaluate(like, s.attrs, { now });
    const prev = existing.get(`${s.entityType}:${s.entityId}`);
    const checks = mergeChecks(prev?.checks ?? {}, machineChecks(like, s.attrs, fit, s.evidence.length > 0, prev?.nextAction || s.nextAction));
    const t = tally(m.type as MandateType, checks);
    const mStage = machineStage(m.type as MandateType, checks);
    const epc = m.type === "epc_origination" ? estimateEpc(s.attrs) : null;
    const win = m.type === "epc_origination" ? procurementWindow(s.attrs) : null;
    const prevIdx = prev ? STAGE_ORDER.indexOf(prev.stage as CandidateStage) : -1;
    const humanHeld = prev && (prevIdx > STAGE_ORDER.indexOf("pre_qualified") || ["watch", "rejected", "excluded"].includes(prev.stage));
    const stage = humanHeld ? prev!.stage : mStage;
    const pr = priorityOf(fit, win?.start ?? null, now);
    const v = {
      name: s.name, accountOrgId: s.accountOrgId ?? prev?.accountOrgId ?? null, projectId: s.projectId ?? prev?.projectId ?? null, stage, fit, checks,
      metCount: t.met, unknownCount: t.unknown, failCount: t.fail, completeness: t.completeness, priority: pr.priority, data: { ...s.data, priorityWhy: pr.why }, evidence: s.evidence,
      estValue: epc?.value ?? s.attrs.value ?? null, estValueBasis: epc?.basis ?? (s.attrs.value ? "Stated in the source record." : ""),
      windowStart: win?.start ?? null, windowEnd: win?.end ?? null, windowBasis: win?.basis ?? "", nextAction: prev?.nextAction || s.nextAction,
      preExisting: prev?.preExisting || known.has(s.name.toLowerCase()), updatedAt: at,
    };
    if (prev) {
      const hist = prev.stage !== stage ? [...prev.stageHistory, ev(prev.stage, stage, "engine", "Machine re-screen")] : prev.stageHistory;
      stmts.push(db.update(mandateCandidates).set({ ...v, stageHistory: hist }).where(eq(mandateCandidates.id, prev.id)));
      updated++;
    } else {
      stmts.push(db.insert(mandateCandidates).values({ mandateId: m.mandateId, commercialMandateId: id, entityType: s.entityType, entityId: s.entityId, originDate: at.slice(0, 10), originator: "Regenera (machine screen)", source: s.attrs.source ?? "", attribution: "unattributed", stageHistory: [ev("", stage, "engine", "Discovered and screened")], firstSeenAt: at, ...v }).onConflictDoNothing());
      created++;
    }
  }
  await runBatched(db, stmts);
  const next = offset + limit < all.length ? offset + limit : null;
  if (created) await emitEvent(db, { mandateId: m.mandateId, type: "MATCH_CREATED", entityType: "commercial_mandates", entityId: id, payload: { created, mandate: m.name, offset }, actor });
  if (next === null) await audit(db, { actor, action: "mandate.universe", entity: "commercial_mandates", entityId: id, after: { sources: all.length } });
  return { total: all.length, processed: Math.min(all.length, offset + limit), created, updated, next };
}

/** Whole universe in one call (tests, small mandates). Screens use the background job, slice by slice. */
export async function buildUniverse(db: Db, id: string, actor: string, now = new Date()) {
  let offset: number | null = 0, created = 0, updated = 0, total = 0;
  while (offset !== null) {
    const r = await buildUniverseSlice(db, id, actor, now, { offset });
    created += r.created; updated += r.updated; total = r.total; offset = r.next;
  }
  return { sources: total, created, updated };
}

// ---------------------------------------------------------------- background work progress (state table)
export type MandateWork = { phase: "queued" | "syncing" | "screening" | "done" | "failed"; label: string; done: number; total: number; created: number; updated: number; startedAt: string; finishedAt?: string; error?: string };
export const workKey = (id: string) => `mandate_work:${id}`;
export async function getWork(db: Db, id: string): Promise<MandateWork | null> {
  const v = await getState(db, workKey(id));
  return v ? (JSON.parse(v) as MandateWork) : null;
}
export async function setWork(db: Db, id: string, w: MandateWork) { await setState(db, workKey(id), JSON.stringify(w)); }

/** §20 Queue changes → mandate signals on matching candidates. Inferred meanings are flagged as inference. */
export async function signalsFromQueueChanges(db: Db, changes: { key: string; field: string; from: string; to: string; isNew: boolean }[], now = new Date()) {
  if (!changes.length) return 0;
  const keys = [...new Set(changes.map(c => c.key))];
  let n = 0;
  for (const part of chunk(keys, 80)) {
    const cands = await db.select({ id: mandateCandidates.id, mandateId: mandateCandidates.mandateId, cm: mandateCandidates.commercialMandateId, entityId: mandateCandidates.entityId, name: mandateCandidates.name, stage: mandateCandidates.stage })
      .from(mandateCandidates).where(and(eq(mandateCandidates.entityType, "queue_project"), inArray(mandateCandidates.entityId, part)));
    for (const c of cands) for (const ch of changes.filter(x => x.key === c.entityId && !x.isNew)) {
      const ia = ch.field === "iaStatus" || (ch.field === "status" && /IA FULLY EXECUTED|executed/i.test(ch.to));
      const kind = ch.field === "withdrawnDate" ? "withdrawn" : ia ? "ia_executed" : ch.field === "inServiceDate" ? "cod_change" : "queue_status";
      const why = kind === "ia_executed" ? "Interconnection agreement progress usually precedes EPC procurement (inference, not a confirmed procurement)." : kind === "cod_change" ? "A moved in-service date moves the inferred procurement window." : kind === "withdrawn" ? "A withdrawn position leaves the universe." : "Study progress changes the stage reading.";
      const r = await db.insert(mandateSignals).values({
        mandateId: c.mandateId, commercialMandateId: c.cm, candidateId: c.id, kind, whatChanged: `${c.name}: ${ch.field} "${ch.from || "—"}" → "${ch.to || "—"}"`, whyItMatters: why,
        recommendedAction: kind === "ia_executed" ? "Prioritize sponsor identification and approach before the EPC RFP." : kind === "withdrawn" ? "Close the candidate." : "Re-check timing and stage.",
        urgency: kind === "ia_executed" ? "high" : "normal", confidence: "high", inference: kind === "ia_executed", source: c.entityId.startsWith("MISO") ? QUEUE_SOURCES.miso.label : QUEUE_SOURCES.spp.label,
        sourceUrl: c.entityId.startsWith("MISO") ? QUEUE_SOURCES.miso.page : QUEUE_SOURCES.spp.page, observedAt: now.toISOString(), dedupeKey: `${c.entityId}:${ch.field}:${ch.to}`,
      }).onConflictDoNothing().returning({ id: mandateSignals.id });
      if (r.length) { n++; await db.update(mandateCandidates).set({ lastSignalAt: now.toISOString() }).where(eq(mandateCandidates.id, c.id)); }
    }
  }
  return n;
}

// ---------------------------------------------------------------- qualification
export async function recordCheck(db: Db, candidateId: string, key: string, met: CriterionCheck["met"], basis: string, actor: string) {
  requireHuman(actor, "A qualification check");
  const [c] = await db.select().from(mandateCandidates).where(eq(mandateCandidates.id, candidateId));
  if (!c) throw new Error("Candidate not found");
  const [m] = await db.select({ type: commercialMandates.type }).from(commercialMandates).where(eq(commercialMandates.id, c.commercialMandateId));
  if (!qualificationFor(m.type as MandateType).some(q => q.key === key)) throw new Error("Unknown criterion");
  if (met !== "unknown" && !basis.trim()) throw new Error("A basis is required: say what supports the answer.");
  const checks = { ...c.checks, [key]: { met, basis: basis.trim(), by: actor, at: new Date().toISOString(), machine: false } };
  const t = tally(m.type as MandateType, checks);
  await db.update(mandateCandidates).set({ checks, metCount: t.met, unknownCount: t.unknown, failCount: t.fail, completeness: t.completeness, updatedAt: new Date().toISOString() }).where(eq(mandateCandidates.id, candidateId));
  await audit(db, { actor, action: "mandate.check", entity: "mandate_candidates", entityId: candidateId, before: { [key]: c.checks[key] ?? null }, after: { [key]: checks[key] } });
}

/** §9 Stage advancement only when the stage's requirements are met; the missing list is returned otherwise. */
export async function advanceCandidate(db: Db, candidateId: string, to: CandidateStage, actor: string, reason: string) {
  requireHuman(actor, "Stage advancement");
  const [c] = await db.select().from(mandateCandidates).where(eq(mandateCandidates.id, candidateId));
  if (!c) throw new Error("Candidate not found");
  const [m] = await db.select().from(commercialMandates).where(eq(commercialMandates.id, c.commercialMandateId));
  const g = canAdvance(m.type as MandateType, to, c.checks, { clientApproved: c.clientResponse === "approve", owner: c.owner });
  if (!g.ok) return { ok: false as const, missing: g.missing.map(x => x.label) };
  await db.update(mandateCandidates).set({ stage: to, stageHistory: [...c.stageHistory, ev(c.stage, to, actor, reason)], updatedAt: new Date().toISOString() }).where(eq(mandateCandidates.id, candidateId));
  if (to === "qualified") await emitEvent(db, { mandateId: c.mandateId, type: "QUALIFICATION_COMPLETED", entityType: "mandate_candidates", entityId: c.id, payload: { name: c.name, mandate: m.name }, actor });
  await audit(db, { actor, action: "mandate.stage", entity: "mandate_candidates", entityId: candidateId, before: { stage: c.stage }, after: { stage: to, reason } });
  return { ok: true as const, missing: [] };
}

/** §11 Client response. Approve ⇒ attribution-protected, a recorded approval, and the client_approved criterion met. */
export async function clientRespond(db: Db, candidateId: string, response: ClientResponse, actor: string, note = "") {
  requireHuman(actor, "A client response");
  const [c] = await db.select().from(mandateCandidates).where(eq(mandateCandidates.id, candidateId));
  if (!c) throw new Error("Candidate not found");
  const r = CLIENT_RESPONSES[response];
  if (response === "approve" && STAGE_ORDER.indexOf(c.stage as CandidateStage) < STAGE_ORDER.indexOf("pre_qualified")) throw new Error("Only pre-qualified or qualified opportunities can be approved for pursuit.");
  const at = new Date().toISOString();
  const attribution = c.preExisting && response === "approve" ? "client_originated" : (r.attribution ?? c.attribution);
  const checks = response === "approve" ? { ...c.checks, client_approved: { met: "yes" as const, basis: `Client approved${note ? `: ${note}` : ""}`, by: actor, at, machine: false } } : c.checks;
  await db.update(mandateCandidates).set({ clientResponse: response, clientResponseBy: actor, clientResponseAt: at, clientResponseNote: note, attribution, checks, stage: r.stage, stageHistory: [...c.stageHistory, ev(c.stage, r.stage, actor, `Client: ${r.label}`, note)], updatedAt: at }).where(eq(mandateCandidates.id, candidateId));
  if (response === "approve") {
    await db.insert(approvals).values({ mandateId: c.mandateId, kind: "pursuit", entityType: "mandate_candidates", entityId: c.id, commercialMandateId: c.commercialMandateId, title: `Pursue ${c.name}`, requester: "Regenera", approver: actor, status: "approved", rationale: note, decidedBy: actor, decidedAt: at });
    await emitEvent(db, { mandateId: c.mandateId, type: "PURSUIT_APPROVED", entityType: "mandate_candidates", entityId: c.id, payload: { name: c.name, attribution }, actor });
  }
  await audit(db, { actor, action: "mandate.client_response", entity: "mandate_candidates", entityId: candidateId, before: { stage: c.stage, attribution: c.attribution }, after: { response, stage: r.stage, attribution } });
}

export async function setCandidateFeedback(db: Db, candidateId: string, feedback: "correct" | "incorrect" | "partial" | "outdated", note: string, actor: string) {
  requireHuman(actor, "Match feedback");
  await db.update(mandateCandidates).set({ feedback, feedbackNote: note, updatedAt: new Date().toISOString() }).where(eq(mandateCandidates.id, candidateId));
  await audit(db, { actor, action: "mandate.feedback", entity: "mandate_candidates", entityId: candidateId, after: { feedback, note } });
}

// ---------------------------------------------------------------- pursuits
export async function createPursuit(db: Db, candidateId: string, actor: string, owner?: string | null) {
  requireHuman(actor, "Opening a pursuit");
  const [c] = await db.select().from(mandateCandidates).where(eq(mandateCandidates.id, candidateId));
  if (!c) throw new Error("Candidate not found");
  if (c.pursuitId) return c.pursuitId;
  if (c.clientResponse !== "approve") throw new Error("The client approves a pursuit before it opens.");
  const [m] = await db.select().from(commercialMandates).where(eq(commercialMandates.id, c.commercialMandateId));
  const type: PursuitType = PURSUIT_TYPE_FOR[m.type as MandateType];
  const first = flowFor(type)[0].key;
  const [p] = await db.insert(pursuits).values({
    mandateId: c.mandateId, commercialMandateId: m.id, candidateId: c.id, type, name: c.name, accountOrgId: c.accountOrgId, projectId: c.projectId,
    owner: owner ?? actor, value: c.estValue, valueBasis: c.estValueBasis, stage: first, attribution: c.attribution, nextAction: c.nextAction, lastActionAt: new Date().toISOString(),
    stageHistory: [ev("", first, actor, "Pursuit opened after client approval")], createdBy: actor,
  }).returning();
  const checks = { ...c.checks, owner: { met: "yes" as const, basis: `Pursuit owner ${p.owner}`, by: actor, at: new Date().toISOString(), machine: false } };
  await db.update(mandateCandidates).set({ pursuitId: p.id, owner: p.owner, checks, updatedAt: new Date().toISOString() }).where(eq(mandateCandidates.id, c.id));
  await audit(db, { actor, action: "pursuit.create", entity: "pursuits", entityId: p.id, after: { name: p.name, type } });
  return p.id;
}

export async function movePursuit(db: Db, id: string, to: string, actor: string, reason: string, evidence = "") {
  requireHuman(actor, "A pursuit stage change");
  const [p] = await db.select().from(pursuits).where(eq(pursuits.id, id));
  if (!p) throw new Error("Pursuit not found");
  const flow = flowFor(p.type as PursuitType);
  if (!flow.some(s => s.key === to)) throw new Error("Unknown stage for this pursuit type");
  if (!reason.trim()) throw new Error("Say why the stage changed.");
  if ((to === "bid" || to === "rfp") && p.type === "epc" && !p.bidDecision && to === "bid") throw new Error("Record the bid / no-bid decision before submitting a bid.");
  if (to === "bid" && p.bidDecision === "no_bid") throw new Error("The bid / no-bid decision was No-bid.");
  const at = new Date().toISOString();
  await db.update(pursuits).set({ stage: to, lastActionAt: at, stageHistory: [...p.stageHistory, ev(p.stage, to, actor, reason, evidence)], updatedAt: at }).where(eq(pursuits.id, id));
  if (to === "rfp" || to === "rfq") await emitEvent(db, { mandateId: p.mandateId, type: "RFP_RECEIVED", entityType: "pursuits", entityId: id, payload: { name: p.name, stage: to }, actor });
  await audit(db, { actor, action: "pursuit.stage", entity: "pursuits", entityId: id, before: { stage: p.stage }, after: { stage: to, reason } });
}

export async function updatePursuit(db: Db, id: string, patch: Partial<Pick<typeof pursuits.$inferInsert, "owner" | "nextAction" | "nextActionDate" | "value" | "valueBasis" | "expectedDate" | "expectedOutcome" | "relationshipStatus" | "risks" | "competitors" | "decisionMakers" | "commercialStructure" | "diligenceStatus" | "documentStatus">>, actor: string) {
  await db.update(pursuits).set({ ...patch, lastActionAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(pursuits.id, id));
  await audit(db, { actor, action: "pursuit.update", entity: "pursuits", entityId: id, after: patch as Record<string, unknown> });
}

export async function setProbability(db: Db, id: string, value: number | null, why: string, actor: string) {
  requireHuman(actor, "A probability override");
  if (value != null && (!why.trim() || value < 0 || value > 100)) throw new Error("An override needs a reason and a value 0–100.");
  await db.update(pursuits).set({ probabilityOverride: value, probabilityWhy: value == null ? "" : why.trim(), probabilityAt: new Date().toISOString() }).where(eq(pursuits.id, id));
  await audit(db, { actor, action: "pursuit.probability", entity: "pursuits", entityId: id, after: { value, why } });
}

/** §15 Bid / no-bid: every criterion rated by a person; the decision stores its rationale. */
export async function saveBidCriteria(db: Db, id: string, criteria: Record<string, { rating: string; note: string }>, actor: string) {
  const clean = Object.fromEntries(Object.entries(criteria).filter(([k]) => k in BID_CRITERIA));
  await db.update(pursuits).set({ bidCriteria: clean, updatedAt: new Date().toISOString() }).where(eq(pursuits.id, id));
  await audit(db, { actor, action: "pursuit.bid_criteria", entity: "pursuits", entityId: id, after: clean });
}

export async function decideBid(db: Db, id: string, decision: "go" | "conditional_go" | "hold" | "no_bid", rationale: string, actor: string) {
  requireHuman(actor, "Bid / no-bid");
  if (!rationale.trim()) throw new Error("Record the reasoning and evidence for the decision.");
  const [p] = await db.select().from(pursuits).where(eq(pursuits.id, id));
  const blockers = Object.entries(p.bidCriteria).filter(([, v]) => v.rating === "blocker").map(([k]) => BID_CRITERIA[k as keyof typeof BID_CRITERIA]);
  if ((decision === "go") && blockers.length) throw new Error(`Blockers rated: ${blockers.join(", ")}. Use Conditional go with conditions, or resolve them.`);
  const at = new Date().toISOString();
  await db.update(pursuits).set({ bidDecision: decision, bidRationale: rationale.trim(), bidDecidedBy: actor, bidDecidedAt: at, outcome: decision === "no_bid" ? "no_bid" : p.outcome, updatedAt: at }).where(eq(pursuits.id, id));
  await db.insert(approvals).values({ mandateId: p.mandateId, kind: "bid", entityType: "pursuits", entityId: id, commercialMandateId: p.commercialMandateId, title: `Bid / no-bid: ${p.name}`, requester: p.owner ?? actor, approver: actor, status: decision === "no_bid" ? "rejected" : decision === "conditional_go" ? "approved_conditions" : decision === "hold" ? "pending" : "approved", rationale, decidedBy: decision === "hold" ? null : actor, decidedAt: decision === "hold" ? null : at });
  await audit(db, { actor, action: "pursuit.bid_decision", entity: "pursuits", entityId: id, after: { decision, rationale } });
}

/** §39–40 Close with win / loss intelligence. */
export async function closePursuit(db: Db, id: string, outcome: "won" | "lost" | "stalled" | "withdrawn", winLoss: Record<string, string>, actor: string) {
  requireHuman(actor, "A pursuit outcome");
  if (!winLoss.reason?.trim()) throw new Error("Record why it was won, lost or stalled.");
  const at = new Date().toISOString();
  const [p] = await db.select().from(pursuits).where(eq(pursuits.id, id));
  await db.update(pursuits).set({ outcome, winLoss, stageHistory: [...p.stageHistory, ev(p.stage, outcome, actor, winLoss.reason)], updatedAt: at }).where(eq(pursuits.id, id));
  await audit(db, { actor, action: "pursuit.close", entity: "pursuits", entityId: id, after: { outcome, ...winLoss } });
}

// ---------------------------------------------------------------- approvals (§10)
export async function requestApproval(db: Db, input: { mandateId: string; kind: ApprovalKind; entityType: string; entityId: string; title: string; detail?: string; approver?: string | null; commercialMandateId?: string | null; documentVersion?: string | null }, requester: string) {
  if (!(input.kind in APPROVAL_KINDS)) throw new Error("Unknown approval kind");
  const [a] = await db.insert(approvals).values({ ...input, detail: input.detail ?? "", requester }).returning();
  await db.insert(notifications).values({ mandateId: input.mandateId, recipient: input.approver ?? null, category: "deal", priority: "action", title: `Approval requested: ${input.title}`, body: input.detail ?? "", entityType: "approvals", entityId: a.id, link: "/approvals" });
  await audit(db, { actor: requester, action: "approval.request", entity: "approvals", entityId: a.id, after: { kind: input.kind, title: input.title } });
  return a;
}

export async function decideApproval(db: Db, id: string, status: "approved" | "approved_conditions" | "rejected" | "withdrawn", rationale: string, conditions: string, actor: string) {
  requireHuman(actor, "An approval");
  const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
  if (!a) throw new Error("Approval not found");
  if (a.status !== "pending") throw new Error("Already decided.");
  if (a.approver && a.approver.toLowerCase() !== actor.toLowerCase() && status !== "withdrawn") throw new Error(`Assigned to ${a.approver}.`);
  if (status === "withdrawn" && a.requester !== actor) throw new Error("Only the requester withdraws a request.");
  if (status !== "withdrawn" && !rationale.trim()) throw new Error("Record the rationale.");
  if (status === "approved_conditions" && !conditions.trim()) throw new Error("State the conditions.");
  await db.update(approvals).set({ status, rationale, conditions, decidedBy: actor, decidedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(approvals.id, id));
  await audit(db, { actor, action: "approval.decide", entity: "approvals", entityId: id, before: { status: a.status }, after: { status, rationale, conditions } });
}

// ---------------------------------------------------------------- delivery floor, economics, desks
const inPeriod = (iso: string | null | undefined, period: string) => !!iso && iso.slice(0, 7) === period;

/** §24–25 Delivered per metric for a period, from the records themselves (never typed in). */
export function deliveredIn(period: string, cands: Cand[], purs: (typeof pursuits.$inferSelect)[]): Record<DeliveryMetric, number> {
  const reached = (c: Cand, s: CandidateStage) => c.stageHistory.some(h => h.to === s && inPeriod(h.at, period)) || (STAGE_ORDER.indexOf(c.stage as CandidateStage) >= STAGE_ORDER.indexOf(s) && inPeriod(c.updatedAt, period) && !c.stageHistory.some(h => h.to === s));
  return {
    screened: cands.filter(c => inPeriod(c.firstSeenAt, period)).length,
    updated: cands.filter(c => inPeriod(c.lastSignalAt, period)).length,
    qualified: cands.filter(c => reached(c, "qualified")).length,
    priority: cands.filter(c => c.priority === "high" && STAGE_ORDER.indexOf(c.stage as CandidateStage) >= STAGE_ORDER.indexOf("pre_qualified") && inPeriod(c.updatedAt, period)).length,
    pathways: cands.filter(c => c.checks.pathway?.met === "yes" && inPeriod(c.checks.pathway.at, period)).length,
    approved: cands.filter(c => c.clientResponse === "approve" && inPeriod(c.clientResponseAt, period)).length,
    meetings: purs.filter(p => p.stageHistory.some(h => ["discovery", "intro"].includes(h.to) && inPeriod(h.at, period))).length,
    rfps: purs.filter(p => p.stageHistory.some(h => ["rfq", "rfp", "ioi", "term_sheet"].includes(h.to) && inPeriod(h.at, period))).length,
    awards: purs.filter(p => p.outcome === "won" && inPeriod(p.updatedAt, period)).length,
  };
}

export async function deliveryFloor(db: Db, m: Cm, period: string) {
  const cands = await db.select().from(mandateCandidates).where(eq(mandateCandidates.commercialMandateId, m.id));
  const purs = await db.select().from(pursuits).where(eq(pursuits.commercialMandateId, m.id));
  const got = deliveredIn(period, cands, purs);
  const lines = m.deliveryFloor.map(f => ({ ...f, label: DELIVERY_METRICS[f.metric].label, level: DELIVERY_METRICS[f.metric].level, delivered: got[f.metric], met: got[f.metric] >= f.target }));
  const [row] = await db.select().from(mandateDeliveries).where(and(eq(mandateDeliveries.commercialMandateId, m.id), eq(mandateDeliveries.period, period)));
  return { period, lines, delivered: got, review: row ?? null };
}

export async function reviewDelivery(db: Db, m: Cm, period: string, input: { quality: string; shortfall: string; remediation: string }, actor: string) {
  requireHuman(actor, "A delivery review");
  const f = await deliveryFloor(db, m, period);
  const metrics = Object.fromEntries(f.lines.map(l => [l.metric, { target: l.target, delivered: l.delivered }]));
  const status = f.lines.every(l => l.met) ? "met" : "short";
  await db.insert(mandateDeliveries).values({ mandateId: m.mandateId, commercialMandateId: m.id, period, metrics, ...input, status, reviewedBy: actor, reviewedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: [mandateDeliveries.commercialMandateId, mandateDeliveries.period], set: { metrics, ...input, status, reviewedBy: actor, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
}

/** §28, §30, §66 Staffing plan and mandate economics. Rates come from team members when assigned; else the planning default. */
export async function mandateEconomics(db: Db, m: Cm) {
  const members = await db.select().from(teamMembers).where(and(eq(teamMembers.mandateId, m.mandateId), eq(teamMembers.active, true)));
  const plan = Object.entries(STAFFING[m.type as MandateType] ?? { mandate_lead: 10, origination_analyst: 30 }) as [Seat, number][];
  const rateFor = (seat: Seat) => { const mem = members.find(x => x.role === seat || (seat === "mandate_lead" && /lead|principal|partner/i.test(x.role))); return mem?.costRate ? { rate: mem.costRate, who: mem.name, assumed: false } : { rate: DEFAULT_SEAT_RATE, who: null, assumed: true }; };
  const seats = plan.map(([seat, hours]) => { const r = rateFor(seat); return { seat, hours, ...r, cost: hours * r.rate }; });
  const personnel = seats.reduce((s, x) => s + x.cost, 0);
  const monthlyRevenue = m.retainer;
  const months = m.termMonths ?? (m.engagementModel ? ENGAGEMENT_MODELS[m.engagementModel as keyof typeof ENGAGEMENT_MODELS]?.months : null) ?? 3;
  const monthlyCost = personnel + m.dataCost + m.partnerCost + m.travelCost;
  const totalRevenue = monthlyRevenue * months + m.pilotFee + m.implementationFee;
  const totalCost = monthlyCost * months;
  const s = m.successEconomics;
  const successNote = !s.structure || s.structure === "none" ? "No success component." : `${s.structure.replace(/_/g, " ")}${s.rate != null ? ` ${s.rate}%` : ""}${s.amount != null ? ` ${s.amount.toLocaleString("en-US")}` : ""}${s.cap != null ? `, cap ${s.cap.toLocaleString("en-US")}` : ""}: potential only, not counted in margin; counsel review ${s.counselReviewed ? "recorded" : "required"}.`;
  const breadth = BREADTH[m.breadth as keyof typeof BREADTH] ?? BREADTH.regional;
  const model = m.engagementModel ? ENGAGEMENT_MODELS[m.engagementModel as keyof typeof ENGAGEMENT_MODELS] : null;
  const recommended = model ? { low: Math.round(model.low * breadth.f / 500) * 500, high: Math.round(model.high * breadth.f / 500) * 500, why: `${model.label} template × ${breadth.label} (${breadth.f}×). A template, not a quote: adjust for qualification depth, outreach, specialists, data and exclusivity.` } : null;
  return { seats, personnel, monthlyCost, monthlyRevenue, months, totalRevenue, totalCost, grossProfit: totalRevenue - totalCost, margin: totalRevenue ? (totalRevenue - totalCost) / totalRevenue : null, contribution: monthlyRevenue - monthlyCost, successNote, recommended, assumedRates: seats.some(x => x.assumed) };
}

export async function deskSummary(db: Db, mandateIds: string[]) {
  if (!mandateIds.length) return [];
  const ms = await db.select().from(commercialMandates).where(inArray(commercialMandates.mandateId, mandateIds));
  const purs = await db.select().from(pursuits).where(inArray(pursuits.mandateId, mandateIds));
  const out = new Map<string, { desk: string; mandates: number; active: number; mrr: number; pipeline: number; weighted: number; pursuits: number; won: number; cost: number }>();
  for (const m of ms) {
    const d = out.get(m.desk) ?? { desk: m.desk, mandates: 0, active: 0, mrr: 0, pipeline: 0, weighted: 0, pursuits: 0, won: 0, cost: 0 };
    d.mandates++;
    if (["active", "pilot"].includes(m.status)) { d.active++; d.mrr += m.retainer; d.cost += (await mandateEconomics(db, m)).monthlyCost; }
    for (const p of purs.filter(x => x.commercialMandateId === m.id)) {
      d.pursuits++; if (p.outcome === "won") d.won++;
      if (p.outcome === "open" && p.value) { d.pipeline += p.value; d.weighted += p.value * probabilityOf(p.type as PursuitType, p.stage, p.probabilityOverride).effective / 100; }
    }
    out.set(m.desk, d);
  }
  return [...out.values()].map(d => ({ ...d, arr: d.mrr * 12, margin: d.mrr ? (d.mrr - d.cost) / d.mrr : null }));
}

// ---------------------------------------------------------------- health + automation (§92)
export async function mandateHealth(db: Db, m: Cm, now = new Date()) {
  const period = now.toISOString().slice(0, 7);
  const f = await deliveryFloor(db, m, period);
  const dayOfMonth = now.getUTCDate();
  const pace = f.lines.map(l => ({ ...l, expected: Math.round(l.target * Math.min(1, dayOfMonth / 30)) }));
  const behind = pace.filter(l => l.delivered < l.expected * 0.7);
  const stale = await db.select({ id: pursuits.id, name: pursuits.name }).from(pursuits).where(and(eq(pursuits.commercialMandateId, m.id), eq(pursuits.outcome, "open"), sql`coalesce(${pursuits.lastActionAt}, ${pursuits.createdAt}) < ${new Date(now.getTime() - 14 * 864e5).toISOString()}`));
  const health = ["draft", "proposed"].includes(m.status) ? "not_started" : behind.length > 1 || stale.length > 2 ? "at_risk" : behind.length || stale.length ? "watch" : "on_track";
  return { health, behind: behind.map(b => `${b.label}: ${b.delivered} of ~${b.expected} expected by now`), stale };
}

/** Daily: stalled pursuits (14 days) and high-priority candidates inside a 12-month window get a review task once. */
export async function mandateAutomation(db: Db, now = new Date()) {
  let tasksCreated = 0;
  const active = await db.select().from(commercialMandates).where(inArray(commercialMandates.status, ["active", "pilot"]));
  for (const m of active) {
    const h = await mandateHealth(db, m, now);
    if (h.health !== m.health) {
      await db.update(commercialMandates).set({ health: h.health, healthNote: [...h.behind, ...h.stale.map(s => `Stalled: ${s.name}`)].join(" · ") }).where(eq(commercialMandates.id, m.id));
      if (h.health === "at_risk") await emitEvent(db, { mandateId: m.mandateId, type: "MANDATE_AT_RISK", entityType: "commercial_mandates", entityId: m.id, payload: { name: m.name, reasons: h.behind }, actor: "system:mandates" });
    }
    for (const s of h.stale) {
      const title = `Stalled pursuit (14 days): ${s.name}`;
      const [dup] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.mandateId, m.mandateId), eq(tasks.title, title), eq(tasks.status, "open")));
      if (!dup) { await db.insert(tasks).values({ mandateId: m.mandateId, type: "follow_up", title, body: `Mandate ${m.name}. Record the next action or close the pursuit.`, dueAt: now.toISOString() }); tasksCreated++; }
    }
    const horizon = new Date(now.getTime() + 365 * 864e5).toISOString().slice(0, 10);
    const hot = await db.select({ id: mandateCandidates.id, name: mandateCandidates.name }).from(mandateCandidates).where(and(eq(mandateCandidates.commercialMandateId, m.id), eq(mandateCandidates.priority, "high"), eq(mandateCandidates.stage, "pre_qualified"), sql`${mandateCandidates.windowStart} <= ${horizon}`)).limit(10);
    for (const c of hot) {
      const title = `Review for qualification: ${c.name}`.slice(0, 200);
      const [dup] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.mandateId, m.mandateId), eq(tasks.title, title)));
      if (!dup) { await db.insert(tasks).values({ mandateId: m.mandateId, type: "other", title, body: `Mandate ${m.name}: high priority and the inferred procurement window opens within 12 months. Confirm sponsor, EPC status and blockers.`, dueAt: new Date(now.getTime() + 3 * 864e5).toISOString() }); tasksCreated++; }
    }
  }
  return { mandates: active.length, tasksCreated };
}

export async function listMandates(db: Db, mandateIds: string[]) {
  if (!mandateIds.length) return [];
  return db.select().from(commercialMandates).where(inArray(commercialMandates.mandateId, mandateIds)).orderBy(asc(commercialMandates.status), desc(commercialMandates.updatedAt));
}

export { ATTRIBUTION };
