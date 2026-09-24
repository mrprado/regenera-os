CREATE TABLE `extension_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text DEFAULT 'Chrome' NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extension_tokens_hash` ON `extension_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `list_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`entry_key` text NOT NULL,
	`name` text NOT NULL,
	`country` text,
	`sector` text,
	`detail` text,
	`is_new` integer DEFAULT false NOT NULL,
	`org_id` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_entries_key` ON `list_entries` (`source_key`,`entry_key`);--> statement-breakpoint
CREATE INDEX `list_entries_new` ON `list_entries` (`source_key`,`is_new`,`first_seen_at`);--> statement-breakpoint
CREATE TABLE `list_sources` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`lead_source` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`baseline_at` text,
	`last_run_at` text,
	`last_count` integer,
	`last_new` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`metrics` text NOT NULL,
	`body` text,
	`emailed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_period` ON `reports` (`mandate_id`,`kind`,`period_start`);--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`segment_id` text,
	`params` text,
	`query` text,
	`region` text,
	`cadence` text DEFAULT 'weekly:mon:06:00' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`last_new` integer,
	`created_by` text DEFAULT 'system' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_searches_key` ON `saved_searches` (`mandate_id`,`key`);--> statement-breakpoint
CREATE TABLE `search_results` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`saved_search_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`subtitle` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`found_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_results_key` ON `search_results` (`saved_search_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `search_results_status` ON `search_results` (`mandate_id`,`status`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `source_trigger_id` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `partner_id` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `trigger_id` text;--> statement-breakpoint
ALTER TABLE `partners` ADD `site_account_id` integer;--> statement-breakpoint
ALTER TABLE `partners` ADD `organization` text;--> statement-breakpoint
ALTER TABLE `partners` ADD `geographies` text;--> statement-breakpoint
ALTER TABLE `partners` ADD `capabilities` text;--> statement-breakpoint
ALTER TABLE `partners` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `partners` ADD `last_referral_at` text;