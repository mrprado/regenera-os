CREATE TABLE `partnerships` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`stage` text DEFAULT 'potential' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`geographies` text DEFAULT '[]' NOT NULL,
	`sectors` text DEFAULT '[]' NOT NULL,
	`capability_evidence` text DEFAULT '' NOT NULL,
	`verified_by` text,
	`verified_at` text,
	`capacity` text DEFAULT '' NOT NULL,
	`arrangement` text DEFAULT '' NOT NULL,
	`commercial_terms` text DEFAULT '' NOT NULL,
	`contract_id` text,
	`agreement_evidence` text,
	`owner` text,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`no_action_reason` text,
	`stage_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partnerships_org_kind` ON `partnerships` (`mandate_id`,`org_id`,`kind`);--> statement-breakpoint
CREATE TABLE `relationship_introductions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`from_org_id` text,
	`from_contact_id` text,
	`to_org_id` text,
	`to_contact_id` text,
	`partnership_id` text,
	`project_id` text,
	`engagement_id` text,
	`purpose` text NOT NULL,
	`authorization` text DEFAULT '' NOT NULL,
	`materials_shared` text DEFAULT '[]' NOT NULL,
	`date` text,
	`owner` text,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`outcome_note` text DEFAULT '' NOT NULL,
	`open_key` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationship_introductions_open` ON `relationship_introductions` (`open_key`);--> statement-breakpoint
CREATE INDEX `relationship_introductions_project` ON `relationship_introductions` (`project_id`);--> statement-breakpoint
ALTER TABLE `intake_submissions` ADD `attribution` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `intake_submissions` ADD `consent` text DEFAULT 'respond' NOT NULL;--> statement-breakpoint
ALTER TABLE `intake_submissions` ADD `dedupe_key` text;--> statement-breakpoint
ALTER TABLE `intake_submissions` ADD `conversion_error` text;--> statement-breakpoint
CREATE INDEX `intake_submissions_dedupe` ON `intake_submissions` (`dedupe_key`,`created_at`);