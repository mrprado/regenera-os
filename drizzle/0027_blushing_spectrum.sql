CREATE TABLE `fin_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`path` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`reason` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fin_changes_model` ON `fin_changes` (`model_id`,`at`);--> statement-breakpoint
CREATE TABLE `fin_models` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`template` text DEFAULT 'custom' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`parent_id` text,
	`case_type` text DEFAULT 'screening' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`financeability` text DEFAULT 'screening' NOT NULL,
	`definition` text NOT NULL,
	`summary` text DEFAULT '{}' NOT NULL,
	`health` text DEFAULT 'REVIEW' NOT NULL,
	`prepared_by` text,
	`reviewed_by` text,
	`approved_by` text,
	`approved_at` text,
	`locked_at` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fin_models_project` ON `fin_models` (`project_id`,`version`);