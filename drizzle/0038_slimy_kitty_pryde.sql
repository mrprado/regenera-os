CREATE TABLE `ee_results` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`analysis` text NOT NULL,
	`params` text DEFAULT '' NOT NULL,
	`geometry_hash` text NOT NULL,
	`analysis_version` text NOT NULL,
	`result` text NOT NULL,
	`dataset` text DEFAULT '' NOT NULL,
	`scale_m` text DEFAULT '' NOT NULL,
	`generated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `ee_results_key` ON `ee_results` (`project_id`,`analysis`,`geometry_hash`);--> statement-breakpoint
CREATE TABLE `site_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`year` text NOT NULL,
	`source` text NOT NULL,
	`vector` text NOT NULL,
	`geometry_hash` text NOT NULL,
	`analysis_version` text NOT NULL,
	`generated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_embeddings_project` ON `site_embeddings` (`project_id`,`year`);