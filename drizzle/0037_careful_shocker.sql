CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`service` text DEFAULT '' NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`countries` text DEFAULT '[]' NOT NULL,
	`recipient_types` text DEFAULT '[]' NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`commercial` integer DEFAULT true NOT NULL,
	`capital_related` integer DEFAULT false NOT NULL,
	`securities_related` integer DEFAULT false NOT NULL,
	`success_fee` integer DEFAULT false NOT NULL,
	`ma_or_asset_sale` integer DEFAULT false NOT NULL,
	`partnership` integer DEFAULT false NOT NULL,
	`research` integer DEFAULT false NOT NULL,
	`data_sources` text DEFAULT '[]' NOT NULL,
	`cta` text DEFAULT '' NOT NULL,
	`sequence_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`assessment` text DEFAULT '{}' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`approval_note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `campaigns_mandate` ON `campaigns` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `contact_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text,
	`email` text,
	`org_id` text,
	`status` text NOT NULL,
	`channel` text DEFAULT 'all' NOT NULL,
	`jurisdiction` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`lifted_at` text
);
--> statement-breakpoint
CREATE INDEX `contact_preferences_contact` ON `contact_preferences` (`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_preferences_email` ON `contact_preferences` (`email`);--> statement-breakpoint
CREATE TABLE `jurisdiction_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`topic` text NOT NULL,
	`summary` text NOT NULL,
	`requirements` text DEFAULT '' NOT NULL,
	`opt_out` text DEFAULT '' NOT NULL,
	`disclosures` text DEFAULT '' NOT NULL,
	`recipient_scope` text DEFAULT '' NOT NULL,
	`source_url` text NOT NULL,
	`source_title` text DEFAULT '' NOT NULL,
	`effective_date` text,
	`last_reviewed` text,
	`counsel_status` text DEFAULT 'not_reviewed' NOT NULL,
	`counsel` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jurisdiction_rules_j` ON `jurisdiction_rules` (`jurisdiction`,`topic`);