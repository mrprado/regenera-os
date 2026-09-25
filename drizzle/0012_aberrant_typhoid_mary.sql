CREATE TABLE `contract_obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`responsible_party` text NOT NULL,
	`obligation` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`due_date` text,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`evidence_required` text DEFAULT '' NOT NULL,
	`owner` text,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`completion_evidence` text DEFAULT '' NOT NULL,
	`source_clause` text DEFAULT '' NOT NULL,
	`risk_if_missed` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contract_obligations_due` ON `contract_obligations` (`mandate_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `contract_obligations_contract` ON `contract_obligations` (`contract_id`);--> statement-breakpoint
CREATE TABLE `contract_parties` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`contact_id` text,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contract_parties_contract` ON `contract_parties` (`contract_id`);--> statement-breakpoint
CREATE INDEX `contract_parties_org` ON `contract_parties` (`org_id`);--> statement-breakpoint
CREATE TABLE `document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_unique` ON `document_links` (`document_id`,`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `document_links_entity` ON `document_links` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`version` text DEFAULT '1' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`confidentiality` text DEFAULT 'confidential' NOT NULL,
	`owner` text,
	`project_id` text,
	`counterparty_org_id` text,
	`approval` text DEFAULT '' NOT NULL,
	`effective_date` text,
	`expiry_date` text,
	`url` text,
	`r2_key` text,
	`supersedes_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_project` ON `documents` (`project_id`);--> statement-breakpoint
CREATE INDEX `documents_mandate` ON `documents` (`mandate_id`,`category`);--> statement-breakpoint
ALTER TABLE `contracts` ADD `category` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `contract_type` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `governing_law` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `forum` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `execution_date` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `renewal_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `contracts` ADD `lifecycle` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `contracts` ADD `key_terms` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `contracts` ADD `document_id` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `parent_contract_id` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `locked_at` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `review_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `contracts` SET `lifecycle` = CASE `status` WHEN 'sent' THEN 'signature' WHEN 'signed' THEN 'active' WHEN 'completed' THEN 'expired' WHEN 'terminated' THEN 'terminated' ELSE 'draft' END, `locked_at` = CASE WHEN `status` IN ('signed', 'completed', 'terminated') THEN `updated_at` ELSE NULL END;
