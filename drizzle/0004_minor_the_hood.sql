CREATE TABLE `case_records` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`deal_id` text NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`disclosure_authorized` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `case_records_deal` ON `case_records` (`deal_id`);--> statement-breakpoint
CREATE TABLE `mcp_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_email` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`client_id` text,
	`user_email` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_hash` ON `mcp_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_tokens_user` ON `mcp_tokens` (`user_email`);--> statement-breakpoint
CREATE TABLE `playbook_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`step` integer NOT NULL,
	`day` integer NOT NULL,
	`channel` text NOT NULL,
	`purpose` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`style_issues` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playbook_drafts_step` ON `playbook_drafts` (`mandate_id`,`segment_id`,`step`);--> statement-breakpoint
CREATE TABLE `privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_hash` text NOT NULL,
	`actor` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`evidence` text,
	`change` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`result` text,
	`reason` text,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proposals_status` ON `proposals` (`mandate_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `mandates` ADD `counsel_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `mandates` ADD `counsel_confirmed_by` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `expected_close` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `monthly_value` real;--> statement-breakpoint
ALTER TABLE `messages` ADD `prior_relationship` text;