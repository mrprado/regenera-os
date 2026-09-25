CREATE TABLE `capital_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`purpose` text NOT NULL,
	`stage` text,
	`instrument` text NOT NULL,
	`target` real,
	`minimum` real,
	`maximum` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`target_close` text,
	`use_of_funds` text DEFAULT '' NOT NULL,
	`economics` text DEFAULT '' NOT NULL,
	`term` text DEFAULT '' NOT NULL,
	`security` text DEFAULT '' NOT NULL,
	`seniority` text DEFAULT '' NOT NULL,
	`repayment` text DEFAULT '' NOT NULL,
	`exit_refinance` text DEFAULT '' NOT NULL,
	`regulatory_status` text DEFAULT 'Not reviewed' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`secured` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capital_requirements_project` ON `capital_requirements` (`project_id`);--> statement-breakpoint
CREATE TABLE `capital_tranches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`instrument` text NOT NULL,
	`target` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`min_participation` real,
	`max_participation` real,
	`economics` text DEFAULT '' NOT NULL,
	`seniority` text DEFAULT '' NOT NULL,
	`security` text DEFAULT '' NOT NULL,
	`eligibility` text DEFAULT '' NOT NULL,
	`target_investor_type` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requirement_id`) REFERENCES `capital_requirements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capital_tranches_requirement` ON `capital_tranches` (`requirement_id`);--> statement-breakpoint
CREATE TABLE `constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`owner` text,
	`resolution_action` text DEFAULT '' NOT NULL,
	`deadline` text,
	`depends_on` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `constraints_project` ON `constraints` (`project_id`);--> statement-breakpoint
CREATE INDEX `constraints_mandate_open` ON `constraints` (`mandate_id`,`status`,`severity`);--> statement-breakpoint
CREATE TABLE `project_parties` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`contact_id` text,
	`role` text NOT NULL,
	`confirmed` text DEFAULT 'proposed' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_parties_project` ON `project_parties` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_parties_org` ON `project_parties` (`org_id`);--> statement-breakpoint
CREATE TABLE `project_readiness` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`dimension` text NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`owner` text,
	`updated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_readiness_unique` ON `project_readiness` (`project_id`,`dimension`);--> statement-breakpoint
CREATE TABLE `project_stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_stage_history_project` ON `project_stage_history` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`asset_class` text,
	`sector` text,
	`subsector` text,
	`technology` text,
	`capacity` real,
	`capacity_unit` text,
	`capex` real,
	`currency` text,
	`stage` text DEFAULT 'opportunity' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`regenera_role` text,
	`origination_source` text,
	`country` text,
	`subdivision` text,
	`municipality` text,
	`lat` real,
	`lng` real,
	`geometry` text,
	`owner_email` text,
	`systems` text DEFAULT '[]' NOT NULL,
	`field_sources` text DEFAULT '{}' NOT NULL,
	`stage_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_mandate_stage` ON `projects` (`mandate_id`,`stage`);--> statement-breakpoint
CREATE INDEX `projects_country` ON `projects` (`country`);--> statement-breakpoint
ALTER TABLE `deals` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `triggers` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `funding_matches` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `project_id` text;