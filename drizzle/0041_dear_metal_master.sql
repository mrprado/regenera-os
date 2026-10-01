CREATE TABLE `analysis_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`question` text NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`mode` text DEFAULT 'formal' NOT NULL,
	`template` text DEFAULT 'custom' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`requester` text NOT NULL,
	`owner` text,
	`reviewer` text,
	`decision_maker` text,
	`deadline` text,
	`output_format` text DEFAULT 'memo' NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`confidentiality` text DEFAULT 'internal' NOT NULL,
	`project_id` text,
	`deal_id` text,
	`engagement_id` text,
	`work_mandate_id` text,
	`workstream_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`recommendation` text DEFAULT '' NOT NULL,
	`conclusion` text DEFAULT '' NOT NULL,
	`prepared_by` text,
	`prepared_at` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`approved_by` text,
	`approved_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`ic_status` text DEFAULT 'none' NOT NULL,
	`ic_conditions` text DEFAULT '' NOT NULL,
	`ic_follow_ups` text DEFAULT '' NOT NULL,
	`ic_rationale` text DEFAULT '' NOT NULL,
	`decision_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_requests_mandate` ON `analysis_requests` (`mandate_id`,`status`);--> statement-breakpoint
CREATE INDEX `analysis_requests_project` ON `analysis_requests` (`project_id`);--> statement-breakpoint
CREATE TABLE `evidence_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`request_id` text,
	`node_id` text,
	`project_id` text,
	`kind` text DEFAULT 'document' NOT NULL,
	`evidence_class` text NOT NULL,
	`title` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`source_url` text,
	`document_id` text,
	`claim_id` text,
	`map_view` text,
	`source_date` text,
	`author` text DEFAULT '' NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`page` text,
	`geography` text DEFAULT '' NOT NULL,
	`reliability` text DEFAULT 'medium' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `analysis_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_items_request` ON `evidence_items` (`request_id`);--> statement-breakpoint
CREATE INDEX `evidence_items_project` ON `evidence_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`request_id` text NOT NULL,
	`node_id` text,
	`kind` text DEFAULT 'finding' NOT NULL,
	`finding` text NOT NULL,
	`implication` text DEFAULT '' NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`assumptions` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'preliminary' NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`prepared_by` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`action` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `analysis_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_request` ON `findings` (`request_id`);--> statement-breakpoint
CREATE TABLE `issue_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`request_id` text NOT NULL,
	`parent_id` text,
	`kind` text DEFAULT 'question' NOT NULL,
	`text` text NOT NULL,
	`evidence_required` text DEFAULT '' NOT NULL,
	`owner` text,
	`due` text,
	`status` text DEFAULT 'open' NOT NULL,
	`conclusion` text,
	`confidence` text DEFAULT 'unknown' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `analysis_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_nodes_request` ON `issue_nodes` (`request_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `review_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`request_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`mark` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`author` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `analysis_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_marks_request` ON `review_marks` (`request_id`,`status`);--> statement-breakpoint
CREATE TABLE `story_points` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`request_id` text NOT NULL,
	`observation` text NOT NULL,
	`implication` text DEFAULT '' NOT NULL,
	`recommendation` text DEFAULT '' NOT NULL,
	`action` text DEFAULT '' NOT NULL,
	`finding_ids` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `analysis_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_points_request` ON `story_points` (`request_id`);