CREATE TABLE `contract_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invoiced_at` text,
	`paid_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contract_milestones_due` ON `contract_milestones` (`mandate_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `contract_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`terms` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_versions_unique` ON `contract_versions` (`contract_id`,`version`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`deal_id` text,
	`org_id` text,
	`kind` text NOT NULL,
	`engagement` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`body` text NOT NULL,
	`terms` text NOT NULL,
	`value` real,
	`counsel_required` integer DEFAULT false NOT NULL,
	`counsel_reviewed_at` text,
	`counsel_reviewed_by` text,
	`sent_at` text,
	`signed_at` text,
	`effective_date` text,
	`end_date` text,
	`signed_copy_url` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contracts_mandate_status` ON `contracts` (`mandate_id`,`status`);--> statement-breakpoint
CREATE INDEX `contracts_deal` ON `contracts` (`deal_id`);--> statement-breakpoint
CREATE INDEX `contracts_end` ON `contracts` (`end_date`);