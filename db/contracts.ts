// Contracts per engagement (docs/plans/phase-5.md part E). Templates are starting points for counsel, not legal
// advice. Payments are tracked only: no payment processing, and no investor money ever touches Regenera.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CONFIDENTIALITY, DOCUMENT_CATEGORIES, DOCUMENT_STATUSES, LIFECYCLE, OBLIGATION_CATEGORIES, OBLIGATION_STATUSES, RECURRENCE } from "../lib/contracts/catalog";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const CONTRACT_KINDS = ["engagement_letter", "sow", "nda", "referral_agreement", "amendment"] as const;
/** Every stored kind: template kinds plus "registered" (a third-party or project agreement recorded, not drafted). */
export const STORED_CONTRACT_KINDS = [...CONTRACT_KINDS, "registered"] as const;
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
export type KeyTerms = Partial<Record<"conditionsPrecedent" | "conditionsSubsequent" | "representations" | "covenants" | "reporting" | "deliverables" | "performance" | "insurance" | "security" | "guarantees" | "indemnities" | "liabilityCap" | "liquidatedDamages" | "termination" | "defaults" | "changeControl" | "assignment" | "confidentiality" | "disputeResolution" | "notices" | "paymentTerms", string>>;
export const CONTRACT_STATUSES = ["draft", "sent", "signed", "completed", "terminated"] as const;
export const MILESTONE_STATUSES = ["pending", "invoiced", "paid", "waived"] as const;

export type ContractParty = { name: string; signatoryName: string; signatoryTitle: string; signatoryEmail: string; address: string };
export type ContractTerms = {
  currency: string;
  feeSummary: string;          // plain-language fee terms shown in the contract
  paymentDays: number;         // invoice due, days
  termMonths: number | null;   // null = until the scope is complete
  noticeDays: number;
  autoRenew: boolean;
  governingLaw: string;
  counterparty: ContractParty;
  regenera: Pick<ContractParty, "signatoryName" | "signatoryTitle">;
};

export const contracts = sqliteTable("contracts", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  dealId: text("deal_id"),
  projectId: text("project_id"),            // physical project this row is about (phase 6)
  orgId: text("org_id"),
  kind: text("kind", { enum: STORED_CONTRACT_KINDS }).notNull(),
  engagement: text("engagement"),
  title: text("title").notNull(),
  status: text("status", { enum: CONTRACT_STATUSES }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  body: text("body").notNull(),
  terms: text("terms", { mode: "json" }).$type<ContractTerms>().notNull(),
  value: real("value"),                        // total contracted value, for reports
  // Success fees, equity and capital work need counsel before sending (the site's Important Notice).
  counselRequired: integer("counsel_required", { mode: "boolean" }).notNull().default(false),
  counselReviewedAt: text("counsel_reviewed_at"),
  counselReviewedBy: text("counsel_reviewed_by"),
  sentAt: text("sent_at"),
  signedAt: text("signed_at"),                 // YYYY-MM-DD
  effectiveDate: text("effective_date"),
  endDate: text("end_date"),
  signedCopyUrl: text("signed_copy_url"),      // where the signed PDF lives (Drive, e-sign service)
  // Phase 6 M3: every agreement type, full lifecycle, key terms, locking.
  category: text("category"),                  // lib/contracts/catalog CONTRACT_CATEGORIES key
  contractType: text("contract_type"),
  governingLaw: text("governing_law"),
  forum: text("forum"),
  executionDate: text("execution_date"),
  renewalTerms: text("renewal_terms").notNull().default(""),
  lifecycle: text("lifecycle", { enum: keys(LIFECYCLE) }).notNull().default("draft"),
  keyTerms: text("key_terms", { mode: "json" }).$type<KeyTerms>().notNull().default(sql`'{}'`),
  documentId: text("document_id"),
  parentContractId: text("parent_contract_id"),   // amendments point at what they amend
  lockedAt: text("locked_at"),
  reviewRequired: integer("review_required", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by"),
  ...timestamps,
}, t => [
  index("contracts_mandate_status").on(t.mandateId, t.status),
  index("contracts_deal").on(t.dealId),
  index("contracts_end").on(t.endDate),
]);

export const contractVersions = sqliteTable("contract_versions", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  body: text("body").notNull(),
  terms: text("terms", { mode: "json" }).$type<ContractTerms>().notNull(),
  note: text("note").notNull().default(""),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("contract_versions_unique").on(t.contractId, t.version)]);

export const contractMilestones = sqliteTable("contract_milestones", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  title: text("title").notNull(),
  dueDate: text("due_date"),
  amount: real("amount"),
  currency: text("currency").notNull().default("USD"),
  status: text("status", { enum: MILESTONE_STATUSES }).notNull().default("pending"),
  invoicedAt: text("invoiced_at"),
  paidAt: text("paid_at"),
  ...timestamps,
}, t => [index("contract_milestones_due").on(t.mandateId, t.status, t.dueDate)]);

export const contractParties = sqliteTable("contract_parties", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),
  contactId: text("contact_id"),
  name: text("name").notNull(),
  role: text("role", { enum: ["party", "counterparty", "guarantor", "agent", "beneficiary", "signatory", "key_contact"] }).notNull(),
  ...timestamps,
}, t => [index("contract_parties_contract").on(t.contractId), index("contract_parties_org").on(t.orgId)]);

/** What each party must do, by when, with evidence and the clause it comes from. */
export const contractObligations = sqliteTable("contract_obligations", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  responsibleParty: text("responsible_party").notNull(),       // e.g. "Sponsor", "Regenera", "EPC"
  obligation: text("obligation").notNull(),
  category: text("category", { enum: keys(OBLIGATION_CATEGORIES) }).notNull().default("other"),
  dueDate: text("due_date"),
  recurrence: text("recurrence", { enum: keys(RECURRENCE) }).notNull().default("none"),
  evidenceRequired: text("evidence_required").notNull().default(""),
  owner: text("owner"),
  status: text("status", { enum: keys(OBLIGATION_STATUSES) }).notNull().default("open"),
  completedAt: text("completed_at"),
  completionEvidence: text("completion_evidence").notNull().default(""),
  sourceClause: text("source_clause").notNull().default(""),
  riskIfMissed: text("risk_if_missed").notNull().default(""),
  ...timestamps,
}, t => [index("contract_obligations_due").on(t.mandateId, t.status, t.dueDate), index("contract_obligations_contract").on(t.contractId)]);

/** A registry entry, not a copy: storage is a link (Drive, data room) or an R2 key once R2 is enabled. */
export const documents = sqliteTable("documents", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  title: text("title").notNull(),
  category: text("category", { enum: keys(DOCUMENT_CATEGORIES) }).notNull(),
  version: text("version").notNull().default("1"),
  status: text("status", { enum: keys(DOCUMENT_STATUSES) }).notNull().default("draft"),
  confidentiality: text("confidentiality", { enum: keys(CONFIDENTIALITY) }).notNull().default("confidential"),
  owner: text("owner"),
  projectId: text("project_id"),
  counterpartyOrgId: text("counterparty_org_id"),
  approval: text("approval").notNull().default(""),
  effectiveDate: text("effective_date"),
  expiryDate: text("expiry_date"),
  url: text("url"),
  r2Key: text("r2_key"),
  supersedesId: text("supersedes_id"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("documents_project").on(t.projectId), index("documents_mandate").on(t.mandateId, t.category)]);

export const documentLinks = sqliteTable("document_links", {
  id: id(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  entity: text("entity").notNull(),        // "contract", "project", "capital_opportunity", "organization" …
  entityId: text("entity_id").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("document_links_unique").on(t.documentId, t.entity, t.entityId), index("document_links_entity").on(t.entity, t.entityId)]);
