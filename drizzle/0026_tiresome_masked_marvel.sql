CREATE TABLE `field_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`lng` real NOT NULL,
	`lat` real NOT NULL,
	`accuracy_m` real,
	`heading_deg` real,
	`category` text DEFAULT 'observation' NOT NULL,
	`note` text NOT NULL,
	`media_url` text,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`visibility` text DEFAULT 'team' NOT NULL,
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`observer` text NOT NULL,
	`converted_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `field_observations_project` ON `field_observations` (`project_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `site_features` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`scenario` text DEFAULT '' NOT NULL,
	`purpose` text DEFAULT 'custom' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`geometry` text NOT NULL,
	`measures` text DEFAULT '{}' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`assumptions` text DEFAULT '{}' NOT NULL,
	`visibility` text DEFAULT 'team' NOT NULL,
	`grade` text DEFAULT 'screening' NOT NULL,
	`source_analysis_id` text,
	`west` real,
	`south` real,
	`east` real,
	`north` real,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_features_project` ON `site_features` (`project_id`);--> statement-breakpoint
CREATE INDEX `site_features_mandate` ON `site_features` (`mandate_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `spatial_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`params` text NOT NULL,
	`datasets` text NOT NULL,
	`results` text NOT NULL,
	`geometry` text,
	`grade` text DEFAULT 'screening' NOT NULL,
	`limitation` text DEFAULT '' NOT NULL,
	`model_version` text DEFAULT 'atlas-workbench-1' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spatial_analyses_project` ON `spatial_analyses` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `spatial_analyses_mandate` ON `spatial_analyses` (`mandate_id`,`kind`);