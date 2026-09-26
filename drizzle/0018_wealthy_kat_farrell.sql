CREATE TABLE `broker_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`portal_user_id` text NOT NULL,
	`org_id` text,
	`role_type` text DEFAULT 'referral_partner' NOT NULL,
	`jurisdictions` text DEFAULT '[]' NOT NULL,
	`license_status` text DEFAULT 'none' NOT NULL,
	`registration_numbers` text DEFAULT '' NOT NULL,
	`license_evidence` text DEFAULT '' NOT NULL,
	`specialties` text DEFAULT '' NOT NULL,
	`geographies` text DEFAULT '' NOT NULL,
	`relationship_owner` text,
	`agreement_status` text DEFAULT 'none' NOT NULL,
	`agreement_expires_at` text,
	`compliance_status` text DEFAULT 'applied' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broker_profiles_portal_user_id_unique` ON `broker_profiles` (`portal_user_id`);--> statement-breakpoint
CREATE TABLE `commission_events` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`broker_id` text NOT NULL,
	`schedule_id` text,
	`registration_id` text,
	`deal_id` text,
	`basis_amount` real,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'estimated' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`approved_by` text,
	`paid_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`broker_id`) REFERENCES `broker_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `commission_events_broker` ON `commission_events` (`broker_id`,`status`);--> statement-breakpoint
CREATE TABLE `commission_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_id` text NOT NULL,
	`type` text NOT NULL,
	`rate` real,
	`amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`cap` real,
	`minimum` real,
	`calculation_basis` text DEFAULT '' NOT NULL,
	`eligibility_conditions` text DEFAULT '' NOT NULL,
	`payment_trigger` text DEFAULT '' NOT NULL,
	`approval_status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`agreement_id`) REFERENCES `referral_agreements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `data_room_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`data_room_id` text NOT NULL,
	`document_id` text NOT NULL,
	`folder` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`data_room_id`) REFERENCES `data_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_room_documents_unique` ON `data_room_documents` (`data_room_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `data_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`project_id` text,
	`deal_id` text,
	`audience` text DEFAULT 'capital' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`nda_required` integer DEFAULT true NOT NULL,
	`nda_text` text DEFAULT '' NOT NULL,
	`nda_version` integer DEFAULT 1 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `data_rooms_project` ON `data_rooms` (`project_id`);--> statement-breakpoint
CREATE TABLE `distribution_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`document_id` text NOT NULL,
	`audience` text NOT NULL,
	`jurisdictions` text DEFAULT '[]' NOT NULL,
	`securities_related` integer DEFAULT false NOT NULL,
	`valid_from` text,
	`valid_until` text,
	`compliance_status` text DEFAULT 'pending' NOT NULL,
	`approved_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `distribution_approvals_document` ON `distribution_approvals` (`document_id`,`audience`);--> statement-breakpoint
CREATE TABLE `document_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`portal_user_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`folder` text,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`response_note` text DEFAULT '' NOT NULL,
	`response_url` text,
	`document_id` text,
	`responded_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `document_requests_project` ON `document_requests` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `document_requests_user` ON `document_requests` (`portal_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `intake_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`organization` text DEFAULT '' NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`ip_hash` text,
	`converted_type` text,
	`converted_id` text,
	`reviewed_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `intake_submissions_status` ON `intake_submissions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `intake_submissions_ip` ON `intake_submissions` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `nda_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`data_room_id` text NOT NULL,
	`portal_user_id` text NOT NULL,
	`nda_version` integer NOT NULL,
	`name` text NOT NULL,
	`ip` text,
	`accepted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`data_room_id`) REFERENCES `data_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nda_acceptances_unique` ON `nda_acceptances` (`data_room_id`,`portal_user_id`,`nda_version`);--> statement-breakpoint
CREATE TABLE `portal_access_log` (
	`id` text PRIMARY KEY NOT NULL,
	`portal_user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`allowed` integer DEFAULT true NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`ip` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_access_log_user` ON `portal_access_log` (`portal_user_id`,`at`);--> statement-breakpoint
CREATE INDEX `portal_access_log_entity` ON `portal_access_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `portal_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`portal_user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`can_download` integer DEFAULT false NOT NULL,
	`granted_by` text NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`portal_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portal_grants_user` ON `portal_grants` (`portal_user_id`,`entity_type`);--> statement-breakpoint
CREATE INDEX `portal_grants_entity` ON `portal_grants` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `portal_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`portal_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`portal_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_invites_token_hash_unique` ON `portal_invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `portal_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`portal_user_id` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`author` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`portal_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portal_messages_user` ON `portal_messages` (`portal_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `portal_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`portal_user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`portal_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `portal_users` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`org_id` text,
	`contact_id` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`password_hash` text,
	`invited_by` text,
	`last_login_at` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_users_email` ON `portal_users` (`email`);--> statement-breakpoint
CREATE INDEX `portal_users_mandate` ON `portal_users` (`mandate_id`,`kind`);--> statement-breakpoint
CREATE TABLE `project_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audiences` text DEFAULT '[]' NOT NULL,
	`approved_by` text,
	`published_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_updates_project` ON `project_updates` (`project_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `referral_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`broker_id` text NOT NULL,
	`contract_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`legal_review_status` text DEFAULT 'pending' NOT NULL,
	`effective_date` text,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`broker_id`) REFERENCES `broker_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `referral_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`broker_id` text NOT NULL,
	`target_type` text NOT NULL,
	`name` text NOT NULL,
	`organization` text DEFAULT '' NOT NULL,
	`contact_email` text,
	`jurisdiction` text,
	`relationship` text DEFAULT '' NOT NULL,
	`intended_introduction` text DEFAULT '' NOT NULL,
	`project_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`conflicts` text DEFAULT '[]' NOT NULL,
	`matched_org_id` text,
	`matched_contact_id` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`broker_id`) REFERENCES `broker_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `referral_registrations_broker` ON `referral_registrations` (`broker_id`,`status`);--> statement-breakpoint
CREATE INDEX `referral_registrations_mandate` ON `referral_registrations` (`mandate_id`,`status`);