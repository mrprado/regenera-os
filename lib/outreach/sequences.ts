// Sequences, enrollment, drafting and approval (SPEC sections 8 and 21, docs/plans/phase-2.md).
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { contacts, dossiers, enrollments, mandates, messages, organizations, scores, segments, sequences, tasks, triggers, type SequenceStep } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { freshnessSince } from "@/lib/freshness";
import { enqueue } from "@/lib/jobs/queue";
import { validateMessage, type StyleIssue } from "@/lib/style/validate";

export const DEFAULT_SEQUENCES: { key: string; name: string; tier: "mass" | "targeted"; steps: SequenceStep[] }[] = [
  { key: "mass_default", name: "Mass tier default", tier: "mass", steps: [
    { day: 0, channel: "email", purpose: "Trigger or mandate hook, one-line decision read, entry offer" },
    { day: 2, channel: "linkedin_connect", purpose: "Connection note referencing the trigger" },
    { day: 5, channel: "email", purpose: "Proof point relevant to the segment (authorized case or Field Note)" },
    { day: 12, channel: "email", purpose: "A different angle or a direct question" },
    { day: 21, channel: "email", purpose: "Breakup: close politely, leave the door open" },
  ] },
  { key: "targeted_default", name: "Targeted tier default", tier: "targeted", steps: [
    { day: 0, channel: "linkedin_connect", purpose: "Connection note referencing one specific, sourced thing" },
    { day: 2, channel: "email", purpose: "Bespoke decision read and entry offer" },
    { day: 5, channel: "linkedin_message", purpose: "A relevant Field Note or insight" },
    { day: 12, channel: "email", purpose: "Proof point and a specific next step with the scoping-call link" },
    { day: 21, channel: "email", purpose: "Personal note or an introduction ask" },
  ] },
];

export async function ensureSequences(db: Db, mandateId: string) {
  for (const s of DEFAULT_SEQUENCES) {
    await db.insert(sequences).values({ mandateId, key: s.key, name: s.name, tier: s.tier, steps: s.steps }).onConflictDoNothing();
  }
}

// ---------- enrollment ----------
export type EnrollOutcome = { enrolled: number; skipped: Record<string, number> };

export async function enrollContacts(db: Db, input: { contactIds: string[]; sequenceId: string; actor: string; startAt?: Date }): Promise<EnrollOutcome> {
  const [seq] = await db.select().from(sequences).where(eq(sequences.id, input.sequenceId));
  if (!seq || !seq.active) throw new Error("Sequence not found or paused");
  const [mandate] = await db.select().from(mandates).where(eq(mandates.id, seq.mandateId));
  const out: EnrollOutcome = { enrolled: 0, skipped: {} };
  const skip = (reason: string) => { out.skipped[reason] = (out.skipped[reason] ?? 0) + 1; };
  const rows = await db.select().from(contacts).where(and(inArray(contacts.id, input.contactIds), eq(contacts.mandateId, seq.mandateId)));
  for (const c of rows) {
    if (mandate?.type === "investment") { skip("investment_mandate"); continue; }
    if (c.suppressed) { skip("suppressed"); continue; }
    if (seq.tier === "mass" && c.emailStatus !== "verified_provider" && c.emailStatus !== "verified_manual") { skip("mass_needs_verified_email"); continue; }
    if (!c.emailLower && seq.steps.some(s => s.channel === "email")) { skip("no_email"); continue; }
    try {
      const [e] = await db.insert(enrollments).values({
        mandateId: seq.mandateId, contactId: c.id, orgId: c.orgId, sequenceId: seq.id, status: "drafting",
        startAt: (input.startAt ?? new Date()).toISOString(), enrolledBy: input.actor,
      }).returning();
      await db.update(contacts).set({ leadState: "queued", updatedAt: new Date().toISOString() }).where(eq(contacts.id, c.id));
      await enqueue(db, "outreach.draft", { enrollmentId: e.id }, { dedupeKey: `draft:${e.id}` });
      out.enrolled++;
    } catch {
      skip("already_enrolled"); // partial unique index: one active enrollment per contact
    }
  }
  if (input.contactIds.length > rows.length) out.skipped.not_in_mandate = input.contactIds.length - rows.length;
  return out;
}

// ---------- drafting ----------
const zDraft = z.object({
  messages: z.array(z.object({
    step: z.number().int(),
    channel: z.enum(["email", "linkedin_connect", "linkedin_message"]),
    subject: z.string().describe("Empty for LinkedIn"),
    body: z.string(),
    angle_tag: z.string(),
    personalization_refs: z.array(z.string()),
  })),
});
export type DraftOutput = z.infer<typeof zDraft>;

const LINKEDIN_NOTE_LIMIT = 280;

export function checkDraft(d: DraftOutput["messages"][number], isFirstEmail: boolean): StyleIssue[] {
  if (d.channel === "email") return validateMessage({ subject: d.subject, body: d.body }, { firstTouch: isFirstEmail, advisory: true });
  const issues = validateMessage({ subject: "", body: d.body }, { firstTouch: false, advisory: true });
  if (d.channel === "linkedin_connect" && d.body.length > LINKEDIN_NOTE_LIMIT) issues.push({ rule: "length", detail: `Connection note is ${d.body.length} characters; LinkedIn allows ${LINKEDIN_NOTE_LIMIT}.` });
  return issues;
}

async function draftContext(db: Db, enrollmentId: string) {
  const [e] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
  if (!e) return null;
  const [seq] = await db.select().from(sequences).where(eq(sequences.id, e.sequenceId));
  const [c] = await db.select().from(contacts).where(eq(contacts.id, e.contactId));
  const [org] = c.orgId ? await db.select().from(organizations).where(eq(organizations.id, c.orgId)) : [];
  const [d] = c.orgId ? await db.select().from(dossiers).where(and(eq(dossiers.orgId, c.orgId), eq(dossiers.status, "ready"))).orderBy(desc(dossiers.refreshedAt)).limit(1) : [];
  const [score] = await db.select().from(scores).where(eq(scores.contactId, c.id)).orderBy(desc(scores.scoredAt)).limit(1);
  const seg = c.segmentId ? (await db.select().from(segments).where(eq(segments.id, c.segmentId)))[0] : undefined;
  const trig = c.orgId ? await db.select().from(triggers).where(and(eq(triggers.orgId, c.orgId), sql`${triggers.eventDate} >= ${freshnessSince().toISOString().slice(0, 10)}`)).orderBy(desc(triggers.urgency)).limit(3) : [];
  return { e, seq, c, org, d, score, seg, trig };
}

export async function draftEnrollment(db: Db, cfg: AiConfig, enrollmentId: string, opts: { angleHint?: string; onlyStep?: number } = {}, client?: Anthropic) {
  const ctx = await draftContext(db, enrollmentId);
  if (!ctx || !ctx.seq) return;
  const { e, seq, c, org, d, score, seg, trig } = ctx;
  const steps = seq.steps.map((s, i) => ({ ...s, step: i })).filter(s => opts.onlyStep === undefined || s.step === opts.onlyStep);
  const input = [
    `Contact: ${c.fullName}${c.title ? `, ${c.title}` : ""}${org ? ` at ${org.name}` : ""}${c.location ? ` (${c.location})` : ""}. Language: ${c.language ?? "match the contact's country; default English"}.`,
    seg ? `Segment: ${seg.name}. Entry offer: ${seg.entryOffer}. Default angle: ${seg.angle}` : "",
    score?.match ? `Engagement match: ${JSON.stringify(score.match)}` : "",
    trig.length ? `Current triggers:\n${trig.map(t => `- ${t.eventDate} ${t.type}: ${t.summary}${t.decisionRead ? `\n  Decision read: ${t.decisionRead}` : ""}`).join("\n")}` : "No current trigger.",
    d?.fields ? `Dossier (sourced):\n${JSON.stringify(d.fields).slice(0, 10000)}` : "No dossier; use only what is stated here.",
    `Tier: ${seq.tier}. Steps to write:\n${steps.map(s => `step ${s.step}: day ${s.day}, ${s.channel}, purpose: ${s.purpose}`).join("\n")}`,
    opts.angleHint ? `Use a different angle from before: ${opts.angleHint}` : "",
  ].filter(Boolean).join("\n\n");

  let out = await runStructured(db, cfg, "draft.sequence", input, zDraft, { entity: "enrollment", entityId: e.id }, client);
  const firstEmailStep = seq.steps.findIndex(s => s.channel === "email");
  let issuesByStep = new Map(out.messages.map(m => [m.step, checkDraft(m, m.step === firstEmailStep)]));
  const failing = [...issuesByStep.entries()].filter(([, v]) => v.length);
  if (failing.length) {
    const fix = failing.map(([step, v]) => `step ${step}: ${v.map(i => i.detail).join(" ")}`).join("\n");
    out = await runStructured(db, cfg, "draft.sequence", `${input}\n\nYour previous draft broke house style. Fix these and rewrite all steps:\n${fix}`, zDraft, { entity: "enrollment", entityId: e.id }, client);
    issuesByStep = new Map(out.messages.map(m => [m.step, checkDraft(m, m.step === firstEmailStep)]));
  }

  const start = new Date(e.startAt).getTime();
  for (const m of out.messages) {
    const def = seq.steps[m.step];
    if (!def || def.channel !== m.channel) continue;
    const due = new Date(start + def.day * 86_400_000).toISOString();
    const issues = issuesByStep.get(m.step) ?? [];
    if (opts.onlyStep !== undefined) {
      await db.update(messages).set({ status: "cancelled", updatedAt: new Date().toISOString() })
        .where(and(eq(messages.enrollmentId, e.id), eq(messages.step, m.step), inArray(messages.status, ["draft", "style_failed", "pending_approval", "approved"])));
    }
    const [msg] = await db.insert(messages).values({
      mandateId: e.mandateId, contactId: c.id, channel: m.channel, direction: "out",
      mailboxRole: seq.tier === "mass" ? "sending" : "primary", toEmail: c.emailLower ?? "",
      subject: m.subject, body: m.body, status: issues.length ? "style_failed" : "pending_approval",
      enrollmentId: e.id, step: m.step, scheduledAt: due, tier: seq.tier, angleTag: m.angle_tag, variantId: "v1", styleIssues: issues.length ? issues : null,
    }).returning();
    if (m.channel !== "email") {
      await db.insert(tasks).values({
        mandateId: e.mandateId, contactId: c.id, orgId: c.orgId, enrollmentId: e.id, messageId: msg.id,
        type: m.channel, title: `${m.channel === "linkedin_connect" ? "Send LinkedIn connection note" : "Send LinkedIn message"} to ${c.fullName}`,
        body: m.body, dueAt: due,
      });
    }
  }
  await db.update(enrollments).set({ status: "active", updatedAt: new Date().toISOString() }).where(and(eq(enrollments.id, e.id), eq(enrollments.status, "drafting")));
}

// ---------- approval ----------
/**
 * Approves one draft (optionally with edits, re-validated). On an advisory mandate, approving the first
 * email also approves the later emails of that enrollment (SPEC section 8: follow-ups on approved advisory
 * sequences need no further approval). Investment mandates never reach here (enrollment refuses them).
 */
export async function approveMessage(db: Db, messageId: string, actor: string, edits?: { subject?: string; body?: string }, now = new Date()): Promise<{ ok: boolean; issues?: StyleIssue[]; approved: number }> {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || !["pending_approval", "style_failed"].includes(m.status)) return { ok: false, approved: 0 };
  const subject = edits?.subject ?? m.subject;
  const body = edits?.body ?? m.body;
  const [seqRow] = m.enrollmentId ? await db.select({ steps: sequences.steps }).from(enrollments).innerJoin(sequences, eq(sequences.id, enrollments.sequenceId)).where(eq(enrollments.id, m.enrollmentId)) : [];
  const firstEmailStep = seqRow ? seqRow.steps.findIndex(s => s.channel === "email") : m.step;
  const issues = m.channel === "email"
    ? validateMessage({ subject, body }, { firstTouch: m.step === firstEmailStep, advisory: true })
    : checkDraft({ step: m.step ?? 0, channel: m.channel as "linkedin_connect", subject: "", body, angle_tag: "", personalization_refs: [] }, false);
  if (issues.length) {
    await db.update(messages).set({ subject, body, status: "style_failed", styleIssues: issues, updatedAt: now.toISOString() }).where(eq(messages.id, m.id));
    return { ok: false, issues, approved: 0 };
  }
  await db.update(messages).set({ subject, body, status: "approved", approvedBy: actor, approvedAt: now.toISOString(), styleIssues: null, updatedAt: now.toISOString() }).where(eq(messages.id, m.id));
  let approved = 1;
  if (m.enrollmentId && m.channel === "email" && m.step === firstEmailStep) {
    const later = await db.update(messages).set({ status: "approved", approvedBy: `auto:${actor}`, approvedAt: now.toISOString(), updatedAt: now.toISOString() })
      .where(and(eq(messages.enrollmentId, m.enrollmentId), eq(messages.channel, "email"), eq(messages.status, "pending_approval"), sql`${messages.step} > ${m.step}`))
      .returning({ id: messages.id });
    approved += later.length;
  }
  return { ok: true, approved };
}

export async function skipMessage(db: Db, messageId: string) {
  await db.update(messages).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(and(eq(messages.id, messageId), inArray(messages.status, ["pending_approval", "style_failed", "approved"])));
  await db.update(tasks).set({ status: "skipped" }).where(eq(tasks.messageId, messageId));
}

/** Undo within 60 seconds of approval: back to pending. */
export async function unapproveMessage(db: Db, messageId: string, now = new Date()) {
  const rows = await db.update(messages).set({ status: "pending_approval", approvedAt: null, approvedBy: null, updatedAt: now.toISOString() })
    .where(and(eq(messages.id, messageId), eq(messages.status, "approved"), sql`${messages.approvedAt} >= ${new Date(now.getTime() - 60_000).toISOString()}`))
    .returning({ id: messages.id });
  return rows.length === 1;
}

export async function queueCounts(db: Db, mandateIds: string[]) {
  return db.select({ tier: messages.tier, status: messages.status, n: sql<number>`count(*)` }).from(messages)
    .where(and(inArray(messages.mandateId, mandateIds), inArray(messages.status, ["pending_approval", "style_failed"]))).groupBy(messages.tier, messages.status);
}

