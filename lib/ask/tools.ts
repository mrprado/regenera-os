// One tool registry for Ask the OS and the MCP server (docs/plans/phase-4.md items 1 and 2).
// Read tools answer from the scoped data layer. Write tools never write: they create a pending proposal that a
// signed-in member confirms (proposals table). Every query filters by the caller's mandates.
import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { activities, contacts, deals, lists, organizations, proposals, replies, segments, sequences, triggers } from "@/db/schema";
import { mandateCondition, type UserScope } from "@/lib/db/scoped";
import { computeMetrics } from "@/lib/reports/metrics";
import { DEAL_STAGES } from "@/lib/vocab";

export type ToolCtx = { db: Db; scope: UserScope; actor: string; source: "ask" | "mcp"; now?: Date };
export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  kind: "read" | "write";
  input: S;
  run: (ctx: ToolCtx, args: z.infer<S>) => Promise<unknown>;
};

/** Keeps each tool's input type for its run function while storing them in one array. */
function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

const like_ = (s: string) => `%${s.toLowerCase()}%`;
const limit = z.number().int().min(1).max(50).default(20);
const STAGES = Object.keys(DEAL_STAGES) as [string, ...string[]];
const PROPOSAL_TTL_MS = 24 * 3_600_000;

async function propose(ctx: ToolCtx, mandateId: string, title: string, action: string, args: Record<string, unknown>) {
  const [p] = await ctx.db.insert(proposals).values({
    mandateId, kind: "action", source: ctx.source, title, change: { action, args }, createdBy: ctx.actor,
    expiresAt: new Date((ctx.now ?? new Date()).getTime() + PROPOSAL_TTL_MS).toISOString(),
  }).returning({ id: proposals.id });
  return { proposalId: p.id, status: "pending_confirmation", summary: title, note: "Nothing has changed yet. Ask the user to confirm this proposal before it runs." };
}

async function scopedContacts(ctx: ToolCtx, ids: string[]) {
  if (!ids.length) return [];
  return ctx.db.select({ id: contacts.id, name: contacts.fullName, mandateId: contacts.mandateId }).from(contacts)
    .where(and(inArray(contacts.id, ids.slice(0, 90)), mandateCondition(ctx.scope, contacts.mandateId)));
}

export const TOOLS: ToolDef[] = [
  tool({
    name: "search_people", kind: "read",
    description: "Find people in the CRM. Filters combine with AND. Returns name, title, organization, email status, score, tier and stage.",
    input: z.object({
      query: z.string().optional().describe("Name, email or organization text"), title: z.string().optional(),
      segment: z.string().optional().describe("Segment name or key, e.g. impact_family_offices"),
      country: z.string().optional(), tier: z.enum(["targeted", "mass", "watchlist", "parked"]).optional(),
      leadState: z.string().optional(), withCurrentTrigger: z.boolean().optional(), limit,
    }),
    run: async (ctx, a) => {
      const since = new Date(Date.UTC((ctx.now ?? new Date()).getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
      const conds: (SQL | undefined)[] = [
        mandateCondition(ctx.scope, contacts.mandateId), isNull(contacts.archivedAt),
        a.query ? or(like(sql`lower(${contacts.fullName})`, like_(a.query)), like(contacts.emailLower, like_(a.query)), like(sql`lower(coalesce(${organizations.name}, ''))`, like_(a.query))) : undefined,
        a.title ? like(sql`lower(coalesce(${contacts.title}, ''))`, like_(a.title)) : undefined,
        a.segment ? or(eq(segments.key, a.segment), like(sql`lower(${segments.name})`, like_(a.segment))) : undefined,
        a.country ? like(sql`lower(coalesce(${contacts.country}, '') || ' ' || coalesce(${contacts.location}, '') || ' ' || coalesce(${organizations.country}, ''))`, like_(a.country)) : undefined,
        a.tier ? eq(contacts.tier, a.tier) : undefined,
        a.leadState ? eq(contacts.leadState, a.leadState as never) : undefined,
        a.withCurrentTrigger ? sql`exists (select 1 from ${triggers} t where t.org_id = ${contacts.orgId} and t.event_date >= ${since} and t.status <> 'dismissed')` : undefined,
      ];
      const rows = await ctx.db.select({
        id: contacts.id, name: contacts.fullName, title: contacts.title, organization: organizations.name, country: contacts.country,
        emailStatus: contacts.emailStatus, score: contacts.score, tier: contacts.tier, stage: contacts.leadState, segment: segments.name,
      }).from(contacts).leftJoin(organizations, eq(organizations.id, contacts.orgId)).leftJoin(segments, eq(segments.id, contacts.segmentId))
        .where(and(...conds)).orderBy(desc(sql`coalesce(${contacts.score}, -1)`), asc(contacts.fullName)).limit(a.limit);
      const [{ total }] = await ctx.db.select({ total: sql<number>`count(*)` }).from(contacts).leftJoin(organizations, eq(organizations.id, contacts.orgId)).leftJoin(segments, eq(segments.id, contacts.segmentId)).where(and(...conds));
      return { total, shown: rows.length, people: rows };
    },
  }),
  tool({
    name: "search_companies", kind: "read",
    description: "Find organizations in the CRM, optionally only those with a current trigger (this calendar year).",
    input: z.object({ query: z.string().optional(), segment: z.string().optional(), country: z.string().optional(), withCurrentTrigger: z.boolean().optional(), limit }),
    run: async (ctx, a) => {
      const since = new Date(Date.UTC((ctx.now ?? new Date()).getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
      const trig = sql<number>`(select count(*) from ${triggers} t where t.org_id = ${organizations.id} and t.event_date >= ${since} and t.status <> 'dismissed')`;
      const conds: (SQL | undefined)[] = [
        mandateCondition(ctx.scope, organizations.mandateId), isNull(organizations.archivedAt),
        a.query ? or(like(sql`lower(${organizations.name})`, like_(a.query)), like(organizations.domain, like_(a.query))) : undefined,
        a.segment ? or(eq(segments.key, a.segment), like(sql`lower(${segments.name})`, like_(a.segment))) : undefined,
        a.country ? like(sql`lower(coalesce(${organizations.country}, '') || ' ' || coalesce(${organizations.location}, ''))`, like_(a.country)) : undefined,
        a.withCurrentTrigger ? sql`${trig} > 0` : undefined,
      ];
      const rows = await ctx.db.select({ id: organizations.id, name: organizations.name, domain: organizations.domain, country: organizations.country, segment: segments.name, currentTriggers: trig })
        .from(organizations).leftJoin(segments, eq(segments.id, organizations.segmentId)).where(and(...conds)).orderBy(desc(trig), asc(organizations.name)).limit(a.limit);
      const [{ total }] = await ctx.db.select({ total: sql<number>`count(*)` }).from(organizations).leftJoin(segments, eq(segments.id, organizations.segmentId)).where(and(...conds));
      return { total, shown: rows.length, companies: rows };
    },
  }),
  tool({
    name: "search_deals", kind: "read",
    description: "List deals with stage, value, probability, next action and dates. Use for pipeline questions.",
    input: z.object({ stage: z.enum(STAGES).optional(), query: z.string().optional(), openOnly: z.boolean().default(true), limit }),
    run: async (ctx, a) => {
      const conds: (SQL | undefined)[] = [
        mandateCondition(ctx.scope, deals.mandateId), isNull(deals.archivedAt),
        a.stage ? eq(deals.stage, a.stage as never) : a.openOnly ? sql`${deals.stage} not in ('lost','churned','completed')` : undefined,
        a.query ? like(sql`lower(${deals.name})`, like_(a.query)) : undefined,
      ];
      const rows = await ctx.db.select({ id: deals.id, name: deals.name, stage: deals.stage, engagement: deals.engagement, value: deals.valueEstimate, probability: deals.probability,
        nextAction: deals.nextAction, nextActionDate: deals.nextActionDate, expectedClose: deals.expectedClose, source: deals.source })
        .from(deals).where(and(...conds)).orderBy(desc(deals.updatedAt)).limit(a.limit);
      const [{ total, value }] = await ctx.db.select({ total: sql<number>`count(*)`, value: sql<number>`coalesce(sum(${deals.valueEstimate}), 0)` }).from(deals).where(and(...conds));
      return { total, totalValue: value, shown: rows.length, deals: rows };
    },
  }),
  tool({
    name: "search_triggers", kind: "read",
    description: "Current triggers (events that create a decision at an organization) with type, urgency, fit and Claude's decision read.",
    input: z.object({ type: z.string().optional(), status: z.enum(["new", "pursued", "watched", "dismissed"]).optional(), query: z.string().optional(), sinceDays: z.number().int().min(1).max(365).default(60), limit }),
    run: async (ctx, a) => {
      const since = new Date((ctx.now ?? new Date()).getTime() - a.sinceDays * 86_400_000).toISOString().slice(0, 10);
      const rows = await ctx.db.select({ id: triggers.id, organization: organizations.name, type: triggers.type, summary: triggers.summary, eventDate: triggers.eventDate,
        urgency: triggers.urgency, fit: triggers.relevance, status: triggers.status, decisionRead: triggers.decisionRead })
        .from(triggers).innerJoin(organizations, eq(organizations.id, triggers.orgId))
        .where(and(mandateCondition(ctx.scope, triggers.mandateId), gte(triggers.eventDate, since),
          a.type ? eq(triggers.type, a.type as never) : undefined, a.status ? eq(triggers.status, a.status) : sql`${triggers.status} <> 'dismissed'`,
          a.query ? or(like(sql`lower(${organizations.name})`, like_(a.query)), like(sql`lower(${triggers.summary})`, like_(a.query))) : undefined))
        .orderBy(desc(triggers.urgency), desc(triggers.relevance)).limit(a.limit);
      return { shown: rows.length, triggers: rows };
    },
  }),
  tool({
    name: "get_person", kind: "read",
    description: "One person's record: details, organization, latest activity timeline and open deals.",
    input: z.object({ id: z.string() }),
    run: async (ctx, a) => {
      const [c] = await ctx.db.select().from(contacts).where(and(eq(contacts.id, a.id), mandateCondition(ctx.scope, contacts.mandateId)));
      if (!c) return { error: "Not found in your mandates" };
      const [org] = c.orgId ? await ctx.db.select({ name: organizations.name, domain: organizations.domain, country: organizations.country }).from(organizations).where(eq(organizations.id, c.orgId)) : [];
      const timeline = await ctx.db.select({ at: activities.occurredAt, type: activities.type, detail: activities.detail }).from(activities).where(eq(activities.contactId, c.id)).orderBy(desc(activities.occurredAt)).limit(15);
      return { id: c.id, name: c.fullName, title: c.title, email: c.email, emailStatus: c.emailStatus, stage: c.leadState, tier: c.tier, score: c.score, organization: org ?? null, timeline };
    },
  }),
  tool({
    name: "pipeline_metrics", kind: "read",
    description: "Outreach and pipeline numbers for the last N days: reply rates by segment and angle, calls per 100, weighted pipeline, win rates.",
    input: z.object({ days: z.number().int().min(1).max(366).default(30) }),
    run: async (ctx, a) => {
      const now = ctx.now ?? new Date();
      const m = await computeMetrics(ctx.db, ctx.scope.mandateIds, { from: new Date(now.getTime() - a.days * 86_400_000).toISOString(), to: new Date(now.getTime() + 60_000).toISOString() });
      return { ...m, outreach: { ...m.outreach, byDim: Object.fromEntries(Object.entries(m.outreach.byDim).map(([k, v]) => [k, v.slice(0, 8)])) } };
    },
  }),
  tool({
    name: "list_replies", kind: "read",
    description: "Replies to outreach, newest first, with Claude's classification. Defaults to those not yet handled.",
    input: z.object({ unhandledOnly: z.boolean().default(true), limit }),
    run: async (ctx, a) => {
      const rows = await ctx.db.select({ id: replies.id, from: replies.fromEmail, person: contacts.fullName, subject: replies.subject, classification: replies.classification, receivedAt: replies.receivedAt, handled: replies.handled })
        .from(replies).leftJoin(contacts, eq(contacts.id, replies.contactId))
        .where(and(mandateCondition(ctx.scope, replies.mandateId), a.unhandledOnly ? eq(replies.handled, false) : undefined)).orderBy(desc(replies.receivedAt)).limit(a.limit);
      return { shown: rows.length, replies: rows };
    },
  }),
  // ---------- writes: proposals only ----------
  tool({
    name: "propose_add_to_list", kind: "write",
    description: "Propose adding people to a list (created if it does not exist). Needs the user's confirmation.",
    input: z.object({ contactIds: z.array(z.string()).min(1).max(90), listName: z.string().min(1).max(120) }),
    run: async (ctx, a) => {
      const found = await scopedContacts(ctx, a.contactIds);
      if (!found.length) return { error: "None of those people are in your mandates" };
      return propose(ctx, found[0].mandateId, `Add ${found.length} ${found.length === 1 ? "person" : "people"} to the list "${a.listName}"`, "add_to_list", { contactIds: found.filter(f => f.mandateId === found[0].mandateId).map(f => f.id), listName: a.listName });
    },
  }),
  tool({
    name: "propose_enroll", kind: "write",
    description: "Propose enrolling people in a sequence (by sequence name). Enrollment guards still apply. Needs the user's confirmation.",
    input: z.object({ contactIds: z.array(z.string()).min(1).max(90), sequence: z.string().describe("Sequence name or key") }),
    run: async (ctx, a) => {
      const found = await scopedContacts(ctx, a.contactIds);
      if (!found.length) return { error: "None of those people are in your mandates" };
      const [seq] = await ctx.db.select().from(sequences).where(and(mandateCondition(ctx.scope, sequences.mandateId), or(eq(sequences.key, a.sequence), like(sql`lower(${sequences.name})`, like_(a.sequence))), eq(sequences.active, true))).limit(1);
      if (!seq) return { error: `No active sequence matches "${a.sequence}"` };
      const ids = found.filter(f => f.mandateId === seq.mandateId).map(f => f.id);
      return propose(ctx, seq.mandateId, `Enroll ${ids.length} ${ids.length === 1 ? "person" : "people"} in "${seq.name}"`, "enroll", { contactIds: ids, sequenceId: seq.id });
    },
  }),
  tool({
    name: "propose_move_deal", kind: "write",
    description: "Propose moving a deal to another stage. Needs the user's confirmation.",
    input: z.object({ dealId: z.string(), stage: z.enum(STAGES) }),
    run: async (ctx, a) => {
      const [d] = await ctx.db.select().from(deals).where(and(eq(deals.id, a.dealId), mandateCondition(ctx.scope, deals.mandateId)));
      if (!d) return { error: "Deal not found in your mandates" };
      return propose(ctx, d.mandateId, `Move "${d.name}" from ${DEAL_STAGES[d.stage]} to ${DEAL_STAGES[a.stage as keyof typeof DEAL_STAGES]}`, "move_deal", { dealId: d.id, stage: a.stage });
    },
  }),
  tool({
    name: "propose_next_action", kind: "write",
    description: "Propose setting a deal's next action and date. Needs the user's confirmation.",
    input: z.object({ dealId: z.string(), action: z.string().min(1).max(300), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    run: async (ctx, a) => {
      const [d] = await ctx.db.select().from(deals).where(and(eq(deals.id, a.dealId), mandateCondition(ctx.scope, deals.mandateId)));
      if (!d) return { error: "Deal not found in your mandates" };
      return propose(ctx, d.mandateId, `Set the next action on "${d.name}": ${a.action} (${a.date})`, "next_action", { dealId: d.id, action: a.action, date: a.date });
    },
  }),
  tool({
    name: "propose_note", kind: "write",
    description: "Propose adding a note to a person's record. Needs the user's confirmation.",
    input: z.object({ contactId: z.string(), text: z.string().min(1).max(2000) }),
    run: async (ctx, a) => {
      const [c] = await scopedContacts(ctx, [a.contactId]);
      if (!c) return { error: "Person not found in your mandates" };
      return propose(ctx, c.mandateId, `Add a note to ${c.name}: "${a.text.slice(0, 80)}${a.text.length > 80 ? "…" : ""}"`, "note", { contactId: c.id, text: a.text });
    },
  }),
  tool({
    name: "propose_draft_email", kind: "write",
    description: "Propose a follow-up email draft for one person. On confirmation it goes to the approval queue (it is never sent directly).",
    input: z.object({ contactId: z.string(), subject: z.string().min(1).max(200), body: z.string().min(1).max(3000) }),
    run: async (ctx, a) => {
      const [c] = await scopedContacts(ctx, [a.contactId]);
      if (!c) return { error: "Person not found in your mandates" };
      return propose(ctx, c.mandateId, `Queue a draft email to ${c.name}: "${a.subject}"`, "draft_email", { contactId: c.id, subject: a.subject, body: a.body });
    },
  }),
];

export const toolByName = new Map(TOOLS.map(t => [t.name, t]));

export async function runTool(ctx: ToolCtx, name: string, rawArgs: unknown) {
  const tool = toolByName.get(name);
  if (!tool) return { error: `Unknown tool ${name}` };
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) return { error: `Invalid input: ${parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  return tool.run(ctx, parsed.data);
}

/** For listing lists in answers without exposing other mandates. */
export async function scopedListNames(db: Db, scope: UserScope) {
  return db.select({ id: lists.id, name: lists.name }).from(lists).where(mandateCondition(scope, lists.mandateId));
}
