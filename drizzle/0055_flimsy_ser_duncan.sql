CREATE TABLE `funding_project_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`project_id` text NOT NULL,
	`geography` text NOT NULL,
	`reasons` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`decided_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_project_matches_pair` ON `funding_project_matches` (`opportunity_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `funding_project_matches_project` ON `funding_project_matches` (`project_id`,`status`);--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `category` text DEFAULT 'opportunity' NOT NULL;