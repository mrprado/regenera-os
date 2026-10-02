CREATE TABLE `account_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`role` text NOT NULL,
	`contact_id` text,
	`relationship_owner` text,
	`last_interaction_at` text,
	`next_action` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_coverage_org_role` ON `account_coverage` (`mandate_id`,`org_id`,`role`);--> statement-breakpoint
CREATE TABLE `attributions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`campaign` text,
	`scan_run_id` text,
	`introducer_org_id` text,
	`introducer_contact_id` text,
	`note` text DEFAULT '' NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attributions_entity` ON `attributions` (`mandate_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `attributions_campaign` ON `attributions` (`mandate_id`,`campaign`);--> statement-breakpoint
CREATE TABLE `effort_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`campaign` text,
	`deal_id` text,
	`minutes` integer NOT NULL,
	`on` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `effort_entries_campaign` ON `effort_entries` (`mandate_id`,`campaign`);--> statement-breakpoint
CREATE TABLE `meeting_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`deal_id` text,
	`brief_id` text,
	`title` text NOT NULL,
	`held_on` text NOT NULL,
	`participants` text DEFAULT '' NOT NULL,
	`notes` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_notes_org` ON `meeting_notes` (`mandate_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `meeting_notes_deal` ON `meeting_notes` (`mandate_id`,`deal_id`);--> statement-breakpoint
CREATE TABLE `objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`owner` text,
	`beneficiary` text DEFAULT '' NOT NULL,
	`desired_outcome` text DEFAULT '' NOT NULL,
	`target_audience` text,
	`offer_key` text,
	`geography` text DEFAULT '[]' NOT NULL,
	`sector` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`commercial` text DEFAULT '[]' NOT NULL,
	`size_min` real,
	`size_max` real,
	`size_unit` text,
	`stages` text DEFAULT '[]' NOT NULL,
	`timing` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '[]' NOT NULL,
	`required_evidence` text DEFAULT '' NOT NULL,
	`deliverable` text DEFAULT '' NOT NULL,
	`success_measure` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	`deal_id` text,
	`project_id` text,
	`commercial_mandate_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `objectives_mandate_org` ON `objectives` (`mandate_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `objectives_status` ON `objectives` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `opportunity_qualifications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`deal_id` text NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`offer_key` text,
	`decision` text DEFAULT 'open' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`reason` text,
	`history` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_qualifications_deal` ON `opportunity_qualifications` (`mandate_id`,`deal_id`);--> statement-breakpoint
CREATE TABLE `party_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`role` text NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`coverage` text DEFAULT '[]' NOT NULL,
	`coverage_basis` text DEFAULT 'unknown' NOT NULL,
	`owner` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_profiles_org_role` ON `party_profiles` (`mandate_id`,`org_id`,`role`);--> statement-breakpoint
CREATE TABLE `relationship_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`origin` text DEFAULT 'manual' NOT NULL,
	`raised_by` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `relationship_reviews_org` ON `relationship_reviews` (`mandate_id`,`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `site_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`deal_id` text,
	`title` text NOT NULL,
	`template` text NOT NULL,
	`boundary` text,
	`crs` text DEFAULT 'EPSG:4326' NOT NULL,
	`center_lat` real NOT NULL,
	`center_lng` real NOT NULL,
	`zoom` integer DEFAULT 14 NOT NULL,
	`rings` text DEFAULT '[]' NOT NULL,
	`location_accuracy` text DEFAULT 'point' NOT NULL,
	`layers` text DEFAULT '[]' NOT NULL,
	`scenarios` text DEFAULT '[]' NOT NULL,
	`annotations` text DEFAULT '[]' NOT NULL,
	`assumptions` text DEFAULT '' NOT NULL,
	`decision_id` text,
	`author` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`previous_id` text,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_briefs_project` ON `site_briefs` (`mandate_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `site_briefs_deal` ON `site_briefs` (`mandate_id`,`deal_id`);--> statement-breakpoint
ALTER TABLE `organizations` ADD `owner_email` text;--> statement-breakpoint
ALTER TABLE `scan_results` ADD `confidence` text;--> statement-breakpoint
ALTER TABLE `scan_results` ADD `caveats` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_results` ADD `next_action` text;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `objective_id` text;