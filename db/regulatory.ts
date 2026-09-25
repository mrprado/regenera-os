// Regulatory engine data (docs/plans/phase-6.md M4). Requirements, permits and reviews record who concluded what,
// when, on what evidence. KYC holds statuses and provider references only, never identity documents.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  JURISDICTION_ROLES, KYC_CHECKS, KYC_STATUSES, PERMIT_STATUSES, REGULATION_DOMAINS, REQUIREMENT_STATUSES, REVIEW_CONCLUSIONS, REVIEW_SUBJECTS, REVIEW_TOPICS, TRACKS,
} from "../lib/regulatory/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const projectJurisdictions = sqliteTable("project_jurisdictions", {
  id: id(),
  projectId: text("project_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  role: text("role", { enum: keys(JURISDICTION_ROLES) }).notNull(),
  jurisdiction: text("jurisdiction").notNull(),       // ISO 3166-1 alpha-2 or 3166-2 (e.g. MX, MX-YUC)
  note: text("note").notNull().default(""),
  ...timestamps,
}, t => [uniqueIndex("project_jurisdictions_unique").on(t.projectId, t.role, t.jurisdiction)]);

export const requirements = sqliteTable("requirements", {
  id: id(),
  projectId: text("project_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  track: text("track", { enum: keys(TRACKS) }).notNull().default("host_law"),
  domain: text("domain", { enum: keys(REGULATION_DOMAINS) }).notNull(),
  title: text("title").notNull(),
  standard: text("standard"),                 // for lender standards: which checklist (ifc_ps, wb_esf, equator …)
  jurisdiction: text("jurisdiction"),
  authority: text("authority").notNull().default(""),
  status: text("status", { enum: keys(REQUIREMENT_STATUSES) }).notNull().default("unknown"),
  source: text("source").notNull().default(""),   // citation or URL of the rule
  sourceTier: integer("source_tier"),             // 1–5 (master spec LXV)
  owner: text("owner"),
  reviewer: text("reviewer"),
  reviewedAt: text("reviewed_at"),
  evidence: text("evidence").notNull().default(""),
  nextVerification: text("next_verification"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("requirements_project").on(t.projectId, t.track, t.domain), index("requirements_verify").on(t.mandateId, t.nextVerification)]);

export const permits = sqliteTable("permits", {
  id: id(),
  projectId: text("project_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  requirementId: text("requirement_id"),
  name: text("name").notNull(),
  authority: text("authority").notNull().default(""),
  jurisdiction: text("jurisdiction"),
  reference: text("reference").notNull().default(""),
  status: text("status", { enum: keys(PERMIT_STATUSES) }).notNull().default("not_started"),
  submittedAt: text("submitted_at"),
  approvedAt: text("approved_at"),
  expiresAt: text("expires_at"),
  conditions: text("conditions").notNull().default(""),
  owner: text("owner"),
  documentId: text("document_id"),
  ...timestamps,
}, t => [index("permits_project").on(t.projectId), index("permits_expiry").on(t.mandateId, t.expiresAt)]);

/** Any conclusion about any record: reviewer, role, evidence, conditions, validity. Never a bare "compliant". */
export const regulatoryReviews = sqliteTable("regulatory_reviews", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  subjectType: text("subject_type", { enum: keys(REVIEW_SUBJECTS) }).notNull(),
  subjectId: text("subject_id").notNull(),
  topic: text("topic", { enum: keys(REVIEW_TOPICS) }).notNull(),
  jurisdiction: text("jurisdiction"),
  conclusion: text("conclusion", { enum: keys(REVIEW_CONCLUSIONS) }).notNull(),
  conditions: text("conditions").notNull().default(""),
  reviewer: text("reviewer").notNull(),
  reviewerRole: text("reviewer_role").notNull(),
  reviewedAt: text("reviewed_at").notNull(),
  evidence: text("evidence").notNull(),
  validUntil: text("valid_until"),
  recordedBy: text("recorded_by"),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("regulatory_reviews_subject").on(t.subjectType, t.subjectId)]);

export const kycChecks = sqliteTable("kyc_checks", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  contactId: text("contact_id"),
  orgId: text("org_id"),
  checkType: text("check_type", { enum: keys(KYC_CHECKS) }).notNull(),
  provider: text("provider").notNull().default(""),
  status: text("status", { enum: keys(KYC_STATUSES) }).notNull().default("not_started"),
  providerRef: text("provider_ref").notNull().default(""),
  checkedAt: text("checked_at"),
  expiresAt: text("expires_at"),
  ...timestamps,
}, t => [index("kyc_checks_contact").on(t.contactId), index("kyc_checks_org").on(t.orgId)]);
