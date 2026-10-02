// Analyst workbench (docs/plans/phase-10-client-os.md; analyst-production prompt). Workspace-scoped like everything
// else. Evidence items reference existing claims, documents and Atlas views rather than copying them.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  CONCLUSIONS, CONFIDENCE, CONFIDENTIALITY, EVIDENCE_CLASSES, EVIDENCE_KINDS, FINDING_KINDS, IC_STATUSES, MODES, NODE_KINDS, NODE_STATUSES, OUTPUT_FORMATS, PRIORITIES,
  RELIABILITY, REQUEST_STATUSES, REVIEW_MARKS, SEVERITY,
} from "../lib/workbench/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'[]'`);
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const analysisRequests = sqliteTable("analysis_requests", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  question: text("question").notNull(),
  decision: text("decision").notNull().default(""),             // what decision this informs
  mode: text("mode", { enum: keys(MODES) }).notNull().default("formal"),
  template: text("template").notNull().default("custom"),
  status: text("status", { enum: keys(REQUEST_STATUSES) }).notNull().default("open"),
  requester: text("requester").notNull(),
  owner: text("owner"),                                         // the analyst
  reviewer: text("reviewer"),
  decisionMaker: text("decision_maker"),
  deadline: text("deadline"),
  outputFormat: text("output_format", { enum: keys(OUTPUT_FORMATS) }).notNull().default("memo"),
  audience: text("audience").notNull().default(""),
  scope: text("scope").notNull().default(""),
  priority: text("priority", { enum: keys(PRIORITIES) }).notNull().default("normal"),
  confidentiality: text("confidentiality", { enum: keys(CONFIDENTIALITY) }).notNull().default("internal"),
  projectId: text("project_id"), dealId: text("deal_id"), engagementId: text("engagement_id"), workMandateId: text("work_mandate_id"), workstreamId: text("workstream_id"),
  // Synthesis
  summary: text("summary").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  conclusion: text("conclusion").notNull().default(""),
  // Sign-off (human names only; AI is never the owner, reviewer or approver)
  preparedBy: text("prepared_by"), preparedAt: text("prepared_at"),
  reviewedBy: text("reviewed_by"), reviewedAt: text("reviewed_at"),
  approvedBy: text("approved_by"), approvedAt: text("approved_at"),
  version: integer("version").notNull().default(1),
  // Investment committee
  icStatus: text("ic_status", { enum: keys(IC_STATUSES) }).notNull().default("none"),
  icConditions: text("ic_conditions").notNull().default(""),
  icFollowUps: text("ic_follow_ups").notNull().default(""),
  icRationale: text("ic_rationale").notNull().default(""),
  decisionId: text("decision_id"),
  ...timestamps,
}, t => [index("analysis_requests_mandate").on(t.mandateId, t.status), index("analysis_requests_project").on(t.projectId)]);

export const issueNodes = sqliteTable("issue_nodes", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  requestId: text("request_id").notNull().references(() => analysisRequests.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  kind: text("kind", { enum: keys(NODE_KINDS) }).notNull().default("question"),
  text: text("text").notNull(),
  evidenceRequired: text("evidence_required").notNull().default(""),
  owner: text("owner"),
  due: text("due"),
  status: text("status", { enum: keys(NODE_STATUSES) }).notNull().default("open"),
  conclusion: text("conclusion", { enum: keys(CONCLUSIONS) }),
  confidence: text("confidence", { enum: keys(CONFIDENCE) }).notNull().default("unknown"),
  rationale: text("rationale").notNull().default(""),
  position: integer("position").notNull().default(0),
  ...timestamps,
}, t => [index("issue_nodes_request").on(t.requestId, t.parentId)]);

export const evidenceItems = sqliteTable("evidence_items", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  requestId: text("request_id").references(() => analysisRequests.id, { onDelete: "cascade" }),
  nodeId: text("node_id"),
  projectId: text("project_id"),
  kind: text("kind", { enum: keys(EVIDENCE_KINDS) }).notNull().default("document"),
  evidenceClass: text("evidence_class", { enum: keys(EVIDENCE_CLASSES) }).notNull(),
  title: text("title").notNull(),
  source: text("source").notNull().default(""),
  sourceUrl: text("source_url"),
  documentId: text("document_id"), claimId: text("claim_id"),
  mapView: text("map_view"),                                    // encoded Atlas view: reproducible map state
  sourceDate: text("source_date"),
  author: text("author").notNull().default(""),
  excerpt: text("excerpt").notNull().default(""),
  page: text("page"),
  geography: text("geography").notNull().default(""),
  reliability: text("reliability", { enum: keys(RELIABILITY) }).notNull().default("medium"),
  note: text("note").notNull().default(""),
  addedBy: text("added_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("evidence_items_request").on(t.requestId), index("evidence_items_project").on(t.projectId)]);

export const findings = sqliteTable("findings", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  requestId: text("request_id").notNull().references(() => analysisRequests.id, { onDelete: "cascade" }),
  nodeId: text("node_id"),
  kind: text("kind", { enum: keys(FINDING_KINDS) }).notNull().default("finding"),
  finding: text("finding").notNull(),
  implication: text("implication").notNull().default(""),
  severity: text("severity", { enum: keys(SEVERITY) }).notNull().default("medium"),
  resolution: text("resolution").notNull().default(""),
  assumptions: text("assumptions").notNull().default(""),
  confidence: text("confidence", { enum: keys(CONFIDENCE) }).notNull().default("preliminary"),
  evidenceIds: json<string[]>("evidence_ids"),
  preparedBy: text("prepared_by").notNull(),
  reviewedBy: text("reviewed_by"), reviewedAt: text("reviewed_at"),
  action: text("action"),                                       // e.g. task:<id>, risk:<id>, decision:<id>
  position: integer("position").notNull().default(0),
  ...timestamps,
}, t => [index("findings_request").on(t.requestId)]);

/** Storyline: context → observation → implication → recommendation → action. */
export const storyPoints = sqliteTable("story_points", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  requestId: text("request_id").notNull().references(() => analysisRequests.id, { onDelete: "cascade" }),
  observation: text("observation").notNull(),
  implication: text("implication").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  action: text("action").notNull().default(""),
  findingIds: json<string[]>("finding_ids"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("story_points_request").on(t.requestId)]);

export const reviewMarks = sqliteTable("review_marks", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  requestId: text("request_id").notNull().references(() => analysisRequests.id, { onDelete: "cascade" }),
  targetType: text("target_type", { enum: ["request", "node", "finding", "story", "evidence"] }).notNull(),
  targetId: text("target_id").notNull(),
  mark: text("mark", { enum: keys(REVIEW_MARKS) }).notNull(),
  comment: text("comment").notNull().default(""),
  author: text("author").notNull(),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolvedBy: text("resolved_by"), resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("review_marks_request").on(t.requestId, t.status)]);
