CREATE TABLE `account_qualifications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`audience` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`dimensions` text DEFAULT '{}' NOT NULL,
	`rubric_version` text NOT NULL,
	`criteria` text DEFAULT '[]' NOT NULL,
	`who` text DEFAULT '' NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`why_now` text DEFAULT '' NOT NULL,
	`entry_offer` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`disqualify_reason` text,
	`first_run_id` text,
	`last_run_id` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`history` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_qualifications_org` ON `account_qualifications` (`mandate_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `account_qualifications_status` ON `account_qualifications` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `scan_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`section` text NOT NULL,
	`audience` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_presets_mandate_key` ON `scan_presets` (`mandate_id`,`key`);--> statement-breakpoint
CREATE TABLE `scan_results` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`run_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`outcome` text NOT NULL,
	`match` text NOT NULL,
	`criteria` text DEFAULT '[]' NOT NULL,
	`missing` text DEFAULT '[]' NOT NULL,
	`exclusion_reason` text,
	`provider` text NOT NULL,
	`source_url` text,
	`retrieved_at` text NOT NULL,
	`identity_conflicts` text DEFAULT '[]' NOT NULL,
	`review` text DEFAULT 'needs_review' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_results_run_entity` ON `scan_results` (`run_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `scan_results_mandate_entity` ON `scan_results` (`mandate_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`preset_id` text,
	`preset_name` text DEFAULT '' NOT NULL,
	`section` text NOT NULL,
	`audience` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stages` text DEFAULT '[]' NOT NULL,
	`providers` text DEFAULT '[]' NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`credit_ceiling` integer DEFAULT 0 NOT NULL,
	`checkpoint` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text NOT NULL,
	`fallback_accepted` integer DEFAULT false NOT NULL,
	`error` text,
	`retry_guidance` text,
	`requested_by` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_runs_idempotency` ON `scan_runs` (`mandate_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `scan_runs_mandate_status` ON `scan_runs` (`mandate_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `test_record` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `deals` ADD `test_record` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `roles` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `test_record` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `replies` ADD `test_record` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `workstream` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `test_record` integer DEFAULT false NOT NULL;