CREATE TABLE `engagement_closeouts` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`outcome` text NOT NULL,
	`acceptance_evidence` text NOT NULL,
	`lessons` text DEFAULT '' NOT NULL,
	`continuation` text DEFAULT '' NOT NULL,
	`case_study` text DEFAULT 'not_asked' NOT NULL,
	`referral_requested` integer DEFAULT false NOT NULL,
	`outstanding` text DEFAULT '[]' NOT NULL,
	`review_due` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engagement_closeouts_engagement` ON `engagement_closeouts` (`engagement_id`);