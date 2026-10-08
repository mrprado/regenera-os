CREATE TABLE `client_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`path` text NOT NULL,
	`kind` text DEFAULT 'error' NOT NULL,
	`message` text NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_errors_created` ON `client_errors` (`created_at`);--> statement-breakpoint
CREATE TABLE `doc_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`document_id` text,
	`file_name` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`result` text,
	`error` text,
	`created_by` text NOT NULL,
	`applied_by` text,
	`applied_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_extractions_mandate` ON `doc_extractions` (`mandate_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `doc_request_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`section` text NOT NULL,
	`item` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`document_id` text,
	`note` text DEFAULT '' NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_request_items_request` ON `doc_request_items` (`request_id`,`position`);--> statement-breakpoint
CREATE TABLE `doc_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`template` text NOT NULL,
	`nda_document_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`due_date` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_requests_mandate` ON `doc_requests` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `protected_parties` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`party_name` text NOT NULL,
	`org_id` text,
	`protected_for` text NOT NULL,
	`agreement_document_id` text,
	`until` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `protected_parties_mandate` ON `protected_parties` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `registry_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`source` text NOT NULL,
	`company_number` text NOT NULL,
	`data` text NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `registry_snapshots_org` ON `registry_snapshots` (`org_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `regulated_products` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `regulated_products_mandate` ON `regulated_products` (`mandate_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `location_precision` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `location_source` text;--> statement-breakpoint
ALTER TABLE `capital_profiles` ADD `lane` text;--> statement-breakpoint
ALTER TABLE `capital_profiles` ADD `preference` text;--> statement-breakpoint
ALTER TABLE `capital_profiles` ADD `ticket_band` text;--> statement-breakpoint
ALTER TABLE `capital_profiles` ADD `routing_stage` text;--> statement-breakpoint
ALTER TABLE `capital_profiles` ADD `programme_key` text;