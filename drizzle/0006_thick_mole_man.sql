CREATE TABLE `auth_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`return_to` text DEFAULT '/today' NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_links_email_idx` ON `auth_links` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_email_idx` ON `auth_sessions` (`email`);