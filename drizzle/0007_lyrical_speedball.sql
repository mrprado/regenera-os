CREATE TABLE `auth_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`ip` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_failures_email_idx` ON `auth_failures` (`email`,`at`);--> statement-breakpoint
CREATE INDEX `auth_failures_ip_idx` ON `auth_failures` (`ip`,`at`);