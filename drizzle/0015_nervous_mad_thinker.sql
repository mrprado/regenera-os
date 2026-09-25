CREATE TABLE `risks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`likelihood` text DEFAULT 'possible' NOT NULL,
	`impact` text DEFAULT 'medium' NOT NULL,
	`mitigation` text DEFAULT '' NOT NULL,
	`owner` text,
	`trigger` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`residual` text DEFAULT 'unknown' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `risks_project` ON `risks` (`project_id`,`status`);