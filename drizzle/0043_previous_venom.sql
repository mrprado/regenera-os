CREATE TABLE `data_providers` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tier` integer NOT NULL,
	`license_reviewed_by` text,
	`license_reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dataset_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`status` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`new_records` integer DEFAULT 0 NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `dataset_sync_jobs_dataset` ON `dataset_sync_jobs` (`dataset_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`platform` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`record` text NOT NULL,
	`connection` text DEFAULT 'not_connected' NOT NULL,
	`resolved_ref` text,
	`provider_updated_at` text,
	`last_synced_at` text,
	`last_success_at` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`schema_hash` text,
	`deprecated` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `datasets_provider` ON `datasets` (`provider`,`platform`);--> statement-breakpoint
CREATE TABLE `project_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`subject_type` text DEFAULT 'project' NOT NULL,
	`subject_id` text,
	`attribute` text NOT NULL,
	`claim` text NOT NULL,
	`source` text NOT NULL,
	`methodology` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`dataset_id` text,
	`scope` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'unknown' NOT NULL,
	`verification` text DEFAULT 'unverified' NOT NULL,
	`verifier` text,
	`claim_date` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_attributes_project` ON `project_attributes` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_attributes_subject` ON `project_attributes` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `project_dataset_links` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`role` text DEFAULT 'screening' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_dataset_links_pair` ON `project_dataset_links` (`project_id`,`dataset_id`);--> statement-breakpoint
CREATE TABLE `project_screening_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`flag` text NOT NULL,
	`observed` text NOT NULL,
	`implication` text DEFAULT '' NOT NULL,
	`diligence` text DEFAULT '' NOT NULL,
	`dataset_id` text,
	`value` text,
	`evidence_level` integer DEFAULT 1 NOT NULL,
	`confidence` text DEFAULT 'screening' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reviewed_by` text,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_screening_flags_key` ON `project_screening_flags` (`project_id`,`flag`);--> statement-breakpoint
CREATE INDEX `project_screening_flags_project` ON `project_screening_flags` (`project_id`);