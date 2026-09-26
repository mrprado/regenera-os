CREATE TABLE `playbook_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`playbook_id` text NOT NULL,
	`run_id` text,
	`failure_layer` text NOT NULL,
	`scope` text NOT NULL,
	`description` text NOT NULL,
	`change` text DEFAULT '' NOT NULL,
	`fingerprint` text NOT NULL,
	`proposed_version` integer,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playbook_corrections_playbook` ON `playbook_corrections` (`playbook_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `playbook_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`playbook_id` text NOT NULL,
	`version` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`entity_label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`steps` text NOT NULL,
	`checks` text DEFAULT '[]' NOT NULL,
	`started_by` text NOT NULL,
	`reviewed_by` text,
	`approved_by` text,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playbook_runs_entity` ON `playbook_runs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `playbook_runs_status` ON `playbook_runs` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `playbook_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`playbook_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`change_note` text DEFAULT '' NOT NULL,
	`proposed_by` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playbook_versions_unique` ON `playbook_versions` (`playbook_id`,`version`);--> statement-breakpoint
CREATE TABLE `playbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`entity_type` text DEFAULT 'project' NOT NULL,
	`maturity` text DEFAULT 'draft' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`owner` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playbooks_key` ON `playbooks` (`mandate_id`,`key`);--> statement-breakpoint
CREATE TABLE `claim_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`source_id` text,
	`source_url` text,
	`document_id` text,
	`document_page` text,
	`section` text,
	`excerpt` text DEFAULT '' NOT NULL,
	`retrieved_at` text,
	`source_date` text,
	`raw_hash` text,
	`method` text NOT NULL,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`license` text,
	`added_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_evidence_claim` ON `claim_evidence` (`claim_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`statement` text NOT NULL,
	`claim_type` text DEFAULT 'fact' NOT NULL,
	`field` text,
	`value` text,
	`unit` text,
	`status` text DEFAULT 'unverified' NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`verified_by` text,
	`verified_at` text,
	`superseded_by_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claims_entity` ON `claims` (`entity_type`,`entity_id`,`status`);