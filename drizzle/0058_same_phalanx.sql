CREATE TABLE `pinned_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`label` text NOT NULL,
	`href` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pinned_items_user_entity` ON `pinned_items` (`user_email`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `pinned_items_user` ON `pinned_items` (`user_email`,`position`);