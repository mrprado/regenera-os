CREATE TABLE `entity_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`scheme` text NOT NULL,
	`value` text NOT NULL,
	`normalized` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_aliases_identifier` ON `entity_aliases` (`mandate_id`,`scheme`,`normalized`);--> statement-breakpoint
CREATE INDEX `entity_aliases_entity` ON `entity_aliases` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`category` text NOT NULL,
	`manufacturer` text NOT NULL,
	`manufacturer_org_id` text,
	`model` text NOT NULL,
	`rating` real,
	`rating_unit` text,
	`country_of_origin` text,
	`certifications` text DEFAULT '' NOT NULL,
	`lead_time_weeks` integer,
	`warranty_years` real,
	`bankable` integer DEFAULT false NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `equipment_category` ON `equipment` (`mandate_id`,`category`);--> statement-breakpoint
CREATE TABLE `land_controls` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`parcel_ref` text DEFAULT '' NOT NULL,
	`area_ha` real,
	`control_type` text DEFAULT 'none' NOT NULL,
	`counterparty` text DEFAULT '' NOT NULL,
	`counterparty_org_id` text,
	`term_months` integer,
	`starts_on` text,
	`expires_on` text,
	`extension` text DEFAULT '' NOT NULL,
	`title_evidence` text DEFAULT 'none' NOT NULL,
	`encumbrances` integer,
	`rights_of_way` text DEFAULT 'unknown' NOT NULL,
	`water_rights` text DEFAULT 'unknown' NOT NULL,
	`mineral_rights` text DEFAULT 'unknown' NOT NULL,
	`legal_confidence` text DEFAULT 'low' NOT NULL,
	`document_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `land_controls_project` ON `land_controls` (`mandate_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `ontology_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`org_id` text NOT NULL,
	`met` text DEFAULT '[]' NOT NULL,
	`failed` text DEFAULT '[]' NOT NULL,
	`unknown` text DEFAULT '[]' NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`decided_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ontology_matches_unique` ON `ontology_matches` (`project_id`,`kind`,`org_id`);--> statement-breakpoint
CREATE TABLE `permit_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`permit_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permit_dependencies_unique` ON `permit_dependencies` (`permit_id`,`depends_on_id`);--> statement-breakpoint
CREATE TABLE `project_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`quantity` real,
	`status` text DEFAULT 'considered' NOT NULL,
	`price` real,
	`currency` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_equipment_project` ON `project_equipment` (`mandate_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_queue_links` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`queue_key` text NOT NULL,
	`relation` text DEFAULT 'own_position' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_queue_links_unique` ON `project_queue_links` (`project_id`,`queue_key`);--> statement-breakpoint
CREATE TABLE `sanctions_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`result` text NOT NULL,
	`matches` text DEFAULT '[]' NOT NULL,
	`lists_checked` text DEFAULT '[]' NOT NULL,
	`review` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_note` text DEFAULT '' NOT NULL,
	`checked_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sanctions_checks_entity` ON `sanctions_checks` (`mandate_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sanctions_lists` (
	`list` text NOT NULL,
	`part` integer NOT NULL,
	`entries` text NOT NULL,
	`entry_count` integer NOT NULL,
	`source_date` text,
	`refreshed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sanctions_lists_part` ON `sanctions_lists` (`list`,`part`);--> statement-breakpoint
CREATE TABLE `stakeholders` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`org_id` text,
	`contact_id` text,
	`community_id` text,
	`relationship` text DEFAULT '' NOT NULL,
	`influence` text DEFAULT 'medium' NOT NULL,
	`interest` text DEFAULT 'medium' NOT NULL,
	`position` text DEFAULT 'unknown' NOT NULL,
	`consent_required` integer DEFAULT false NOT NULL,
	`consultation_required` integer DEFAULT false NOT NULL,
	`commitments` text DEFAULT '' NOT NULL,
	`last_engagement_at` text,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stakeholders_project` ON `stakeholders` (`mandate_id`,`project_id`);--> statement-breakpoint
ALTER TABLE `relationship_edges` ADD `valid_from` text;--> statement-breakpoint
ALTER TABLE `relationship_edges` ADD `valid_to` text;--> statement-breakpoint
ALTER TABLE `relationship_edges` ADD `evidence_claim_id` text;