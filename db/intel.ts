// Phase 4 intelligence and scale (docs/plans/phase-4.md): playbooks, proposals (learning loop and confirm-before-write),
// case records, MCP OAuth, privacy requests.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

/** Message templates per playbook (segment). Personal drafts still come from draft.sequence per person. */
export const playbookDrafts = sqliteTable("playbook_drafts", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  segmentId: text("segment_id").notNull(),
  step: integer("step").notNull(),
  day: integer("day").notNull(),
  channel: text("channel", { enum: ["email", "linkedin_connect", "linkedin_message"] }).notNull(),
  purpose: text("purpose").notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  styleIssues: text("style_issues", { mode: "json" }).$type<{ rule: string; detail: string }[]>(),
  ...timestamps,
}, t => [uniqueIndex("playbook_drafts_step").on(t.mandateId, t.segmentId, t.step)]);

export const PROPOSAL_KINDS = ["angle", "subject", "timing", "weights", "ladder", "action"] as const;
export const PROPOSAL_STATUSES = ["pending", "applied", "rejected", "expired", "failed"] as const;

/**
 * Anything that would change data and did not come from a direct click: learning-loop suggestions and writes
 * proposed by Ask the OS or the MCP server. Nothing is applied until a signed-in member confirms it.
 */
export const proposals = sqliteTable("proposals", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind", { enum: PROPOSAL_KINDS }).notNull(),
  source: text("source", { enum: ["learning", "ask", "mcp"] }).notNull(),
  title: text("title").notNull(),
  evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>(),
  change: text("change", { mode: "json" }).$type<{ action: string; args: Record<string, unknown> }>().notNull(),
  status: text("status", { enum: PROPOSAL_STATUSES }).notNull().default("pending"),
  createdBy: text("created_by").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: text("decided_at"),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
  reason: text("reason"),
  expiresAt: text("expires_at"),
  ...timestamps,
}, t => [index("proposals_status").on(t.mandateId, t.status, t.createdAt)]);

/** Won-deal decision records (SPEC section 14, case evidence). Private until disclosure is authorized. */
export const caseRecords = sqliteTable("case_records", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  dealId: text("deal_id").notNull(),
  decision: text("decision").notNull().default(""),
  outcome: text("outcome").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  disclosureAuthorized: integer("disclosure_authorized", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, t => [uniqueIndex("case_records_deal").on(t.dealId)]);

// ---------- MCP server OAuth 2.1 (authorization code + PKCE, dynamic client registration) ----------
export const mcpClients = sqliteTable("mcp_clients", {
  clientId: text("client_id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: text("created_at").notNull().default(now),
});

export const mcpCodes = sqliteTable("mcp_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  userEmail: text("user_email").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

export const mcpTokens = sqliteTable("mcp_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull(),
  kind: text("kind", { enum: ["access", "refresh", "personal"] }).notNull(),
  clientId: text("client_id"),
  userEmail: text("user_email").notNull(),
  label: text("label").notNull().default(""),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("mcp_tokens_hash").on(t.tokenHash), index("mcp_tokens_user").on(t.userEmail)]);

export const privacyRequests = sqliteTable("privacy_requests", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind", { enum: ["access", "erasure"] }).notNull(),
  subjectHash: text("subject_hash").notNull(),   // SHA-256 of the email: provable without keeping the address
  actor: text("actor").notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull().default(now),
});
