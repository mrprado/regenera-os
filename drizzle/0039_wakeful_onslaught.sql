CREATE TABLE `login_events` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`ok` integer NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_events_email` ON `login_events` (`email`,`at`);--> statement-breakpoint
CREATE TABLE `org_units` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`jurisdiction` text DEFAULT '' NOT NULL,
	`ownership_pct` text,
	`workspace_id` text,
	`corporate_entity_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `org_units_tenant` ON `org_units` (`tenant_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `os_credentials` (
	`email` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `os_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`token_hash` text NOT NULL,
	`user_type` text NOT NULL,
	`persona` text DEFAULT 'general' NOT NULL,
	`workspace_ids` text DEFAULT '[]' NOT NULL,
	`teams` text DEFAULT '[]' NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `os_invites_token_hash_unique` ON `os_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `os_invites_tenant` ON `os_invites` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_name` ON `teams` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `tenant_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`user_type` text NOT NULL,
	`persona` text DEFAULT 'general' NOT NULL,
	`teams` text DEFAULT '[]' NOT NULL,
	`module_deny` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by` text,
	`last_login_at` text,
	`deactivated_at` text,
	`deactivated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_members_email` ON `tenant_members` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `tenant_members_by_email` ON `tenant_members` (`email`);--> statement-breakpoint
CREATE TABLE `tenant_modules` (
	`tenant_id` text NOT NULL,
	`module` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'contract' NOT NULL,
	`expires_at` text,
	`updated_by` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`tenant_id`, `module`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'client' NOT NULL,
	`legal_name` text NOT NULL,
	`display_name` text NOT NULL,
	`org_type` text NOT NULL,
	`jurisdiction` text DEFAULT '' NOT NULL,
	`headquarters` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`crm_org_id` text,
	`branding` text DEFAULT '{}' NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`units` text DEFAULT 'metric' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`languages` text DEFAULT '["en"]' NOT NULL,
	`date_format` text DEFAULT 'YYYY-MM-DD' NOT NULL,
	`reporting_prefs` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'prospect' NOT NULL,
	`client_since` text,
	`account_owner` text,
	`support_tier` text DEFAULT 'standard' NOT NULL,
	`plan` text DEFAULT 'custom' NOT NULL,
	`seats_purchased` integer DEFAULT 0 NOT NULL,
	`external_seats` integer DEFAULT 0 NOT NULL,
	`storage_gb` integer DEFAULT 0 NOT NULL,
	`api_daily_limit` integer DEFAULT 0 NOT NULL,
	`onboarding` text DEFAULT '{}' NOT NULL,
	`offboarding` text DEFAULT '{}' NOT NULL,
	`termination_date` text,
	`renewal_date` text,
	`renewal_likelihood` text,
	`requested_modules` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tenants_status` ON `tenants` (`status`);--> statement-breakpoint
ALTER TABLE `mandates` ADD `tenant_id` text;--> statement-breakpoint
ALTER TABLE `mandates` ADD `sandbox` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill (docs/plans/phase-10-client-os.md): every existing workspace belongs to the Regenera tenant and every
-- existing member is Regenera internal, so nothing changes for current users.
INSERT OR IGNORE INTO `tenants` (`id`, `kind`, `legal_name`, `display_name`, `org_type`, `status`, `plan`) VALUES ('tenant_regenera', 'regenera', 'Regenera', 'Regenera', 'regenera', 'active', 'enterprise');
--> statement-breakpoint
UPDATE `mandates` SET `tenant_id` = 'tenant_regenera' WHERE `tenant_id` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `tenant_members` (`id`, `tenant_id`, `email`, `user_type`, `status`) SELECT lower(hex(randomblob(16))), 'tenant_regenera', `email`, 'regenera_internal', 'active' FROM (SELECT DISTINCT `email` FROM `mandate_members`);
