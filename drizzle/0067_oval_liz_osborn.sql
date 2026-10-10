CREATE TABLE `field_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`current_value` text NOT NULL,
	`current_source` text DEFAULT '' NOT NULL,
	`proposed_value` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`confidence` text,
	`retrieved_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`note` text DEFAULT '' NOT NULL,
	`pending_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_reviews_pending` ON `field_reviews` (`pending_key`);--> statement-breakpoint
CREATE INDEX `field_reviews_mandate` ON `field_reviews` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `steward_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text,
	`project_id` text,
	`dimension` text NOT NULL,
	`subject` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`evidence` text NOT NULL,
	`affected_parties` text DEFAULT '' NOT NULL,
	`uncertainty` text DEFAULT 'unknown' NOT NULL,
	`implication` text NOT NULL,
	`required_action` text NOT NULL,
	`materiality` text DEFAULT 'material' NOT NULL,
	`owner` text,
	`review_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_evidence` text,
	`resolved_by` text,
	`resolved_at` text,
	`task_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steward_findings_project` ON `steward_findings` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `steward_findings_place` ON `steward_findings` (`place_id`);