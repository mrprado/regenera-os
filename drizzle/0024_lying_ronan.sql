CREATE TABLE `relationship_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`type` text NOT NULL,
	`strength` real DEFAULT 0.5 NOT NULL,
	`since` text,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `relationship_edges_from` ON `relationship_edges` (`from_type`,`from_id`);--> statement-breakpoint
CREATE INDEX `relationship_edges_to` ON `relationship_edges` (`to_type`,`to_id`);