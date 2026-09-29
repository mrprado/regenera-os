CREATE TABLE `mandate_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`layer` text NOT NULL,
	`field` text NOT NULL,
	`statement` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`source_url` text,
	`date` text,
	`confidence` text DEFAULT 'moderate' NOT NULL,
	`transaction_ref` text DEFAULT '' NOT NULL,
	`trigger_id` text,
	`verified_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mandate_evidence_profile` ON `mandate_evidence` (`profile_id`,`layer`);--> statement-breakpoint
CREATE TABLE `signal_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`signal_type` text DEFAULT 'other' NOT NULL,
	`classification` text DEFAULT '{}' NOT NULL,
	`interpretation` text DEFAULT '{}' NOT NULL,
	`relevance` text DEFAULT '[]' NOT NULL,
	`related` text DEFAULT '{"projectIds":[],"profileIds":[],"contactIds":[],"services":[]}' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`learning` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signal_assessments_trigger` ON `signal_assessments` (`trigger_id`);--> statement-breakpoint
CREATE TABLE `theses` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`contact_id` text,
	`profile_id` text,
	`theme` text NOT NULL,
	`thesis` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`source_url` text,
	`date` text,
	`sectors` text DEFAULT '[]' NOT NULL,
	`geography` text DEFAULT '' NOT NULL,
	`implications` text DEFAULT '' NOT NULL,
	`contradictions` text DEFAULT '' NOT NULL,
	`related_transactions` text DEFAULT '' NOT NULL,
	`interpretation` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `theses_org` ON `theses` (`org_id`);--> statement-breakpoint
CREATE TABLE `watches` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`org_id` text,
	`contact_id` text,
	`source_key` text,
	`label` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`owner` text,
	`events` text DEFAULT '[]' NOT NULL,
	`last_reviewed_at` text,
	`active` text DEFAULT 'yes' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `watches_mandate` ON `watches` (`mandate_id`,`kind`);