CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`options` text DEFAULT '' NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decisions_project` ON `decisions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `design_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`stage` text NOT NULL,
	`discipline` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`engineer` text,
	`issued_at` text,
	`approved_by` text,
	`document_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_packages_project` ON `design_packages` (`project_id`);--> statement-breakpoint
CREATE TABLE `engineering_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`discipline` text NOT NULL,
	`standard` text NOT NULL,
	`version` text DEFAULT '' NOT NULL,
	`jurisdiction` text,
	`authority` text,
	`source` text DEFAULT '' NOT NULL,
	`effective_date` text,
	`last_verified` text,
	`reviewer` text,
	`status` text DEFAULT 'identified' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `engineering_requirements_project` ON `engineering_requirements` (`project_id`);--> statement-breakpoint
CREATE TABLE `es_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`topic` text NOT NULL,
	`framework` text DEFAULT 'host_law' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`mitigation_step` text DEFAULT 'none' NOT NULL,
	`mitigation` text DEFAULT '' NOT NULL,
	`owner` text,
	`due_date` text,
	`evidence` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'identified' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `es_issues_project` ON `es_issues` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`type` text NOT NULL,
	`phase` text DEFAULT 'construction' NOT NULL,
	`status` text DEFAULT 'required' NOT NULL,
	`insurer` text,
	`broker` text,
	`coverage_limit` real,
	`deductible` real,
	`premium` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`starts_at` text,
	`expires_at` text,
	`lender_requirement` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insurance_project` ON `insurance_policies` (`project_id`);--> statement-breakpoint
CREATE INDEX `insurance_expiry` ON `insurance_policies` (`mandate_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `project_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`duration_days` integer DEFAULT 0 NOT NULL,
	`due_date` text,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`completed_at` text,
	`owner` text,
	`evidence` text DEFAULT '' NOT NULL,
	`contract_id` text,
	`obligation_id` text,
	`constraint_id` text,
	`is_target` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_milestones_project` ON `project_milestones` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_milestones_due` ON `project_milestones` (`mandate_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `studies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`provider_org_id` text,
	`provider` text,
	`cost` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`due_date` text,
	`completed_at` text,
	`findings` text DEFAULT '' NOT NULL,
	`reviewer` text,
	`reviewed_at` text,
	`document_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `studies_project` ON `studies` (`project_id`,`type`);--> statement-breakpoint
CREATE TABLE `economic_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'base' NOT NULL,
	`base_case_id` text,
	`inputs` text NOT NULL,
	`outputs` text,
	`source` text DEFAULT '' NOT NULL,
	`prepared_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `economic_cases_project` ON `economic_cases` (`project_id`);--> statement-breakpoint
CREATE TABLE `revenue_streams` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`mechanism` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`counterparty_org_id` text,
	`counterparty` text,
	`contract_id` text,
	`unit_price` real,
	`unit` text,
	`annual_volume` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`escalation_pct` real,
	`indexation` text DEFAULT '' NOT NULL,
	`tenor_years` real,
	`counterparty_credit` text DEFAULT '' NOT NULL,
	`payment_security` text DEFAULT '' NOT NULL,
	`termination` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'indicative' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revenue_streams_project` ON `revenue_streams` (`project_id`);