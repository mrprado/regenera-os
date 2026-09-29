CREATE TABLE `site_intel_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stages` text NOT NULL,
	`geometry_hash` text DEFAULT '' NOT NULL,
	`started_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `site_intel_runs_project` ON `site_intel_runs` (`project_id`,`created_at`);