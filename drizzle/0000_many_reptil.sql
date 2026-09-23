CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text DEFAULT '' NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`before` text,
	`after` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `job_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`cadence` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` text NOT NULL,
	`last_run_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_schedules_job_type_unique` ON `job_schedules` (`job_type`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`run_after` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`locked_until` text,
	`last_error` text,
	`dedupe_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK(status IN ('queued', 'running', 'done', 'dead'))
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_after` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `mandate_members` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`mandate_id`) REFERENCES `mandates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mandate_members_role_check" CHECK(role IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mandate_members_mandate_email` ON `mandate_members` (`mandate_id`,`email`);--> statement-breakpoint
CREATE INDEX `mandate_members_email` ON `mandate_members` (`email`);--> statement-breakpoint
CREATE TABLE `mandates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`rules` text NOT NULL,
	`sending_identity` text DEFAULT '' NOT NULL,
	`fee_terms` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "mandates_type_check" CHECK(type IN ('advisory', 'investment', 'development'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mandates_slug_unique` ON `mandates` (`slug`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`mailbox_role` text NOT NULL,
	`email` text NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`access_token_expires_at` text NOT NULL,
	`scopes` text NOT NULL,
	`daily_cap` integer DEFAULT 10 NOT NULL,
	`warmup_started_on` text,
	`paused_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "oauth_accounts_role_check" CHECK(mailbox_role IN ('primary', 'sending'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_accounts_provider_role` ON `oauth_accounts` (`provider`,`mailbox_role`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
