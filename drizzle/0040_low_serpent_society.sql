CREATE TABLE `product_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`problem` text DEFAULT '' NOT NULL,
	`user` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`frequency` text DEFAULT '' NOT NULL,
	`revenue_relevance` text DEFAULT '' NOT NULL,
	`urgency` text DEFAULT '' NOT NULL,
	`workaround` text DEFAULT '' NOT NULL,
	`component` text DEFAULT '' NOT NULL,
	`impact` text DEFAULT '' NOT NULL,
	`effort` text DEFAULT '' NOT NULL,
	`classification` text,
	`build_category` text DEFAULT 'not_ready' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`owner` text,
	`source` text DEFAULT 'internal' NOT NULL,
	`tenant_id` text,
	`engagement_id` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_items_kind` ON `product_items` (`kind`,`status`);--> statement-breakpoint
CREATE TABLE `work_mandates` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`geography` text DEFAULT '' NOT NULL,
	`asset_type` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`capital_requirement` text DEFAULT '' NOT NULL,
	`responsibilities` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`start_date` text,
	`expiry_date` text,
	`renewal` text DEFAULT '' NOT NULL,
	`fee_structure` text DEFAULT '' NOT NULL,
	`success_fee` text DEFAULT '' NOT NULL,
	`reporting` text DEFAULT '' NOT NULL,
	`territory` text,
	`owner` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_mandates_engagement` ON `work_mandates` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `workstreams` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`work_mandate_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`lead` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workstreams_engagement` ON `workstreams` (`engagement_id`);--> statement-breakpoint
ALTER TABLE `engagements` ADD `tenant_id` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `engagement_type` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `revenue_category` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `entry_point` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `discovery` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagements` ADD `renewal_date` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `reporting_cadence` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagements` ADD `sla` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagements` ADD `success_criteria` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagements` ADD `included_modules` text DEFAULT '[]' NOT NULL;