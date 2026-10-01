// Read models for the Phase 2 screens. Every query is mandate-scoped.
import { and, asc, desc, eq, inArray, lte, sql, isNull, or } from "drizzle-orm";
import { contacts, deliverabilityChecks, meetingBriefs, dossiers, enrollments, mailboxState, messages, oauthAccounts, organizations, replies, scores, sequences, tasks, triggers } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { freshnessSince } from "@/lib/freshness";

export type QueueItem = {
  id: string; tier: string | null; step: number | null; channel: string; subject: string; body: string; status: string;
  scheduledAt: string | null; angleTag: string | null; styleIssues: { rule: string; detail: string }[] | null;
  contactId: string; contactName: string; contactTitle: string | null; email: string | null; emailStatus: string;
  orgId: string | null; orgName: string | null; sequenceName: string | null;
  decisionRead: string | null; regenerativeAngle: string | null; trigger: string | null; triggerRead: string | null; score: number | null;
  firstEmail: boolean;
};

export async function queueItems(scope: Scope, tier?: string, includeTests = false): Promise<QueueItem[]> {
  const db = appDb();
  const rows = await db.select({
    m: messages, contactName: contacts.fullName, contactTitle: contacts.title, email: contacts.email, emailStatus: contacts.emailStatus,
    orgId: contacts.orgId, orgName: organizations.name, sequenceName: sequences.name, steps: sequences.steps,
  }).from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .leftJoin(organizations, eq(organizations.id, contacts.orgId))
    .leftJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .leftJoin(sequences, eq(sequences.id, enrollments.sequenceId))
    .where(and(mandateCondition(scope, messages.mandateId), inArray(messages.status, ["pending_approval", "style_failed"]), tier ? eq(messages.tier, tier as "mass") : undefined, includeTests ? undefined : eq(contacts.testRecord, false)))
    .orderBy(asc(messages.tier), asc(organizations.name), asc(messages.enrollmentId), asc(messages.step)).limit(200);
  const orgIds = [...new Set(rows.map(r => r.orgId).filter((x): x is string => !!x))];
  const contactIds = [...new Set(rows.map(r => r.m.contactId))];
  const ds = orgIds.length ? await db.select({ orgId: dossiers.orgId, fields: dossiers.fields }).from(dossiers).where(and(inArray(dossiers.orgId, orgIds), eq(dossiers.status, "ready"))).orderBy(desc(dossiers.refreshedAt)) : [];
  const since = freshnessSince().toISOString().slice(0, 10);
  const ts = orgIds.length ? await db.select().from(triggers).where(and(inArray(triggers.orgId, orgIds), sql`${triggers.eventDate} >= ${since}`)).orderBy(desc(triggers.urgency)) : [];
  const sc = contactIds.length ? await db.select({ contactId: scores.contactId, total: scores.total }).from(scores).where(inArray(scores.contactId, contactIds)).orderBy(desc(scores.scoredAt)) : [];
  return rows.map(r => {
    const d = ds.find(x => x.orgId === r.orgId)?.fields as { decision_read?: string; regenerative_angle?: string } | undefined;
    const t = ts.find(x => x.orgId === r.orgId);
    return {
      id: r.m.id, tier: r.m.tier, step: r.m.step, channel: r.m.channel, subject: r.m.subject, body: r.m.body, status: r.m.status,
      scheduledAt: r.m.scheduledAt, angleTag: r.m.angleTag, styleIssues: r.m.styleIssues as QueueItem["styleIssues"],
      contactId: r.m.contactId, contactName: r.contactName, contactTitle: r.contactTitle, email: r.email, emailStatus: r.emailStatus,
      orgId: r.orgId, orgName: r.orgName, sequenceName: r.sequenceName,
      decisionRead: d?.decision_read ?? null, regenerativeAngle: d?.regenerative_angle ?? null,
      trigger: t ? `${t.eventDate} · ${t.summary}` : null, triggerRead: t?.decisionRead ?? null,
      score: sc.find(x => x.contactId === r.m.contactId)?.total ?? null,
      firstEmail: r.m.channel === "email" && (r.steps ? r.steps.findIndex(st => st.channel === "email") === r.m.step : true),
    };
  });
}

export async function sequenceOverview(scope: Scope) {
  const db = appDb();
  const seqs = await db.select().from(sequences).where(mandateCondition(scope, sequences.mandateId)).orderBy(asc(sequences.tier), asc(sequences.name));
  const ids = seqs.map(s => s.id);
  if (!ids.length) return [];
  const enr = await db.select({ sequenceId: enrollments.sequenceId, status: enrollments.status, n: sql<number>`count(*)` }).from(enrollments).where(inArray(enrollments.sequenceId, ids)).groupBy(enrollments.sequenceId, enrollments.status);
  const perStep = await db.select({
    sequenceId: enrollments.sequenceId, step: messages.step, angle: messages.angleTag,
    sent: sql<number>`sum(case when ${messages.status} = 'sent' then 1 else 0 end)`,
    pending: sql<number>`sum(case when ${messages.status} in ('pending_approval','style_failed','approved') then 1 else 0 end)`,
    replies: sql<number>`(select count(*) from ${replies} r where r.message_id in (select m2.id from ${messages} m2 join ${enrollments} e2 on e2.id = m2.enrollment_id where e2.sequence_id = ${enrollments.sequenceId} and m2.step = ${messages.step} and coalesce(m2.angle_tag,'') = coalesce(${messages.angleTag},'')) and r.classification not in ('out_of_office','bounce'))`,
  }).from(messages).innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(inArray(enrollments.sequenceId, ids)).groupBy(enrollments.sequenceId, messages.step, messages.angleTag);
  return seqs.map(s => ({
    ...s,
    enrollments: Object.fromEntries(enr.filter(e => e.sequenceId === s.id).map(e => [e.status, e.n])) as Record<string, number>,
    steps: s.steps.map((st, i) => ({ ...st, index: i, angles: perStep.filter(p => p.sequenceId === s.id && p.step === i) })),
  }));
}

export async function activeSequencesForPicker(scope: Scope) {
  return appDb().select({ id: sequences.id, name: sequences.name, tier: sequences.tier }).from(sequences)
    .where(and(mandateCondition(scope, sequences.mandateId), eq(sequences.active, true))).orderBy(asc(sequences.tier));
}

export async function openTasks(scope: Scope, status: "open" | "done" = "open", includeTests = false) {
  return appDb().select({
    t: tasks, contactName: contacts.fullName, linkedinUrl: contacts.linkedinUrl, orgName: organizations.name,
  }).from(tasks).leftJoin(contacts, eq(contacts.id, tasks.contactId)).leftJoin(organizations, eq(organizations.id, tasks.orgId))
    .where(and(mandateCondition(scope, tasks.mandateId), status === "open" ? eq(tasks.status, "open") : inArray(tasks.status, ["done", "skipped"]), includeTests ? undefined : eq(tasks.testRecord, false)))
    .orderBy(status === "open" ? asc(tasks.dueAt) : desc(tasks.updatedAt)).limit(200);
}

export async function inboxReplies(scope: Scope, view: "open" | "all" = "open", includeTests = false) {
  return appDb().select({
    r: replies, contactName: contacts.fullName, contactTitle: contacts.title, orgName: organizations.name, orgId: contacts.orgId,
  }).from(replies).leftJoin(contacts, eq(contacts.id, replies.contactId)).leftJoin(organizations, eq(organizations.id, replies.orgId))
    .where(and(mandateCondition(scope, replies.mandateId), view === "open" ? eq(replies.handled, false) : undefined, includeTests ? undefined : and(eq(replies.testRecord, false), or(isNull(contacts.testRecord), eq(contacts.testRecord, false)))))
    .orderBy(desc(replies.receivedAt)).limit(100);
}

/** Mailboxes, caps and DNS state: system-level (not mandate data), shown to owners in Settings. */
export async function sendingOverview() {
  const db = appDb();
  const boxes = await db.select({ role: oauthAccounts.mailboxRole, email: oauthAccounts.email }).from(oauthAccounts);
  const state = await db.select().from(mailboxState);
  const checks = await db.select().from(deliverabilityChecks).orderBy(desc(deliverabilityChecks.checkedAt)).limit(10);
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!latest.has(c.domain)) latest.set(c.domain, c);
  return { boxes, state, checks: [...latest.values()] };
}

export async function engageCounts(scope: Scope) {
  const db = appDb();
  const [q] = await db.select({ n: sql<number>`count(*)` }).from(messages).where(and(mandateCondition(scope, messages.mandateId), inArray(messages.status, ["pending_approval", "style_failed"])));
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(replies).where(and(mandateCondition(scope, replies.mandateId), eq(replies.handled, false)));
  const [t] = await db.select({ n: sql<number>`count(*)` }).from(tasks).where(and(mandateCondition(scope, tasks.mandateId), eq(tasks.status, "open"), lte(tasks.dueAt, `${new Date().toISOString().slice(0, 10)}T23:59:59Z`)));
  return { queue: q.n, replies: r.n, tasksDue: t.n };
}

export async function upcomingMeetings(scope: Scope, days = 7) {
  const now = new Date();
  return appDb().select({ b: meetingBriefs, contactName: contacts.fullName, orgName: organizations.name }).from(meetingBriefs)
    .leftJoin(contacts, eq(contacts.id, meetingBriefs.contactId)).leftJoin(organizations, eq(organizations.id, meetingBriefs.orgId))
    .where(and(mandateCondition(scope, meetingBriefs.mandateId), sql`${meetingBriefs.startsAt} >= ${new Date(now.getTime() - 3_600_000).toISOString()}`, sql`${meetingBriefs.startsAt} <= ${new Date(now.getTime() + days * 86_400_000).toISOString()}`))
    .orderBy(asc(meetingBriefs.startsAt)).limit(20);
}
