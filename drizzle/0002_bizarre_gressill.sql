CREATE TABLE `deliverability_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`spf` integer NOT NULL,
	`dmarc` text,
	`dkim` integer NOT NULL,
	`mx` integer NOT NULL,
	`bounce_rate` real,
	`complaints` integer DEFAULT 0 NOT NULL,
	`detail` text,
	`checked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deliverability_domain` ON `deliverability_checks` (`domain`,`checked_at`);--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`org_id` text,
	`sequence_id` text NOT NULL,
	`status` text DEFAULT 'drafting' NOT NULL,
	`current_step` integer DEFAULT 0 NOT NULL,
	`start_at` text NOT NULL,
	`stop_reason` text,
	`enrolled_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `enrollments_contact` ON `enrollments` (`contact_id`,`status`);--> statement-breakpoint
CREATE INDEX `enrollments_org` ON `enrollments` (`org_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_one_active` ON `enrollments` (`contact_id`) WHERE status in ('drafting','active','paused');--> statement-breakpoint
CREATE TABLE `mailbox_state` (
	`role` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`sent_today` integer DEFAULT 0 NOT NULL,
	`paused_until` text,
	`pause_reason` text,
	`history_id` text,
	`calendar_synced_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meeting_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`event_id` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`deal_id` text,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`brief` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_briefs_event` ON `meeting_briefs` (`mandate_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`email` text NOT NULL,
	`domain` text NOT NULL,
	`mailbox` text NOT NULL,
	`emails_sent` integer DEFAULT 0 NOT NULL,
	`emails_received` integer DEFAULT 0 NOT NULL,
	`meetings` integer DEFAULT 0 NOT NULL,
	`last_contact_at` text,
	`strength` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationships_key` ON `relationships` (`mandate_id`,`email`,`mailbox`);--> statement-breakpoint
CREATE INDEX `relationships_domain` ON `relationships` (`domain`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`message_id` text,
	`gmail_message_id` text NOT NULL,
	`gmail_thread_id` text,
	`from_email` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL,
	`classification` text,
	`sentiment` text,
	`extracted` text,
	`suggested_response` text,
	`needs_human` integer DEFAULT true NOT NULL,
	`handled` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replies_gmail` ON `replies` (`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `replies_handled` ON `replies` (`handled`,`received_at`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`tier` text NOT NULL,
	`segment_id` text,
	`steps` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sequences_mandate_key` ON `sequences` (`mandate_id`,`key`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`deal_id` text,
	`enrollment_id` text,
	`message_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_status_due` ON `tasks` (`status`,`due_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `approved_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `enrollment_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `step` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `scheduled_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `tier` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `angle_tag` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `variant_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `rfc_message_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `style_issues` text;--> statement-breakpoint
CREATE INDEX `messages_due` ON `messages` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `messages_thread` ON `messages` (`gmail_thread_id`);