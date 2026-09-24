CREATE TABLE `bid_library` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`case_record_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `funding_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`org_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_matches_pair` ON `funding_matches` (`opportunity_id`,`org_id`);--> statement-breakpoint
CREATE TABLE `funding_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`funder` text,
	`programme` text,
	`type` text NOT NULL,
	`amount_min` real,
	`amount_max` real,
	`currency` text,
	`cofinancing_pct` integer,
	`open_date` text,
	`deadline` text,
	`countries` text,
	`applicant_types` text,
	`sectors` text,
	`url` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`fit` integer,
	`route` text,
	`read` text,
	`read_at` text,
	`decision` text DEFAULT 'new' NOT NULL,
	`dismiss_reason` text,
	`deal_id` text,
	`funder_org_id` text,
	`lat` real,
	`lng` real,
	`query_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_source_external` ON `funding_opportunities` (`mandate_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `funding_dedupe` ON `funding_opportunities` (`mandate_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `funding_deadline` ON `funding_opportunities` (`mandate_id`,`status`,`deadline`);--> statement-breakpoint
ALTER TABLE `deals` ADD `opportunity_id` text;