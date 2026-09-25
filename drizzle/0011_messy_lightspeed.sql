CREATE TABLE `capital_mandates` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`geographies` text DEFAULT '[]' NOT NULL,
	`sectors` text DEFAULT '[]' NOT NULL,
	`stages` text DEFAULT '[]' NOT NULL,
	`instruments` text DEFAULT '[]' NOT NULL,
	`ticket_min` real,
	`ticket_max` real,
	`currency` text,
	`valid_from` text,
	`valid_to` text,
	`active` integer DEFAULT true NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`last_verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `capital_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capital_mandates_profile` ON `capital_mandates` (`profile_id`);--> statement-breakpoint
CREATE TABLE `capital_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`investor_key` text NOT NULL,
	`capital_profile_id` text,
	`private_profile_id` text,
	`commercial_score` integer NOT NULL,
	`commercial_reasons` text NOT NULL,
	`eligibility` text NOT NULL,
	`eligibility_reasons` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `capital_opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capital_matches_unique` ON `capital_matches` (`opportunity_id`,`investor_key`);--> statement-breakpoint
CREATE TABLE `capital_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text,
	`tranche_id` text,
	`title` text NOT NULL,
	`instrument` text NOT NULL,
	`target` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`offering` text DEFAULT '' NOT NULL,
	`jurisdictions` text DEFAULT '[]' NOT NULL,
	`issuer_org_id` text,
	`sponsor_org_id` text,
	`arranger` text DEFAULT '' NOT NULL,
	`placement_party` text DEFAULT '' NOT NULL,
	`counsel` text DEFAULT '' NOT NULL,
	`financial_advisor` text DEFAULT '' NOT NULL,
	`regenera_role` text DEFAULT 'Not a party to the offering' NOT NULL,
	`gate_state` text DEFAULT 'review_required' NOT NULL,
	`gate_reviewer` text,
	`gate_reviewed_at` text,
	`gate_evidence` text DEFAULT '' NOT NULL,
	`gate_conditions` text DEFAULT '' NOT NULL,
	`approved_materials` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capital_opportunities_project` ON `capital_opportunities` (`project_id`);--> statement-breakpoint
CREATE TABLE `capital_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`contact_id` text,
	`name` text NOT NULL,
	`capital_type` text NOT NULL,
	`geographies` text DEFAULT '[]' NOT NULL,
	`sectors` text DEFAULT '[]' NOT NULL,
	`stages` text DEFAULT '[]' NOT NULL,
	`instruments` text DEFAULT '[]' NOT NULL,
	`ticket_min` real,
	`ticket_max` real,
	`currency` text,
	`technologies` text DEFAULT '[]' NOT NULL,
	`risk` text DEFAULT '' NOT NULL,
	`return_target` text DEFAULT '' NOT NULL,
	`tenor` text DEFAULT '' NOT NULL,
	`impact` text DEFAULT '' NOT NULL,
	`es_requirements` text DEFAULT '' NOT NULL,
	`local_content` text DEFAULT '' NOT NULL,
	`relationship_owner` text,
	`relationship_strength` text DEFAULT 'unknown' NOT NULL,
	`next_action` text,
	`next_action_date` text,
	`source` text DEFAULT '' NOT NULL,
	`last_verified_at` text,
	`notes` text DEFAULT '' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capital_profiles_mandate` ON `capital_profiles` (`mandate_id`,`capital_type`);--> statement-breakpoint
CREATE INDEX `capital_profiles_org` ON `capital_profiles` (`org_id`);--> statement-breakpoint
CREATE TABLE `commitment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`commitment_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`stage` text NOT NULL,
	`amount` real,
	`evidence` text DEFAULT '' NOT NULL,
	`actor` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`commitment_id`) REFERENCES `commitments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `commitment_events_commitment` ON `commitment_events` (`commitment_id`,`at`);--> statement-breakpoint
CREATE TABLE `commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`investor_key` text NOT NULL,
	`capital_profile_id` text,
	`private_profile_id` text,
	`stage` text NOT NULL,
	`amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `capital_opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commitments_unique` ON `commitments` (`opportunity_id`,`investor_key`);--> statement-breakpoint
CREATE TABLE `debt_securities` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text,
	`issuer_org_id` text,
	`program` text NOT NULL,
	`instrument` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`principal` real,
	`issue_size` real,
	`min_denomination` real,
	`coupon` text DEFAULT '' NOT NULL,
	`coupon_type` text DEFAULT '' NOT NULL,
	`maturity` text,
	`frequency` text DEFAULT '' NOT NULL,
	`seniority` text DEFAULT '' NOT NULL,
	`security` text DEFAULT '' NOT NULL,
	`guarantee` text DEFAULT '' NOT NULL,
	`use_of_proceeds` text DEFAULT '' NOT NULL,
	`isin` text,
	`venue` text DEFAULT '' NOT NULL,
	`trustee` text DEFAULT '' NOT NULL,
	`paying_agent` text DEFAULT '' NOT NULL,
	`arranger` text DEFAULT '' NOT NULL,
	`placement_agent` text DEFAULT '' NOT NULL,
	`counsel` text DEFAULT '' NOT NULL,
	`jurisdictions` text DEFAULT '[]' NOT NULL,
	`offering_restrictions` text DEFAULT '' NOT NULL,
	`eligible_recipients` text DEFAULT '' NOT NULL,
	`offering_documents` text DEFAULT '' NOT NULL,
	`risk_disclosures` text DEFAULT '' NOT NULL,
	`subscription_process` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `introductions` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`from_contact_id` text NOT NULL,
	`to_contact_id` text,
	`to_org_id` text,
	`date` text,
	`context` text DEFAULT '' NOT NULL,
	`project_id` text,
	`opportunity_id` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`compensation` integer DEFAULT false NOT NULL,
	`review_status` text DEFAULT 'not_required' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `introductions_from` ON `introductions` (`from_contact_id`);--> statement-breakpoint
CREATE INDEX `introductions_to` ON `introductions` (`to_contact_id`);--> statement-breakpoint
CREATE TABLE `investor_qualifications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`jurisdiction` text NOT NULL,
	`classification` text NOT NULL,
	`definition_version` text DEFAULT '' NOT NULL,
	`assessment_status` text DEFAULT '' NOT NULL,
	`verification_status` text DEFAULT 'unknown' NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`verified_by` text,
	`verified_at` text,
	`expires_at` text,
	`evidence_ref` text DEFAULT '' NOT NULL,
	`restrictions` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `investor_qualifications_contact` ON `investor_qualifications` (`contact_id`);--> statement-breakpoint
CREATE INDEX `investor_qualifications_org` ON `investor_qualifications` (`org_id`);--> statement-breakpoint
CREATE TABLE `material_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`investor_key` text NOT NULL,
	`contact_id` text,
	`document` text NOT NULL,
	`version` text NOT NULL,
	`channel` text NOT NULL,
	`sent_by` text,
	`sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`approval_ref` text DEFAULT '' NOT NULL,
	`message_id` text,
	`acknowledged_at` text
);
--> statement-breakpoint
CREATE INDEX `material_deliveries_opportunity` ON `material_deliveries` (`opportunity_id`,`investor_key`);--> statement-breakpoint
CREATE TABLE `private_capital_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`vehicle_org_id` text,
	`family_office_org_id` text,
	`relationship_owner` text,
	`relationship_source` text DEFAULT '' NOT NULL,
	`relationship_strength` text DEFAULT 'unknown' NOT NULL,
	`introducer_contact_id` text,
	`primary_jurisdiction` text,
	`vehicle_jurisdiction` text,
	`preferred_channel` text,
	`geographies` text DEFAULT '[]' NOT NULL,
	`sectors` text DEFAULT '[]' NOT NULL,
	`stages` text DEFAULT '[]' NOT NULL,
	`instruments` text DEFAULT '[]' NOT NULL,
	`ticket_min` real,
	`ticket_max` real,
	`currency` text,
	`asset_classes` text DEFAULT '[]' NOT NULL,
	`horizon` text DEFAULT '' NOT NULL,
	`income_preference` text DEFAULT 'unknown' NOT NULL,
	`growth_preference` text DEFAULT 'unknown' NOT NULL,
	`impact_interests` text DEFAULT '' NOT NULL,
	`development_appetite` text DEFAULT 'unknown' NOT NULL,
	`construction_appetite` text DEFAULT 'unknown' NOT NULL,
	`operating_appetite` text DEFAULT 'unknown' NOT NULL,
	`known_risk_appetite` text DEFAULT '' NOT NULL,
	`constraints` text DEFAULT '' NOT NULL,
	`private_notes` text DEFAULT '' NOT NULL,
	`journey_stage` text DEFAULT 'identified' NOT NULL,
	`last_interaction_at` text,
	`next_action` text,
	`next_action_date` text,
	`last_verified_at` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_capital_profiles_contact` ON `private_capital_profiles` (`mandate_id`,`contact_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `capital_opportunity_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `outreach_type` text DEFAULT 'relationship' NOT NULL;