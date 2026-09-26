CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`actor` text NOT NULL,
	`processed_at` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_unprocessed` ON `events` (`processed_at`,`at`);--> statement-breakpoint
CREATE INDEX `events_entity` ON `events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `notification_mutes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`category` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`recipient` text,
	`category` text NOT NULL,
	`priority` text DEFAULT 'information' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`link` text,
	`event_id` text,
	`rule_id` text,
	`assigned_to` text,
	`read_at` text,
	`resolved_at` text,
	`snoozed_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_open` ON `notifications` (`mandate_id`,`resolved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `stage_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text DEFAULT 'project' NOT NULL,
	`to_stage` text NOT NULL,
	`conditions` text NOT NULL,
	`enforce` text DEFAULT 'block' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stage_gates_stage` ON `stage_gates` (`mandate_id`,`entity_type`,`to_stage`);--> statement-breakpoint
CREATE TABLE `trigger_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`event_type` text NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`actions` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`owner` text,
	`is_system` integer DEFAULT false NOT NULL,
	`last_run_at` text,
	`last_result` text DEFAULT '' NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trigger_rules_event` ON `trigger_rules` (`mandate_id`,`event_type`,`enabled`);