// External surfaces (master build instruction §02, §26, §31–38, §46, §69): portal users with their own credentials,
// explicit grants (visibility is never inferred from association), messages, document requests, approved updates,
// data rooms with NDA gate and access logs, broker registrations and economics, distribution approvals, public intake.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  AGREEMENT_STATUSES, BROKER_ROLES, BROKER_STATUSES, COMMISSION_STATUSES, COMMISSION_TYPES, DATA_ROOM_FOLDERS, GRANT_ENTITIES, INTAKE_KINDS,
  INTAKE_STATUSES, PORTAL_KINDS, PORTAL_USER_STATUSES, REFERRAL_STATUSES, REFERRAL_TARGETS, REQUEST_STATUSES,
} from "../lib/portal/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const portalUsers = sqliteTable("portal_users", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  kind: text("kind", { enum: keys(PORTAL_KINDS) }).notNull(),
  orgId: text("org_id"),
  contactId: text("contact_id"),
  status: text("status", { enum: keys(PORTAL_USER_STATUSES) }).notNull().default("invited"),
  passwordHash: text("password_hash"),        // PBKDF2-SHA256, "iterations$salt$hash"
  invitedBy: text("invited_by"),
  lastLoginAt: text("last_login_at"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, t => [uniqueIndex("portal_users_email").on(t.email), index("portal_users_mandate").on(t.mandateId, t.kind)]);

export const portalInvites = sqliteTable("portal_invites", {
  id: id(),
  portalUserId: text("portal_user_id").notNull().references(() => portalUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(now),
});

export const portalSessions = sqliteTable("portal_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  portalUserId: text("portal_user_id").notNull().references(() => portalUsers.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(now),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
});

/** Explicit visibility: a portal user sees an entity only through an unexpired, unrevoked grant. */
export const portalGrants = sqliteTable("portal_grants", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  portalUserId: text("portal_user_id").notNull().references(() => portalUsers.id, { onDelete: "cascade" }),
  entityType: text("entity_type", { enum: keys(GRANT_ENTITIES) }).notNull(),
  entityId: text("entity_id").notNull(),
  canDownload: integer("can_download", { mode: "boolean" }).notNull().default(false),
  grantedBy: text("granted_by").notNull(),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("portal_grants_user").on(t.portalUserId, t.entityType), index("portal_grants_entity").on(t.entityType, t.entityId)]);

export const portalAccessLog = sqliteTable("portal_access_log", {
  id: id(),
  portalUserId: text("portal_user_id").notNull(),
  action: text("action").notNull(),            // view, download, denied, signin, nda_accepted …
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  allowed: integer("allowed", { mode: "boolean" }).notNull().default(true),
  reason: text("reason").notNull().default(""),
  ip: text("ip"),
  at: text("at").notNull().default(now),
}, t => [index("portal_access_log_user").on(t.portalUserId, t.at), index("portal_access_log_entity").on(t.entityType, t.entityId)]);

export const portalMessages = sqliteTable("portal_messages", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  portalUserId: text("portal_user_id").notNull().references(() => portalUsers.id, { onDelete: "cascade" }),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  direction: text("direction", { enum: ["in", "out"] }).notNull(),  // in = from the portal user
  body: text("body").notNull(),
  author: text("author").notNull(),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("portal_messages_user").on(t.portalUserId, t.createdAt)]);

export const documentRequests = sqliteTable("document_requests", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  portalUserId: text("portal_user_id"),        // who is asked (sponsor, partner); null = internal
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  folder: text("folder", { enum: keys(DATA_ROOM_FOLDERS) }),
  dueDate: text("due_date"),
  status: text("status", { enum: keys(REQUEST_STATUSES) }).notNull().default("open"),
  responseNote: text("response_note").notNull().default(""),
  responseUrl: text("response_url"),
  documentId: text("document_id"),
  respondedAt: text("responded_at"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("document_requests_project").on(t.projectId, t.status), index("document_requests_user").on(t.portalUserId, t.status)]);

/** Project updates approved for external audiences (internal notes never flow here). */
export const projectUpdates = sqliteTable("project_updates", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audiences: text("audiences", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`), // PORTAL_KINDS keys
  approvedBy: text("approved_by"),
  publishedAt: text("published_at"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("project_updates_project").on(t.projectId, t.publishedAt)]);

export const dataRooms = sqliteTable("data_rooms", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  projectId: text("project_id"),
  dealId: text("deal_id"),
  audience: text("audience", { enum: keys(PORTAL_KINDS) }).notNull().default("capital"),
  status: text("status", { enum: ["draft", "open", "closed"] }).notNull().default("draft"),
  ndaRequired: integer("nda_required", { mode: "boolean" }).notNull().default(true),
  ndaText: text("nda_text").notNull().default(""),
  ndaVersion: integer("nda_version").notNull().default(1),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, t => [index("data_rooms_project").on(t.projectId)]);

export const dataRoomDocuments = sqliteTable("data_room_documents", {
  id: id(),
  dataRoomId: text("data_room_id").notNull().references(() => dataRooms.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull(),
  folder: text("folder", { enum: keys(DATA_ROOM_FOLDERS) }).notNull(),
  addedBy: text("added_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("data_room_documents_unique").on(t.dataRoomId, t.documentId)]);

export const ndaAcceptances = sqliteTable("nda_acceptances", {
  id: id(),
  dataRoomId: text("data_room_id").notNull().references(() => dataRooms.id, { onDelete: "cascade" }),
  portalUserId: text("portal_user_id").notNull(),
  ndaVersion: integer("nda_version").notNull(),
  name: text("name").notNull(),
  ip: text("ip"),
  acceptedAt: text("accepted_at").notNull().default(now),
}, t => [uniqueIndex("nda_acceptances_unique").on(t.dataRoomId, t.portalUserId, t.ndaVersion)]);

/** A document may reach an external audience only under an approval for that audience, jurisdiction and period. */
export const distributionApprovals = sqliteTable("distribution_approvals", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  documentId: text("document_id").notNull(),
  audience: text("audience", { enum: keys(PORTAL_KINDS) }).notNull(),
  jurisdictions: text("jurisdictions", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`), // empty = any
  securitiesRelated: integer("securities_related", { mode: "boolean" }).notNull().default(false),
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  complianceStatus: text("compliance_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  approvedBy: text("approved_by"),
  ...timestamps,
}, t => [index("distribution_approvals_document").on(t.documentId, t.audience)]);

export const brokerProfiles = sqliteTable("broker_profiles", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  portalUserId: text("portal_user_id").notNull().unique(),
  orgId: text("org_id"),
  roleType: text("role_type", { enum: keys(BROKER_ROLES) }).notNull().default("referral_partner"),
  jurisdictions: text("jurisdictions", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  licenseStatus: text("license_status", { enum: ["none", "claimed", "verified", "expired"] }).notNull().default("none"),
  registrationNumbers: text("registration_numbers").notNull().default(""),
  licenseEvidence: text("license_evidence").notNull().default(""),
  specialties: text("specialties").notNull().default(""),
  geographies: text("geographies").notNull().default(""),
  relationshipOwner: text("relationship_owner"),
  agreementStatus: text("agreement_status", { enum: keys(AGREEMENT_STATUSES) }).notNull().default("none"),
  agreementExpiresAt: text("agreement_expires_at"),
  complianceStatus: text("compliance_status", { enum: keys(BROKER_STATUSES) }).notNull().default("applied"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  reviewNote: text("review_note").notNull().default(""),
  ...timestamps,
});

export const referralRegistrations = sqliteTable("referral_registrations", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  brokerId: text("broker_id").notNull().references(() => brokerProfiles.id, { onDelete: "cascade" }),
  targetType: text("target_type", { enum: keys(REFERRAL_TARGETS) }).notNull(),
  name: text("name").notNull(),
  organization: text("organization").notNull().default(""),
  contactEmail: text("contact_email"),
  jurisdiction: text("jurisdiction"),
  relationship: text("relationship").notNull().default(""),
  intendedIntroduction: text("intended_introduction").notNull().default(""),
  projectId: text("project_id"),
  notes: text("notes").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  status: text("status", { enum: keys(REFERRAL_STATUSES) }).notNull().default("submitted"),
  conflicts: text("conflicts", { mode: "json" }).$type<{ kind: string; detail: string }[]>().notNull().default(sql`'[]'`),
  matchedOrgId: text("matched_org_id"),
  matchedContactId: text("matched_contact_id"),
  decisionNote: text("decision_note").notNull().default(""),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  expiresAt: text("expires_at"),
  ...timestamps,
}, t => [index("referral_registrations_broker").on(t.brokerId, t.status), index("referral_registrations_mandate").on(t.mandateId, t.status)]);

export const referralAgreements = sqliteTable("referral_agreements", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  brokerId: text("broker_id").notNull().references(() => brokerProfiles.id, { onDelete: "cascade" }),
  contractId: text("contract_id"),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "active", "expired", "terminated"] }).notNull().default("draft"),
  legalReviewStatus: text("legal_review_status", { enum: ["pending", "approved"] }).notNull().default("pending"),
  effectiveDate: text("effective_date"),
  expiresAt: text("expires_at"),
  ...timestamps,
});

export const commissionSchedules = sqliteTable("commission_schedules", {
  id: id(),
  agreementId: text("agreement_id").notNull().references(() => referralAgreements.id, { onDelete: "cascade" }),
  type: text("type", { enum: keys(COMMISSION_TYPES) }).notNull(),
  rate: real("rate"),             // % for percentage, bps for basis points
  amount: real("amount"),         // fixed or milestone amount
  currency: text("currency").notNull().default("USD"),
  cap: real("cap"),
  minimum: real("minimum"),
  calculationBasis: text("calculation_basis").notNull().default(""),
  eligibilityConditions: text("eligibility_conditions").notNull().default(""),
  paymentTrigger: text("payment_trigger").notNull().default(""),
  approvalStatus: text("approval_status", { enum: ["draft", "approved"] }).notNull().default("draft"),
  ...timestamps,
});

export const commissionEvents = sqliteTable("commission_events", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  brokerId: text("broker_id").notNull().references(() => brokerProfiles.id, { onDelete: "cascade" }),
  scheduleId: text("schedule_id"),
  registrationId: text("registration_id"),
  dealId: text("deal_id"),
  basisAmount: real("basis_amount"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status", { enum: keys(COMMISSION_STATUSES) }).notNull().default("estimated"),
  note: text("note").notNull().default(""),
  approvedBy: text("approved_by"),
  paidAt: text("paid_at"),
  ...timestamps,
}, t => [index("commission_events_broker").on(t.brokerId, t.status)]);

export const intakeSubmissions = sqliteTable("intake_submissions", {
  id: id(),
  kind: text("kind", { enum: keys(INTAKE_KINDS) }).notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  organization: text("organization").notNull().default(""),
  payload: text("payload", { mode: "json" }).$type<Record<string, string>>().notNull(),
  status: text("status", { enum: keys(INTAKE_STATUSES) }).notNull().default("new"),
  ipHash: text("ip_hash"),
  convertedType: text("converted_type"),
  convertedId: text("converted_id"),
  reviewedBy: text("reviewed_by"),
  ...timestamps,
}, t => [index("intake_submissions_status").on(t.status, t.createdAt), index("intake_submissions_ip").on(t.ipHash, t.createdAt)]);
