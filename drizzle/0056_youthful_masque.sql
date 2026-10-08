CREATE TABLE `origination_hypotheses` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`title` text NOT NULL,
	`thesis` text NOT NULL,
	`country` text,
	`sector` text,
	`evidence` text NOT NULL,
	`counterparts` text DEFAULT '[]' NOT NULL,
	`validation` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'to_validate' NOT NULL,
	`dedupe_key` text NOT NULL,
	`converted_project_id` text,
	`decided_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `origination_hypotheses_status` ON `origination_hypotheses` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `origination_hypotheses_dedupe` ON `origination_hypotheses` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `origination_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entrance` text NOT NULL,
	`strategy` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text,
	`opportunity_id` text,
	`hypothesis_id` text,
	`org_id` text,
	`match_id` text,
	`stage` text DEFAULT 'discovered' NOT NULL,
	`recommended_service` text,
	`service_reason` text,
	`expected_value_usd` real,
	`value_basis` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`next_action` text,
	`engagement_id` text,
	`dossier_id` text,
	`proposal_id` text,
	`owner` text,
	`dedupe_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `origination_items_stage` ON `origination_items` (`stage`,`priority`);--> statement-breakpoint
CREATE INDEX `origination_items_dedupe` ON `origination_items` (`dedupe_key`);--> statement-breakpoint
ALTER TABLE `funding_project_matches` ADD `eligibility` text;--> statement-breakpoint
ALTER TABLE `funding_project_matches` ADD `checks` text;--> statement-breakpoint
ALTER TABLE `funding_project_matches` ADD `soft` text;--> statement-breakpoint
ALTER TABLE `funding_project_matches` ADD `questions` text;--> statement-breakpoint
ALTER TABLE `funding_project_matches` ADD `capital_stage` text;