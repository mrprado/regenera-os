CREATE TABLE `spatial_layers` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`source_date` text,
	`retrieved_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`license` text DEFAULT '' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`coverage` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'unknown' NOT NULL,
	`project_id` text,
	`geojson` text NOT NULL,
	`feature_count` integer NOT NULL,
	`west` real,
	`south` real,
	`east` real,
	`north` real,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spatial_layers_mandate` ON `spatial_layers` (`mandate_id`,`category`);--> statement-breakpoint
CREATE INDEX `spatial_layers_bbox` ON `spatial_layers` (`west`,`east`,`south`,`north`);