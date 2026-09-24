// Contracts per engagement (docs/plans/phase-5.md part E). Templates are starting points for counsel, not legal
// advice. Payments are tracked only: no payment processing, and no investor money ever touches Regenera.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const CONTRACT_KINDS = ["engagement_letter", "sow", "nda", "referral_agreement", "amendment"] as const;
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
  orgId: text("org_id"),
  kind: text("kind", { enum: CONTRACT_KINDS }).notNull(),
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
