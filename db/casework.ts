// Phase 20 case-study tooling (docs/plans/phase-20-case-study-tooling.md): document extraction proposals, document
// requests, sponsor registry snapshots, regulated products, protected parties and client error reports. Additive only.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export type ExtractedProject = {
  name: string; country: string | null; locality: string | null; capacityMw: number | null; annualGwh: number | null; storage: string | null;
  tariff: string | null; capexUsd: number | null; financing: string | null; offtake: string | null; status: string | null; page: number | null;
};
export type Extraction = { sponsor: { name: string; country: string | null } | null; projects: ExtractedProject[]; statements: { statement: string; page: number | null }[] };

/** A document read by Claude: proposals only, until a person applies them. */
export const docExtractions = sqliteTable("doc_extractions", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  documentId: text("document_id"),
  fileName: text("file_name").notNull(),
  status: text("status", { enum: ["ready", "applied", "failed"] }).notNull().default("ready"),
  result: text("result", { mode: "json" }).$type<Extraction>(),
  error: text("error"),
  createdBy: text("created_by").notNull(),
  appliedBy: text("applied_by"),
  appliedAt: text("applied_at"),
  ...timestamps,
}, t => [index("doc_extractions_mandate").on(t.mandateId, t.createdAt)]);

export const REQUEST_ITEM_STATES = { requested: "Requested", received: "Received", partial: "Partial", not_available: "Not available", under_nda: "Held under NDA", waived: "Waived" } as const;

export const docRequests = sqliteTable("doc_requests", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),
  projectId: text("project_id"),
  title: text("title").notNull(),
  template: text("template").notNull(),
  ndaDocumentId: text("nda_document_id"),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  dueDate: text("due_date"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("doc_requests_mandate").on(t.mandateId, t.status)]);

export const docRequestItems = sqliteTable("doc_request_items", {
  id: id(),
  requestId: text("request_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  section: text("section").notNull(),
  item: text("item").notNull(),
  position: integer("position").notNull().default(0),
  status: text("status", { enum: Object.keys(REQUEST_ITEM_STATES) as [keyof typeof REQUEST_ITEM_STATES, ...(keyof typeof REQUEST_ITEM_STATES)[]] }).notNull().default("requested"),
  documentId: text("document_id"),
  note: text("note").notNull().default(""),
  updatedBy: text("updated_by"),
  ...timestamps,
}, t => [index("doc_request_items_request").on(t.requestId, t.position)]);

export type RegistryData = {
  status: string | null; incorporated: string | null; type: string | null; sic: string[];
  accountsNextDue: string | null; accountsLastMadeUpTo: string | null; accountsOverdue: boolean;
  officers: { name: string; role: string; appointed: string | null; resigned: string | null }[];
  charges: { code: string; status: string; created: string | null; entitled: string[] }[];
  filings: { date: string; type: string; description: string }[];
};
export type RegistryChange = { field: string; detail: string };

/** A dated copy of a sponsor's public registry record; `changes` compares it with the previous snapshot. */
export const registrySnapshots = sqliteTable("registry_snapshots", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  source: text("source").notNull(),                 // companies_house
  companyNumber: text("company_number").notNull(),
  data: text("data", { mode: "json" }).$type<RegistryData>().notNull(),
  changes: text("changes", { mode: "json" }).$type<RegistryChange[]>().notNull().default(sql`'[]'`),
  fetchedAt: text("fetched_at").notNull().default(now),
}, t => [index("registry_snapshots_org").on(t.orgId, t.fetchedAt)]);

/** A sponsor's securities or funds: regulated products. Outbound drafts naming one are held by the send gate. */
export const regulatedProducts = sqliteTable("regulated_products", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["bond", "shares", "fund", "note", "scheme", "other"] }).notNull().default("other"),
  aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("regulated_products_mandate").on(t.mandateId)]);

/** Parties protected by a non-circumvention clause: introductions to them are blocked until the protection ends. */
export const protectedParties = sqliteTable("protected_parties", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  partyName: text("party_name").notNull(),
  orgId: text("org_id"),
  protectedFor: text("protected_for").notNull(),     // who holds the protection (e.g. the sponsor under its agreement)
  agreementDocumentId: text("agreement_document_id"),
  until: text("until"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("protected_parties_mandate").on(t.mandateId)]);

/** Browser errors from signed-in sessions, so production-only failures (e.g. Atlas) are visible. */
export const clientErrors = sqliteTable("client_errors", {
  id: id(),
  email: text("email"),
  path: text("path").notNull(),
  kind: text("kind").notNull().default("error"),     // error | unhandledrejection | map
  message: text("message").notNull(),
  stack: text("stack").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("client_errors_created").on(t.createdAt)]);
