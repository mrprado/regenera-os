// Engagement delivery (phase 29A). Templates are versioned and start as drafts; instantiating one copies its milestones,
// deliverables, client requests and tasks into the engagement, so later template edits never change live work.
// A deliverable is done internally before it goes to the client; only the client's acceptance (recorded with who and
// evidence) makes it accepted. Blocked work names a reason and the party it waits on. Change requests never edit the
// accepted proposal: an approved change adds deliverables and fee to the engagement and is kept as its own record.
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { changeRequests, clientRequests, deliveryTemplates, engagementDeliverables, engagementMilestones, engagements, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { DeliverableStatus } from "./vocab";

const addDays = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

type Seed = Omit<typeof deliveryTemplates.$inferInsert, "mandateId" | "createdBy">;
/** Starter templates: drafts for the owner to review and approve. No prices; content only. */
export const STARTER_TEMPLATES: Seed[] = [
  { key: "solar_diagnostic", name: "Solar developer diagnostic", serviceKey: "project_diagnostic", description: "Screen a solar or BESS project's readiness and capital pathway.",
    milestones: [{ key: "kickoff", label: "Kick-off and document intake", offsetWeeks: 0 }, { key: "review", label: "Evidence review", offsetWeeks: 2 }, { key: "report", label: "Diagnostic report", offsetWeeks: 4 }],
    deliverables: [{ label: "Document gap list", milestoneKey: "kickoff", clientReview: false }, { label: "Readiness assessment with evidence", milestoneKey: "review", inputs: ["Site control", "Interconnection study", "Permits"] }, { label: "Diagnostic report and capital pathway", milestoneKey: "report" }],
    requests: [{ label: "Site control documents (lease, option or title)", dueOffsetDays: 7 }, { label: "Interconnection application or study", dueOffsetDays: 7 }, { label: "Permit status and correspondence", dueOffsetDays: 10 }, { label: "Financial model or capex estimate", dueOffsetDays: 10 }],
    tasks: [{ title: "Kick-off call", offsetDays: 2 }], qualification: ["Sponsor and decision-maker known", "Site identified", "Budget path for the diagnostic"], seeded: true },
  { key: "readiness_engagement", name: "Project readiness engagement", serviceKey: "readiness_assessment", description: "Close the gaps found in a diagnostic until the project is ready for placement.",
    milestones: [{ key: "plan", label: "Readiness plan", offsetWeeks: 0 }, { key: "close", label: "Gap closure", offsetWeeks: 6 }, { key: "pack", label: "Placement pack", offsetWeeks: 12 }],
    deliverables: [{ label: "Readiness plan with owners", milestoneKey: "plan" }, { label: "Closed-gap evidence log", milestoneKey: "close" }, { label: "Placement information pack", milestoneKey: "pack" }],
    requests: [{ label: "Owner for each open gap", dueOffsetDays: 7 }], tasks: [{ title: "Fortnightly progress review", offsetDays: 14 }], qualification: ["Diagnostic complete", "Sponsor commits resources to close gaps"], seeded: true },
  { key: "land_infrastructure", name: "Land and infrastructure assessment", serviceKey: "site_intel_assess", description: "Parcel, grid, water and constraint screening for a site or portfolio.",
    milestones: [{ key: "scope", label: "Area and questions agreed", offsetWeeks: 0 }, { key: "screen", label: "Screening", offsetWeeks: 3 }, { key: "report", label: "Assessment report", offsetWeeks: 5 }],
    deliverables: [{ label: "Study area and question list", milestoneKey: "scope", clientReview: false }, { label: "Constraint and infrastructure screening with sources", milestoneKey: "screen" }, { label: "Assessment report", milestoneKey: "report" }],
    requests: [{ label: "Boundaries (GeoJSON, KML or shapefile)", dueOffsetDays: 5 }], tasks: [], qualification: ["Geography defined", "Decision the assessment supports"], seeded: true },
  { key: "capital_screening", name: "Capital-source screening", serviceKey: "capital_provider_screening", description: "Research and screen capital sources against a project's requirements.",
    milestones: [{ key: "brief", label: "Capital brief", offsetWeeks: 0 }, { key: "screen", label: "Source screening", offsetWeeks: 3 }, { key: "shortlist", label: "Shortlist and approach plan", offsetWeeks: 5 }],
    deliverables: [{ label: "Capital requirement brief", milestoneKey: "brief" }, { label: "Screened source list with fit evidence and exclusions", milestoneKey: "screen" }, { label: "Shortlist and approach plan", milestoneKey: "shortlist" }],
    requests: [{ label: "Capital requirement, instrument and timing", dueOffsetDays: 5 }, { label: "Authorisation to share project information", dueOffsetDays: 10 }], tasks: [], qualification: ["Capital requirement stated", "Authority to approach sources"], seeded: true },
  { key: "ai_implementation", name: "AI intelligence implementation", serviceKey: "ai_systems_implementation", description: "Requirements, build, integration, acceptance and support for a specialised intelligence system.",
    milestones: [{ key: "requirements", label: "Requirements", offsetWeeks: 0 }, { key: "build", label: "Build and integration", offsetWeeks: 4 }, { key: "acceptance", label: "Acceptance", offsetWeeks: 8 }, { key: "support", label: "Support handover", offsetWeeks: 9 }],
    deliverables: [{ label: "Requirements and data access plan", milestoneKey: "requirements" }, { label: "Working system in the client's environment", milestoneKey: "build" }, { label: "Acceptance test record", milestoneKey: "acceptance" }, { label: "Runbook and support terms", milestoneKey: "support" }],
    requests: [{ label: "System and data access", dueOffsetDays: 7 }, { label: "Named client owner for acceptance", dueOffsetDays: 7 }], tasks: [], qualification: ["Problem and users defined", "Data access is possible", "Acceptance owner named"], seeded: true },
  { key: "monitoring_retainer", name: "Ongoing monitoring retainer", serviceKey: "monitoring_stewardship", description: "Recurring monitoring and advisory with a reporting cadence.",
    milestones: [{ key: "setup", label: "Monitoring set-up", offsetWeeks: 0 }, { key: "cycle1", label: "First reporting cycle", offsetWeeks: 4 }],
    deliverables: [{ label: "Monitoring plan and indicators", milestoneKey: "setup" }, { label: "Monthly monitoring report", milestoneKey: "cycle1" }],
    requests: [{ label: "Data feeds or reporting contacts", dueOffsetDays: 7 }], tasks: [{ title: "Quarterly relationship review", offsetDays: 90 }], qualification: ["Reporting cadence agreed"], reportingCadence: "monthly", seeded: true },
];

export async function ensureTemplates(db: Db, mandateId: string, by = "system") {
  for (const t of STARTER_TEMPLATES) await db.insert(deliveryTemplates).values({ ...t, mandateId, createdBy: by }).onConflictDoNothing();
}

export async function templatesFor(db: Db, mandateId: string) {
  return db.select().from(deliveryTemplates).where(eq(deliveryTemplates.mandateId, mandateId)).orderBy(asc(deliveryTemplates.name), desc(deliveryTemplates.version));
}

/** A template edit is a new version; engagements keep the version they were created from. */
export async function newTemplateVersion(db: Db, templateId: string, patch: Partial<Pick<Seed, "name" | "description" | "milestones" | "deliverables" | "requests" | "tasks" | "qualification" | "reportingCadence">>, by: string) {
  const [t] = await db.select().from(deliveryTemplates).where(eq(deliveryTemplates.id, templateId));
  if (!t) throw new Error("Template not found");
  const [latest] = await db.select({ version: deliveryTemplates.version }).from(deliveryTemplates).where(and(eq(deliveryTemplates.mandateId, t.mandateId), eq(deliveryTemplates.key, t.key))).orderBy(desc(deliveryTemplates.version)).limit(1);
  const rest = { mandateId: t.mandateId, key: t.key, name: t.name, serviceKey: t.serviceKey, description: t.description, milestones: t.milestones, deliverables: t.deliverables, requests: t.requests, tasks: t.tasks, qualification: t.qualification, reportingCadence: t.reportingCadence };
  const [v] = await db.insert(deliveryTemplates).values({ ...rest, ...patch, version: latest.version + 1, status: "draft", seeded: false, createdBy: by }).returning();
  return v;
}

export async function setTemplateStatus(db: Db, templateId: string, status: "approved" | "retired", by: string) {
  await db.update(deliveryTemplates).set({ status, updatedAt: new Date().toISOString() }).where(eq(deliveryTemplates.id, templateId));
  await audit(db, { actor: by, action: `template_${status}`, entity: "delivery_templates", entityId: templateId });
}

/** Copies the template into the engagement. Refuses a second instantiation on the same engagement. */
export async function instantiateTemplate(db: Db, engagementId: string, templateId: string, startDate: string, by: string) {
  const [e] = await db.select().from(engagements).where(eq(engagements.id, engagementId));
  const [t] = await db.select().from(deliveryTemplates).where(eq(deliveryTemplates.id, templateId));
  if (!e || !t) throw new Error("Engagement or template not found");
  if (t.mandateId !== e.mandateId) throw new Error("Template belongs to another workspace");
  if (t.status === "retired") throw new Error("This template is retired");
  if (e.templateId) throw new Error("This engagement already has a delivery plan");
  const ms = new Map<string, string>();
  for (const [i, m] of t.milestones.entries()) {
    const [row] = await db.insert(engagementMilestones).values({ mandateId: e.mandateId, engagementId, key: m.key, label: m.label, dueDate: addDays(startDate, m.offsetWeeks * 7), sort: i, createdBy: by }).returning();
    ms.set(m.key, row.id);
  }
  for (const d of t.deliverables) {
    const m = t.milestones.find(x => x.key === d.milestoneKey);
    await db.insert(engagementDeliverables).values({ mandateId: e.mandateId, engagementId, milestoneId: ms.get(d.milestoneKey) ?? null, label: d.label, description: d.description ?? "", inputs: d.inputs ?? [], clientReview: d.clientReview ?? true, dueDate: m ? addDays(startDate, m.offsetWeeks * 7) : null, owner: e.owner, createdBy: by });
  }
  for (const r of t.requests) await db.insert(clientRequests).values({ mandateId: e.mandateId, engagementId, label: r.label, description: r.description ?? "", dueDate: addDays(startDate, r.dueOffsetDays), createdBy: by });
  for (const k of t.tasks) await db.insert(tasks).values({ mandateId: e.mandateId, orgId: e.orgId, dealId: e.dealId, projectId: e.projectId, type: "other", title: `${e.name}: ${k.title}`, dueAt: `${addDays(startDate, k.offsetDays)}T09:00:00.000Z`, owner: e.owner, workstream: `engagement:${engagementId}` });
  await db.update(engagements).set({ templateId: t.id, templateVersion: t.version, reportingCadence: e.reportingCadence || t.reportingCadence, updatedAt: new Date().toISOString() }).where(eq(engagements.id, engagementId));
  await audit(db, { actor: by, action: "delivery_plan_created", entity: "engagements", entityId: engagementId, after: { template: t.key, version: t.version } });
}

export async function deliveryPlan(db: Db, engagementId: string) {
  const [milestones, deliverables, requests, changes] = await Promise.all([
    db.select().from(engagementMilestones).where(eq(engagementMilestones.engagementId, engagementId)).orderBy(asc(engagementMilestones.sort)),
    db.select().from(engagementDeliverables).where(eq(engagementDeliverables.engagementId, engagementId)).orderBy(asc(engagementDeliverables.dueDate)),
    db.select().from(clientRequests).where(eq(clientRequests.engagementId, engagementId)).orderBy(asc(clientRequests.dueDate)),
    db.select().from(changeRequests).where(eq(changeRequests.engagementId, engagementId)).orderBy(desc(changeRequests.createdAt)),
  ]);
  return { milestones, deliverables, requests, changes };
}

/** Allowed moves. Client acceptance and revision requests are recorded with a person and a note. */
const NEXT: Record<DeliverableStatus, DeliverableStatus[]> = {
  not_started: ["in_progress", "blocked"], in_progress: ["internal_done", "blocked"], blocked: ["in_progress"],
  internal_done: ["in_client_review", "in_progress", "accepted"], in_client_review: ["accepted", "revision_requested"],
  revision_requested: ["in_progress"], accepted: [],
};

export async function moveDeliverable(db: Db, id: string, to: DeliverableStatus, input: { by: string; evidence?: string; note?: string; blockedReason?: string; blockedParty?: string; clientName?: string }) {
  const [d] = await db.select().from(engagementDeliverables).where(eq(engagementDeliverables.id, id));
  if (!d) throw new Error("Deliverable not found");
  if (!NEXT[d.status].includes(to)) throw new Error(`A deliverable that is ${d.status.replace(/_/g, " ")} cannot move to ${to.replace(/_/g, " ")}.`);
  const t = new Date().toISOString();
  const set: Partial<typeof engagementDeliverables.$inferInsert> = { status: to, updatedAt: t };
  if (to === "blocked") {
    if (!input.blockedReason?.trim() || !input.blockedParty?.trim()) throw new Error("Blocked work needs a reason and the party it waits on.");
    Object.assign(set, { blockedReason: input.blockedReason, blockedParty: input.blockedParty });
  }
  if (to === "in_progress") Object.assign(set, { blockedReason: null, blockedParty: null });
  if (to === "internal_done") {
    if (d.dependsOn) { const [dep] = await db.select({ status: engagementDeliverables.status, label: engagementDeliverables.label }).from(engagementDeliverables).where(eq(engagementDeliverables.id, d.dependsOn)); if (dep && !["internal_done", "in_client_review", "accepted"].includes(dep.status)) throw new Error(`Waits for "${dep.label}".`); }
    if (!input.evidence?.trim() && !d.documentId && !d.artifactUrl) throw new Error("Attach the artifact or record completion evidence.");
    Object.assign(set, { internalDoneAt: t, internalDoneBy: input.by, completionEvidence: input.evidence ?? d.completionEvidence });
  }
  if (to === "accepted") {
    // Accepting without client review is only for deliverables marked internal (no client review).
    if (d.status === "internal_done" && d.clientReview) throw new Error("Send it to the client for review; the client accepts it.");
    if (d.clientReview && (!input.clientName?.trim() || !input.note?.trim())) throw new Error("Record who accepted it and how (signed acceptance, email, portal).");
    Object.assign(set, { acceptedAt: t, acceptedBy: input.clientName ?? input.by, acceptanceNote: input.note ?? "" });
  }
  if (to === "revision_requested") {
    if (!input.note?.trim()) throw new Error("Record what the client asked to change.");
    Object.assign(set, { revisionNote: input.note, version: d.version + 1 });
  }
  await db.update(engagementDeliverables).set(set).where(eq(engagementDeliverables.id, id));
  await audit(db, { actor: input.by, action: "deliverable_status", entity: "engagement_deliverables", entityId: id, before: { status: d.status }, after: { status: to } });
  // A milestone is done when all its deliverables are accepted.
  if (to === "accepted" && d.milestoneId) {
    const rest = await db.select({ status: engagementDeliverables.status }).from(engagementDeliverables).where(eq(engagementDeliverables.milestoneId, d.milestoneId));
    if (rest.every(r => r.status === "accepted")) await db.update(engagementMilestones).set({ status: "done", completedAt: t, updatedAt: t }).where(eq(engagementMilestones.id, d.milestoneId));
  }
}

export async function submitClientRequest(db: Db, id: string, input: { response: string; documentId?: string | null; by: string }) {
  const [r] = await db.select().from(clientRequests).where(eq(clientRequests.id, id));
  if (!r) throw new Error("Request not found");
  if (!["open", "rejected"].includes(r.status)) throw new Error("This request is not waiting for a response.");
  if (!input.response.trim() && !input.documentId) throw new Error("Add a response or a document.");
  await db.update(clientRequests).set({ status: "submitted", response: input.response, documentId: input.documentId ?? r.documentId, submittedAt: new Date().toISOString(), submittedBy: input.by, updatedAt: new Date().toISOString() }).where(eq(clientRequests.id, id));
}

export async function reviewClientRequest(db: Db, id: string, decision: "accepted" | "rejected", note: string, by: string) {
  const [r] = await db.select().from(clientRequests).where(eq(clientRequests.id, id));
  if (!r || r.status !== "submitted") throw new Error("Only a submitted request can be reviewed.");
  if (decision === "rejected" && !note.trim()) throw new Error("Say what is missing.");
  await db.update(clientRequests).set({ status: decision, reviewedAt: new Date().toISOString(), reviewedBy: by, reviewNote: note, updatedAt: new Date().toISOString() }).where(eq(clientRequests.id, id));
}

export async function proposeChange(db: Db, engagementId: string, input: { title: string; description: string; scopeEffect: string; feeImpact: number; timelineWeeks: number; addDeliverables: string[] }, by: string) {
  const [e] = await db.select().from(engagements).where(eq(engagements.id, engagementId));
  if (!e) throw new Error("Engagement not found");
  if (!input.title.trim() || !input.scopeEffect.trim()) throw new Error("A change needs a title and its effect on scope.");
  const [c] = await db.insert(changeRequests).values({ mandateId: e.mandateId, engagementId, baseVersionId: e.acceptedVersionId, ...input, currency: e.currency, requestedBy: by, createdBy: by }).returning();
  return c;
}

/** Approval needs the client's evidence; it adds deliverables and fee to the engagement and leaves the agreed version as it was. */
export async function decideChange(db: Db, id: string, decision: "approved" | "rejected", evidence: string, by: string) {
  const [c] = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
  if (!c || c.status !== "proposed") throw new Error("Only a proposed change can be decided.");
  if (decision === "approved" && !evidence.trim()) throw new Error("Record the client's approval (email, signed change order).");
  const t = new Date().toISOString();
  await db.update(changeRequests).set({ status: decision, decidedBy: by, decidedAt: t, decisionEvidence: evidence, updatedAt: t }).where(eq(changeRequests.id, id));
  if (decision === "approved") {
    const [e] = await db.select().from(engagements).where(eq(engagements.id, c.engagementId));
    for (const label of c.addDeliverables) await db.insert(engagementDeliverables).values({ mandateId: c.mandateId, engagementId: c.engagementId, label, description: `Added by change request "${c.title}"`, owner: e.owner, createdBy: by });
    await db.update(engagements).set({ fee: e.fee + c.feeImpact, endDate: e.endDate && c.timelineWeeks ? addDays(e.endDate, Math.round(c.timelineWeeks * 7)) : e.endDate, updatedAt: t }).where(eq(engagements.id, c.engagementId));
  }
  await audit(db, { actor: by, action: `change_${decision}`, entity: "change_requests", entityId: id, after: { fee: c.feeImpact, weeks: c.timelineWeeks } });
}
