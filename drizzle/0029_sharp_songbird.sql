CREATE TABLE `capital_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`system` text NOT NULL,
	`project_id` text,
	`sector` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`year` text,
	`alignment` text DEFAULT 'unclassified' NOT NULL,
	`alignment_basis` text DEFAULT '' NOT NULL,
	`redirectable` text DEFAULT 'unknown' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capital_flows_system` ON `capital_flows` (`mandate_id`,`system`);--> statement-breakpoint
CREATE TABLE `incentives` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`country` text NOT NULL,
	`subdivision` text,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`mechanism` text NOT NULL,
	`policy_ref` text DEFAULT '' NOT NULL,
	`beneficiary` text DEFAULT '' NOT NULL,
	`economic_effect` text DEFAULT '' NOT NULL,
	`environmental_evidence` text DEFAULT '' NOT NULL,
	`annual_value` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`classification` text DEFAULT 'unclassified' NOT NULL,
	`classified_by` text,
	`source_url` text,
	`as_of` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `incentives_country` ON `incentives` (`country`,`sector`);--> statement-breakpoint
CREATE TABLE `nature_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`subject_type` text DEFAULT 'project' NOT NULL,
	`project_id` text,
	`org_id` text,
	`capital_amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`alignment` text DEFAULT 'unclassified' NOT NULL,
	`alignment_basis` text DEFAULT '' NOT NULL,
	`classified_by` text,
	`classified_at` text,
	`dependencies` text DEFAULT '[]' NOT NULL,
	`impacts` text DEFAULT '[]' NOT NULL,
	`drivers` text DEFAULT '[]' NOT NULL,
	`pathways` text DEFAULT '[]' NOT NULL,
	`site_baseline` text,
	`summary` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nature_assessments_project` ON `nature_assessments` (`project_id`);--> statement-breakpoint
CREATE INDEX `nature_assessments_mandate` ON `nature_assessments` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `nature_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`name` text NOT NULL,
	`configuration` text DEFAULT '' NOT NULL,
	`fin_model_id` text,
	`capex` real,
	`irr_pct` real,
	`habitat_loss_ha` real,
	`restoration_ha` real,
	`water_demand_m3` real,
	`nature_risk` text DEFAULT 'unknown' NOT NULL,
	`mitigation_cost` real,
	`restoration_cost` real,
	`transition_cost` real,
	`environmental_liability` real,
	`natural_capital_revenue` real,
	`avoided_risk` real,
	`methodology` text DEFAULT '' NOT NULL,
	`finance` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nature_scenarios_assessment` ON `nature_scenarios` (`assessment_id`);