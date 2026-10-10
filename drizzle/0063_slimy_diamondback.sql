CREATE TABLE `steward_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text NOT NULL,
	`kind` text DEFAULT 'place_assessment' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content` text NOT NULL,
	`evidence_ids` text,
	`knowledge_ids` text,
	`model` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`invalidated_reason` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steward_drafts_place` ON `steward_drafts` (`place_id`,`created_at`);