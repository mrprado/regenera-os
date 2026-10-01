CREATE TABLE `allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`member_id` text NOT NULL,
	`week_start` text NOT NULL,
	`hours` real NOT NULL,
	`kind` text DEFAULT 'client' NOT NULL,
	`engagement_id` text,
	`application_id` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `allocations_week` ON `allocations` (`mandate_id`,`week_start`);--> statement-breakpoint
CREATE INDEX `allocations_member` ON `allocations` (`member_id`);--> statement-breakpoint
CREATE TABLE `application_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`application_id` text NOT NULL,
	`tab` text DEFAULT 'overview' NOT NULL,
	`title` text NOT NULL,
	`role` text,
	`owner` text,
	`reviewer` text,
	`due` text,
	`depends_on` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`hours_budget` real DEFAULT 0 NOT NULL,
	`hours_actual` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `application_tasks_app` ON `application_tasks` (`application_id`);--> statement-breakpoint
CREATE TABLE `bid_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`prospect_id` text,
	`applicant_org_id` text,
	`strategic_fit` text DEFAULT '' NOT NULL,
	`eligibility` text DEFAULT 'uncertain' NOT NULL,
	`readiness_summary` text DEFAULT '' NOT NULL,
	`deadline` text,
	`hours` real DEFAULT 0 NOT NULL,
	`specialists` text DEFAULT '[]' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`fee_basis` text DEFAULT 'fixed' NOT NULL,
	`delivery_cost` real DEFAULT 0 NOT NULL,
	`cost_lines` text DEFAULT '[]' NOT NULL,
	`relationship_value` text DEFAULT '' NOT NULL,
	`cross_sell` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`opportunity_cost` text DEFAULT '' NOT NULL,
	`decision` text,
	`conditions` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`senior_approval_required` integer DEFAULT false NOT NULL,
	`approved_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bid_reviews_opp` ON `bid_reviews` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `consortium_members` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`application_id` text NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`role` text DEFAULT 'partner' NOT NULL,
	`eligibility` text DEFAULT 'uncertain' NOT NULL,
	`capability` text DEFAULT '' NOT NULL,
	`contribution` text DEFAULT '' NOT NULL,
	`budget` real,
	`documents` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'prospective' NOT NULL,
	`contact_id` text,
	`owner` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `consortium_members_app` ON `consortium_members` (`application_id`);--> statement-breakpoint
CREATE TABLE `expansion_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`engagement_id` text,
	`application_id` text,
	`kind` text NOT NULL,
	`relevance` text NOT NULL,
	`estimated_value` real,
	`status` text DEFAULT 'identified' NOT NULL,
	`owner` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `expansion_org` ON `expansion_opportunities` (`org_id`);--> statement-breakpoint
CREATE TABLE `funders` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`org_id` text,
	`programs` text DEFAULT '[]' NOT NULL,
	`sectors` text DEFAULT '[]' NOT NULL,
	`geography` text DEFAULT '[]' NOT NULL,
	`applicant_types` text DEFAULT '[]' NOT NULL,
	`typical_award` text DEFAULT '' NOT NULL,
	`history` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funders_name` ON `funders` (`mandate_id`,`name`);--> statement-breakpoint
CREATE TABLE `funding_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`name` text NOT NULL,
	`lead_org_id` text,
	`project_id` text,
	`engagement_id` text,
	`deal_id` text,
	`bid_review_id` text,
	`state` text DEFAULT 'first_draft' NOT NULL,
	`owner` text,
	`team` text DEFAULT '[]' NOT NULL,
	`requested_amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`match_amount` real,
	`scoring` text DEFAULT '[]' NOT NULL,
	`compliance` text DEFAULT '[]' NOT NULL,
	`narrative` text DEFAULT '[]' NOT NULL,
	`budget_lines` text DEFAULT '[]' NOT NULL,
	`review_log` text DEFAULT '[]' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`submission` text DEFAULT '{}' NOT NULL,
	`internal_deadline` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `funding_applications_opp` ON `funding_applications` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `funding_applications_state` ON `funding_applications` (`mandate_id`,`state`);--> statement-breakpoint
CREATE TABLE `funding_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`application_id` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`agreement_ref` text DEFAULT '' NOT NULL,
	`period_start` text,
	`period_end` text,
	`reporting` text DEFAULT '[]' NOT NULL,
	`milestones` text DEFAULT '[]' NOT NULL,
	`kpis` text DEFAULT '[]' NOT NULL,
	`payments` text DEFAULT '[]' NOT NULL,
	`conditions` text DEFAULT '' NOT NULL,
	`cofinance` text DEFAULT '' NOT NULL,
	`compliance` text DEFAULT '' NOT NULL,
	`post_award_engagement_id` text,
	`pathway_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_awards_app` ON `funding_awards` (`application_id`);--> statement-breakpoint
CREATE TABLE `funding_dates` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text,
	`application_id` text,
	`award_id` text,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`internal` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `funding_dates_date` ON `funding_dates` (`mandate_id`,`date`);--> statement-breakpoint
CREATE TABLE `funding_prospects` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`org_id` text NOT NULL,
	`origin` text DEFAULT 'crm' NOT NULL,
	`mode` text DEFAULT 'funding_first' NOT NULL,
	`stage` text DEFAULT 'target' NOT NULL,
	`eligibility` text DEFAULT 'uncertain' NOT NULL,
	`eligibility_basis` text DEFAULT '' NOT NULL,
	`sector_fit` text DEFAULT '' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`missing` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`source_url` text,
	`decision_maker_id` text,
	`owner` text,
	`project_id` text,
	`engagement_id` text,
	`research_brief` text DEFAULT '' NOT NULL,
	`follow_up_date` text,
	`lost_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_prospects_pair` ON `funding_prospects` (`opportunity_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `funding_prospects_stage` ON `funding_prospects` (`mandate_id`,`stage`);--> statement-breakpoint
CREATE TABLE `funding_readiness` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`org_id` text,
	`project_id` text,
	`prospect_id` text,
	`cells` text DEFAULT '{}' NOT NULL,
	`assessed_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `funding_readiness_opp` ON `funding_readiness` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `org_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`expires` text,
	`evidence` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_registrations_kind` ON `org_registrations` (`org_id`,`kind`);--> statement-breakpoint
CREATE TABLE `practice_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`tier` text DEFAULT 'custom' NOT NULL,
	`inputs` text DEFAULT '{}' NOT NULL,
	`illustrative` integer DEFAULT true NOT NULL,
	`designated_by` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `specialists` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`expertise` text DEFAULT '[]' NOT NULL,
	`sectors` text DEFAULT '[]' NOT NULL,
	`sub_sectors` text DEFAULT '[]' NOT NULL,
	`geographies` text DEFAULT '[]' NOT NULL,
	`countries` text DEFAULT '[]' NOT NULL,
	`languages` text DEFAULT '[]' NOT NULL,
	`credentials` text DEFAULT '' NOT NULL,
	`hourly_rate` real,
	`day_rate` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`availability` text DEFAULT '' NOT NULL,
	`nda_status` text DEFAULT 'none' NOT NULL,
	`conflict_status` text DEFAULT 'unchecked' NOT NULL,
	`prior_engagements` text DEFAULT '[]' NOT NULL,
	`performance_notes` text DEFAULT '' NOT NULL,
	`rating` integer,
	`engagement_model` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'other' NOT NULL,
	`source_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `specialists_mandate` ON `specialists` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'analyst' NOT NULL,
	`employment` text DEFAULT 'contractor' NOT NULL,
	`cost_rate` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`salary` real,
	`weekly_hours` real DEFAULT 40 NOT NULL,
	`utilization_target` real DEFAULT 75 NOT NULL,
	`leave` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_members_mandate` ON `team_members` (`mandate_id`);--> statement-breakpoint
ALTER TABLE `bid_library` ADD `sectors` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `bid_library` ADD `funder` text;--> statement-breakpoint
ALTER TABLE `bid_library` ADD `program` text;--> statement-breakpoint
ALTER TABLE `bid_library` ADD `geography` text;--> statement-breakpoint
ALTER TABLE `bid_library` ADD `client_org_id` text;--> statement-breakpoint
ALTER TABLE `bid_library` ADD `approved` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `bid_library` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `bid_library` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `opportunity_code` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `rolling` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `award_period` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `program_size` real;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `expected_award` real;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `number_awards` integer;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `match_requirement` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `reimbursement` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `eligible_costs` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `prohibited_costs` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `details` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `applicant_profile` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `next_action` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `next_action_date` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `territory` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `retrieved_at` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `verified_by` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `verified_at` text;--> statement-breakpoint
ALTER TABLE `funding_opportunities` ADD `extraction_confidence` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `funding_line` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `origin_opportunity_id` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `fee_basis` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `budget_lines` text DEFAULT '[]' NOT NULL;