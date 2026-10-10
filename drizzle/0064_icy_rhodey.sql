CREATE TABLE `change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`base_version_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scope_effect` text DEFAULT '' NOT NULL,
	`fee_impact` real DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`timeline_weeks` real DEFAULT 0 NOT NULL,
	`add_deliverables` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`requested_by` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`decision_evidence` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_requests_engagement` ON `change_requests` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `client_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`document_id` text,
	`response` text DEFAULT '' NOT NULL,
	`submitted_at` text,
	`submitted_by` text,
	`reviewed_at` text,
	`reviewed_by` text,
	`review_note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_requests_engagement` ON `client_requests` (`engagement_id`,`status`);--> statement-breakpoint
CREATE TABLE `delivery_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`service_key` text,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`milestones` text DEFAULT '[]' NOT NULL,
	`deliverables` text DEFAULT '[]' NOT NULL,
	`requests` text DEFAULT '[]' NOT NULL,
	`tasks` text DEFAULT '[]' NOT NULL,
	`qualification` text DEFAULT '[]' NOT NULL,
	`reporting_cadence` text DEFAULT '' NOT NULL,
	`seeded` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_templates_key` ON `delivery_templates` (`mandate_id`,`key`,`version`);--> statement-breakpoint
CREATE TABLE `engagement_deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`milestone_id` text,
	`label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner` text,
	`due_date` text,
	`depends_on` text,
	`inputs` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`client_review` integer DEFAULT true NOT NULL,
	`blocked_reason` text,
	`blocked_party` text,
	`document_id` text,
	`artifact_url` text,
	`version` integer DEFAULT 1 NOT NULL,
	`completion_evidence` text DEFAULT '' NOT NULL,
	`internal_done_at` text,
	`internal_done_by` text,
	`accepted_at` text,
	`accepted_by` text,
	`acceptance_note` text,
	`revision_note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `engagement_deliverables_engagement` ON `engagement_deliverables` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `engagement_deliverables_due` ON `engagement_deliverables` (`mandate_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `engagement_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`label` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`blocked_reason` text,
	`blocked_party` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `engagement_milestones_engagement` ON `engagement_milestones` (`engagement_id`,`sort`);--> statement-breakpoint
CREATE TABLE `offer_proposal_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`service_ids` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`deliverables` text DEFAULT '[]' NOT NULL,
	`assumptions` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`timeline` text DEFAULT '' NOT NULL,
	`responsibilities` text DEFAULT '' NOT NULL,
	`fee_structure` text DEFAULT 'fixed' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`fee` real,
	`monthly_fee` real,
	`months` integer,
	`hourly_rate` real,
	`estimated_hours` real,
	`payment_schedule` text DEFAULT '[]' NOT NULL,
	`valid_until` text,
	`template_id` text,
	`sent_at` text,
	`sent_by` text,
	`decided_at` text,
	`decided_by` text,
	`decision_evidence` text,
	`content_hash` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offer_proposal_versions_unique` ON `offer_proposal_versions` (`proposal_id`,`version`);--> statement-breakpoint
CREATE TABLE `offer_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`deal_id` text NOT NULL,
	`org_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`accepted_version_id` text,
	`contract_id` text,
	`engagement_id` text,
	`owner` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `offer_proposals_deal` ON `offer_proposals` (`deal_id`);--> statement-breakpoint
CREATE INDEX `offer_proposals_mandate` ON `offer_proposals` (`mandate_id`,`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`kind` text DEFAULT 'payment' NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`method` text DEFAULT 'bank_transfer' NOT NULL,
	`received_on` text NOT NULL,
	`evidence` text NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`provider_payment_id` text,
	`note` text DEFAULT '' NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_id` ON `payments` (`provider`,`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `payments_invoice` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `pipeline_stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`pipeline` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`override` integer DEFAULT false NOT NULL,
	`by` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pipeline_stage_history_entity` ON `pipeline_stage_history` (`entity_type`,`entity_id`,`at`);--> statement-breakpoint
CREATE TABLE `relationship_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`role` text NOT NULL,
	`basis` text DEFAULT 'stated' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`derived_from` text,
	`since` text,
	`until` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationship_roles_unique` ON `relationship_roles` (`mandate_id`,`entity_type`,`entity_id`,`role`);--> statement-breakpoint
CREATE INDEX `relationship_roles_role` ON `relationship_roles` (`mandate_id`,`role`);--> statement-breakpoint
CREATE TABLE `relationship_status` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`stage` text DEFAULT 'identified' NOT NULL,
	`owner` text,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`no_action_reason` text,
	`last_meaningful_at` text,
	`stage_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationship_status_entity` ON `relationship_status` (`mandate_id`,`entity_type`,`entity_id`);--> statement-breakpoint
ALTER TABLE `deals` ADD `commercial_stage` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `proposal_id` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `accepted_version_id` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `template_id` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `template_version` integer;--> statement-breakpoint
ALTER TABLE `services` ADD `problem` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `qualification_criteria` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `exclusions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `payment_options` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `offer_status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `offer_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `services` ADD `approved_at` text;