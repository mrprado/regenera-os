CREATE TABLE `registry_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`kind` text DEFAULT 'generation' NOT NULL,
	`name` text NOT NULL,
	`country` text,
	`fuel` text,
	`capacity_mw` real,
	`commissioning_year` integer,
	`owner` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`url` text,
	`source_of_record` text,
	`vintage` text,
	`retrieved_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_assets_source_id` ON `registry_assets` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `registry_assets_lat_lng` ON `registry_assets` (`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `registry_assets_fuel` ON `registry_assets` (`fuel`);