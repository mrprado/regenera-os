CREATE TABLE `mail_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`message_key` text NOT NULL,
	`attachment_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text DEFAULT '' NOT NULL,
	`size` integer,
	`document_type` text DEFAULT 'other' NOT NULL,
	`confidentiality` text DEFAULT 'unknown' NOT NULL,
	`nda_covered` text DEFAULT 'unknown' NOT NULL,
	`document_id` text,
	`project_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_attachments_key` ON `mail_attachments` (`message_key`,`attachment_id`);--> statement-breakpoint
CREATE TABLE `mail_campaign_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`email` text NOT NULL,
	`person_id` text,
	`first_sent_at` text NOT NULL,
	`last_contact_at` text NOT NULL,
	`follow_ups` integer DEFAULT 0 NOT NULL,
	`replied` integer DEFAULT false NOT NULL,
	`response_type` text DEFAULT 'none' NOT NULL,
	`meeting_held` integer DEFAULT false NOT NULL,
	`materials_shared` integer DEFAULT false NOT NULL,
	`commercial_stage` text DEFAULT 'cold_emailed' NOT NULL,
	`message_keys` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_campaign_recipients_pair` ON `mail_campaign_recipients` (`campaign_id`,`email`);--> statement-breakpoint
CREATE TABLE `mail_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`account` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`asset_promoted` text DEFAULT '' NOT NULL,
	`template_hash` text NOT NULL,
	`subject_template` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_campaigns_template` ON `mail_campaigns` (`account`,`template_hash`);--> statement-breakpoint
CREATE TABLE `mail_checkpoints` (
	`account` text PRIMARY KEY NOT NULL,
	`boundary_start` text NOT NULL,
	`boundary_end` text NOT NULL,
	`last_internal_date` text,
	`last_message_id` text,
	`next_page_token` text,
	`batch_number` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`ingestion_version` text NOT NULL,
	`extraction_model` text NOT NULL,
	`schema_version` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`entity_label` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`fact_type` text NOT NULL,
	`effective_date` text,
	`source_message_key` text NOT NULL,
	`source_attachment_id` text,
	`model` text NOT NULL,
	`confidence` real NOT NULL,
	`supersedes_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_facts_entity` ON `mail_facts` (`entity_type`,`entity_id`,`field`);--> statement-breakpoint
CREATE INDEX `mail_facts_source` ON `mail_facts` (`source_message_key`);--> statement-breakpoint
CREATE TABLE `mail_ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`transport` text NOT NULL,
	`boundary_start` text NOT NULL,
	`boundary_end` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`ingestion_version` text NOT NULL,
	`extraction_model` text NOT NULL,
	`schema_version` text NOT NULL,
	`started_by` text NOT NULL,
	`error` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `mail_introductions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`introducer_email` text NOT NULL,
	`introduced_email` text,
	`introduced_org` text,
	`date` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`project_id` text,
	`resulting_state` text DEFAULT 'identified' NOT NULL,
	`source_message_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_introductions_key` ON `mail_introductions` (`source_message_key`,`introduced_email`);--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`key` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`account` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`internal_date` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text DEFAULT '' NOT NULL,
	`to` text DEFAULT '[]' NOT NULL,
	`cc` text DEFAULT '[]' NOT NULL,
	`bcc` text DEFAULT '[]' NOT NULL,
	`reply_to` text,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`body` text,
	`body_truncated` integer DEFAULT false NOT NULL,
	`direction` text NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`has_attachment` integer DEFAULT false NOT NULL,
	`attachment_ids` text DEFAULT '[]' NOT NULL,
	`in_reply_to` text,
	`references` text,
	`display_url` text,
	`raw_hash` text NOT NULL,
	`batch_id` text NOT NULL,
	`mail_class` text DEFAULT 'unclassified' NOT NULL,
	`class_basis` text DEFAULT '' NOT NULL,
	`campaign_id` text,
	`quoted_only` integer DEFAULT false NOT NULL,
	`ingested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_messages_thread` ON `mail_messages` (`account`,`gmail_thread_id`,`internal_date`);--> statement-breakpoint
CREATE INDEX `mail_messages_class` ON `mail_messages` (`mandate_id`,`mail_class`,`internal_date`);--> statement-breakpoint
CREATE INDEX `mail_messages_from` ON `mail_messages` (`from_email`);--> statement-breakpoint
CREATE TABLE `mail_obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`by_me` integer NOT NULL,
	`actor` text NOT NULL,
	`counterparty` text NOT NULL,
	`text` text NOT NULL,
	`firm` integer DEFAULT true NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`confidence` real NOT NULL,
	`project_id` text,
	`task_id` text,
	`source_message_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_obligations_open` ON `mail_obligations` (`mandate_id`,`kind`,`status`);--> statement-breakpoint
CREATE TABLE `mail_people` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`domain` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`kind` text DEFAULT 'person' NOT NULL,
	`first_at` text,
	`last_at` text,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`meeting_count` integer DEFAULT 0 NOT NULL,
	`docs_count` integer DEFAULT 0 NOT NULL,
	`engagement_state` text DEFAULT 'identified' NOT NULL,
	`relationship_stage` text DEFAULT 'target' NOT NULL,
	`strength` text DEFAULT 'none' NOT NULL,
	`commercial_stage` text DEFAULT 'none' NOT NULL,
	`relevance` text DEFAULT 'unknown' NOT NULL,
	`response_quality` text DEFAULT 'none' NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`low_signal` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_people_email` ON `mail_people` (`mandate_id`,`email`);--> statement-breakpoint
CREATE INDEX `mail_people_state` ON `mail_people` (`mandate_id`,`engagement_state`);--> statement-breakpoint
CREATE TABLE `mail_review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`source_message_key` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_review_items_open` ON `mail_review_items` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `mail_sources` (
	`account` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`transport` text DEFAULT 'import' NOT NULL,
	`own_addresses` text DEFAULT '[]' NOT NULL,
	`refresh_token_enc` text,
	`scopes` text DEFAULT '' NOT NULL,
	`boundary_start` text NOT NULL,
	`boundary_end` text NOT NULL,
	`include_spam_trash` integer DEFAULT false NOT NULL,
	`sync_mode` text DEFAULT 'backfill' NOT NULL,
	`history_id` text,
	`connected_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_threads` (
	`key` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`account` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`first_at` text NOT NULL,
	`last_at` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`participants` text DEFAULT '[]' NOT NULL,
	`mail_class` text DEFAULT 'unclassified' NOT NULL,
	`state` text DEFAULT 'identified' NOT NULL,
	`last_direction` text,
	`awaiting_reply_from` text,
	`summary` text DEFAULT '' NOT NULL,
	`org_ids` text DEFAULT '[]' NOT NULL,
	`contact_ids` text DEFAULT '[]' NOT NULL,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`deal_ids` text DEFAULT '[]' NOT NULL,
	`extracted_at` text,
	`extraction_model` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_threads_last` ON `mail_threads` (`mandate_id`,`mail_class`,`last_at`);