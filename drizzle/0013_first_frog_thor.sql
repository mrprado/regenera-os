CREATE TABLE `kyc_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`check_type` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`provider_ref` text DEFAULT '' NOT NULL,
	`checked_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kyc_checks_contact` ON `kyc_checks` (`contact_id`);--> statement-breakpoint
CREATE INDEX `kyc_checks_org` ON `kyc_checks` (`org_id`);--> statement-breakpoint
CREATE TABLE `permits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`requirement_id` text,
	`name` text NOT NULL,
	`authority` text DEFAULT '' NOT NULL,
	`jurisdiction` text,
	`reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`submitted_at` text,
	`approved_at` text,
	`expires_at` text,
	`conditions` text DEFAULT '' NOT NULL,
	`owner` text,
	`document_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `permits_project` ON `permits` (`project_id`);--> statement-breakpoint
CREATE INDEX `permits_expiry` ON `permits` (`mandate_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `project_jurisdictions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`role` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_jurisdictions_unique` ON `project_jurisdictions` (`project_id`,`role`,`jurisdiction`);--> statement-breakpoint
CREATE TABLE `regulatory_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`topic` text NOT NULL,
	`jurisdiction` text,
	`conclusion` text NOT NULL,
	`conditions` text DEFAULT '' NOT NULL,
	`reviewer` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`reviewed_at` text NOT NULL,
	`evidence` text NOT NULL,
	`valid_until` text,
	`recorded_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `regulatory_reviews_subject` ON `regulatory_reviews` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`track` text DEFAULT 'host_law' NOT NULL,
	`domain` text NOT NULL,
	`title` text NOT NULL,
	`standard` text,
	`jurisdiction` text,
	`authority` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`source_tier` integer,
	`owner` text,
	`reviewer` text,
	`reviewed_at` text,
	`evidence` text DEFAULT '' NOT NULL,
	`next_verification` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `requirements_project` ON `requirements` (`project_id`,`track`,`domain`);--> statement-breakpoint
CREATE INDEX `requirements_verify` ON `requirements` (`mandate_id`,`next_verification`);