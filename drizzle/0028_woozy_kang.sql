CREATE TABLE `account_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`category` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`integration_key` text,
	`account_owner` text,
	`entity` text,
	`environment` text DEFAULT 'production' NOT NULL,
	`billing_contact` text,
	`admin_contact` text,
	`technical_contact` text,
	`plan` text DEFAULT '' NOT NULL,
	`monthly_cost` real,
	`annual_cost` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`renewal_date` text,
	`purpose` text DEFAULT '' NOT NULL,
	`cost_allocation` text DEFAULT 'overhead' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_connections_mandate` ON `account_connections` (`mandate_id`,`category`);--> statement-breakpoint
CREATE TABLE `commercial_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'vendor' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`geographies` text DEFAULT '[]' NOT NULL,
	`rates` text DEFAULT '' NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`commercial_terms` text DEFAULT '' NOT NULL,
	`insurance_expiry` text,
	`contract_id` text,
	`performance` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `commercial_partners_mandate` ON `commercial_partners` (`mandate_id`,`kind`);--> statement-breakpoint
CREATE TABLE `corporate_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'operating' NOT NULL,
	`jurisdiction` text DEFAULT '' NOT NULL,
	`formation_date` text,
	`directors` text DEFAULT '[]' NOT NULL,
	`ownership` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`project_id` text,
	`bank` text DEFAULT '' NOT NULL,
	`tax_registration` text DEFAULT '' NOT NULL,
	`registered_agent` text DEFAULT '' NOT NULL,
	`annual_filing_due` text,
	`insurance` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `corporate_entities_mandate` ON `corporate_entities` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `engagements` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`org_id` text,
	`project_id` text,
	`deal_id` text,
	`contract_id` text,
	`entity_id` text,
	`status` text DEFAULT 'prospect' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`assumptions` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`client_responsibilities` text DEFAULT '' NOT NULL,
	`workstreams` text DEFAULT '[]' NOT NULL,
	`deliverables` text DEFAULT '[]' NOT NULL,
	`payment_schedule` text DEFAULT '[]' NOT NULL,
	`change_orders` text DEFAULT '[]' NOT NULL,
	`partners` text DEFAULT '[]' NOT NULL,
	`team` text DEFAULT '[]' NOT NULL,
	`billing_type` text DEFAULT 'fixed' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`monthly_fee` real DEFAULT 0 NOT NULL,
	`months` integer DEFAULT 0 NOT NULL,
	`payment_terms` text DEFAULT 'Net 30' NOT NULL,
	`probability_pct` real,
	`expected_hours` real DEFAULT 0 NOT NULL,
	`expected_external_cost` real DEFAULT 0 NOT NULL,
	`hourly_cost` real,
	`start_date` text,
	`end_date` text,
	`owner` text,
	`conflict_status` text DEFAULT 'unchecked' NOT NULL,
	`conflict_note` text DEFAULT '' NOT NULL,
	`kyc_required` integer DEFAULT false NOT NULL,
	`approval_required` integer DEFAULT false NOT NULL,
	`approved_by` text,
	`portal_enabled` integer DEFAULT false NOT NULL,
	`next_service` text,
	`lost_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `engagements_mandate_status` ON `engagements` (`mandate_id`,`status`);--> statement-breakpoint
CREATE INDEX `engagements_org` ON `engagements` (`org_id`);--> statement-breakpoint
CREATE INDEX `engagements_project` ON `engagements` (`project_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text,
	`category` text NOT NULL,
	`classification` text DEFAULT 'included' NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`date` text NOT NULL,
	`vendor` text DEFAULT '' NOT NULL,
	`receipt_url` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `expenses_engagement` ON `expenses` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`number` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`issue_date` text,
	`due_date` text,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`paid_at` text,
	`milestone` text DEFAULT '' NOT NULL,
	`external_provider` text,
	`external_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number` ON `invoices` (`mandate_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoices_engagement` ON `invoices` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `invoices_due` ON `invoices` (`mandate_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`key` text NOT NULL,
	`family` text NOT NULL,
	`name` text NOT NULL,
	`depth` text DEFAULT 'standard' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`ideal_client` text DEFAULT '' NOT NULL,
	`stages` text DEFAULT '[]' NOT NULL,
	`inputs` text DEFAULT '[]' NOT NULL,
	`deliverables` text DEFAULT '[]' NOT NULL,
	`workflow` text DEFAULT '[]' NOT NULL,
	`specialist_required` text DEFAULT '[]' NOT NULL,
	`next_services` text DEFAULT '[]' NOT NULL,
	`timeline_weeks` integer DEFAULT 4 NOT NULL,
	`billing_type` text DEFAULT 'fixed' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`list_price` real,
	`min_price` real,
	`band_low` real,
	`band_high` real,
	`per_month` integer DEFAULT false NOT NULL,
	`expected_hours` real DEFAULT 0 NOT NULL,
	`expected_external_cost` real DEFAULT 0 NOT NULL,
	`target_margin_pct` real DEFAULT 55 NOT NULL,
	`role` text DEFAULT 'advisory' NOT NULL,
	`phase` text DEFAULT 'p1' NOT NULL,
	`approval_required` integer DEFAULT false NOT NULL,
	`legal_notes` text DEFAULT '' NOT NULL,
	`portal_access` text DEFAULT 'deliverables' NOT NULL,
	`owner_email` text,
	`active` integer DEFAULT true NOT NULL,
	`seeded` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_key` ON `services` (`mandate_id`,`key`,`depth`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`person` text NOT NULL,
	`workstream` text DEFAULT '' NOT NULL,
	`hours` real NOT NULL,
	`date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `time_entries_engagement` ON `time_entries` (`engagement_id`);