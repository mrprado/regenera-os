CREATE TABLE `care_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner` text,
	`due_date` text,
	`season` text DEFAULT '' NOT NULL,
	`depends_on` text,
	`monitoring_method` text DEFAULT '' NOT NULL,
	`budget_id` text,
	`requires_knowledge_id` text,
	`requires_activity` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`completion_evidence` text DEFAULT '' NOT NULL,
	`completed_at` text,
	`completed_by` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `care_actions_plan` ON `care_actions` (`plan_id`);--> statement-breakpoint
CREATE INDEX `care_actions_due` ON `care_actions` (`mandate_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `care_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`baseline` text DEFAULT '' NOT NULL,
	`owner` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`start_date` text,
	`review_date` text,
	`monitoring_protocol` text DEFAULT '' NOT NULL,
	`permissions_note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `care_plans_place` ON `care_plans` (`place_id`);--> statement-breakpoint
CREATE TABLE `funding_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`budget_id` text NOT NULL,
	`source` text NOT NULL,
	`stage` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`date` text,
	`evidence` text DEFAULT '' NOT NULL,
	`agreement_ref` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `funding_allocations_budget` ON `funding_allocations` (`budget_id`);--> statement-breakpoint
CREATE TABLE `steward_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text NOT NULL,
	`dimension` text NOT NULL,
	`status` text NOT NULL,
	`basis` text NOT NULL,
	`evidence_ref` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`assessed_by` text NOT NULL,
	`assessed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steward_assessments_place` ON `steward_assessments` (`place_id`,`dimension`,`assessed_at`);--> statement-breakpoint
CREATE TABLE `steward_indicators` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text NOT NULL,
	`dimension` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`geography` text DEFAULT '' NOT NULL,
	`target` real,
	`target_note` text DEFAULT '' NOT NULL,
	`frequency` text DEFAULT '' NOT NULL,
	`owner` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steward_indicators_place` ON `steward_indicators` (`place_id`);--> statement-breakpoint
CREATE TABLE `steward_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`indicator_id` text NOT NULL,
	`kind` text DEFAULT 'measurement' NOT NULL,
	`value` real NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text,
	`uncertainty` text DEFAULT '' NOT NULL,
	`evidence` text NOT NULL,
	`source_ref` text DEFAULT '' NOT NULL,
	`observed_by` text NOT NULL,
	`reviewer` text,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	`limitations` text DEFAULT '' NOT NULL,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steward_measurements_indicator` ON `steward_measurements` (`indicator_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `steward_place_geometries` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text NOT NULL,
	`geometry` text NOT NULL,
	`accuracy` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`area_ha` real,
	`note` text DEFAULT '' NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steward_place_geometries_place` ON `steward_place_geometries` (`place_id`);--> statement-breakpoint
CREATE TABLE `steward_place_links` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`relation` text DEFAULT 'other' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `steward_place_links_unique` ON `steward_place_links` (`place_id`,`entity_type`,`entity_id`,`relation`);--> statement-breakpoint
CREATE INDEX `steward_place_links_entity` ON `steward_place_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `steward_places` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`country` text,
	`region` text DEFAULT '' NOT NULL,
	`geometry` text,
	`geometry_accuracy` text DEFAULT 'unknown' NOT NULL,
	`area_ha` real,
	`status` text DEFAULT 'baseline_needed' NOT NULL,
	`watershed_note` text DEFAULT '' NOT NULL,
	`responsible` text,
	`sensitive` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steward_places_mandate` ON `steward_places` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `stewardship_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`place_id` text NOT NULL,
	`plan_id` text,
	`label` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`required` real DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stewardship_budgets_place` ON `stewardship_budgets` (`place_id`);--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `record_kind` text DEFAULT 'community_held' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `tradition` text DEFAULT 'indigenous_local' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `place_id` text;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `contributor` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `authority_evidence` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `permitted_purpose` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `permitted_users` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `review_date` text;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `compensation` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `benefit_sharing` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_records` ADD `translation_provenance` text DEFAULT '' NOT NULL;