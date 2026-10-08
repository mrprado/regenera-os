CREATE TABLE `impact_records` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`indicator` text NOT NULL,
	`kind` text NOT NULL,
	`value` real,
	`unit` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`method` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`verified_by` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `impact_records_project` ON `impact_records` (`project_id`,`indicator`);--> statement-breakpoint
CREATE TABLE `integrity_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`kind` text NOT NULL,
	`domain` text NOT NULL,
	`text` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `integrity_findings_project` ON `integrity_findings` (`project_id`,`decision_id`);--> statement-breakpoint
CREATE TABLE `origination_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`rules` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`published_by` text NOT NULL,
	`published_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `origination_policies_version` ON `origination_policies` (`version`);--> statement-breakpoint
CREATE TABLE `policy_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`policy_version` integer NOT NULL,
	`classification` text NOT NULL,
	`state` text NOT NULL,
	`readings` text NOT NULL,
	`rules` text NOT NULL,
	`confidence` text NOT NULL,
	`outstanding` text NOT NULL,
	`remediation` text NOT NULL,
	`decided_by` text NOT NULL,
	`next_review_at` text,
	`current` integer DEFAULT true NOT NULL,
	`overrides` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `policy_decisions_project` ON `policy_decisions` (`project_id`,`current`);--> statement-breakpoint
CREATE INDEX `policy_decisions_state` ON `policy_decisions` (`state`,`current`);--> statement-breakpoint
CREATE TABLE `redesign_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`variant` text NOT NULL,
	`options` text NOT NULL,
	`comparison` text NOT NULL,
	`assumptions` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`decided_by` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `redesign_scenarios_project` ON `redesign_scenarios` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `stewardship_obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`due_at` text,
	`recurrence_months` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`owner` text,
	`indicator` text,
	`evidence` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stewardship_due` ON `stewardship_obligations` (`status`,`due_at`);--> statement-breakpoint
ALTER TABLE `capital_profiles` ADD `impact_criteria` text;--> statement-breakpoint
ALTER TABLE `capital_profiles` ADD `investor_status` text;