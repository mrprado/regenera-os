CREATE TABLE `asset_horizons` (
	`project_id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`development` integer,
	`financing` integer,
	`operating` integer,
	`stewardship` integer,
	`stewardship_plan` text DEFAULT '' NOT NULL,
	`steward` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cert_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`certification_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`title` text NOT NULL,
	`version` text DEFAULT '1' NOT NULL,
	`doc_date` text,
	`period_id` text,
	`document_id` text,
	`url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cert_documents_cert` ON `cert_documents` (`certification_id`);--> statement-breakpoint
CREATE TABLE `certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`standard` text NOT NULL,
	`secondary_standards` text DEFAULT '[]' NOT NULL,
	`methodology` text DEFAULT '' NOT NULL,
	`registry_id` text,
	`registry_url` text,
	`unit_type` text DEFAULT 'carbon' NOT NULL,
	`stage` text DEFAULT 'feasibility' NOT NULL,
	`crediting_start` text,
	`crediting_end` text,
	`lifetime_years` integer,
	`validation_body` text DEFAULT '' NOT NULL,
	`verification_body` text DEFAULT '' NOT NULL,
	`baseline` text DEFAULT '' NOT NULL,
	`next_verification` text,
	`permanence` text DEFAULT '[]' NOT NULL,
	`permanence_source` text DEFAULT '' NOT NULL,
	`buffer_pct` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `certifications_project` ON `certifications` (`project_id`);--> statement-breakpoint
CREATE TABLE `credit_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`certification_id` text NOT NULL,
	`period_id` text,
	`vintage` text NOT NULL,
	`quantity` real NOT NULL,
	`status` text DEFAULT 'forecast' NOT NULL,
	`serial_start` text,
	`serial_end` text,
	`price` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`buyer_org_id` text,
	`offtake_id` text,
	`delivered_date` text,
	`retired_date` text,
	`retirement_beneficiary` text,
	`history` text DEFAULT '[]' NOT NULL,
	`parent_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credit_lots_cert` ON `credit_lots` (`certification_id`,`status`);--> statement-breakpoint
CREATE TABLE `ecological_designs` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`intervention` text NOT NULL,
	`climate_scenario` text DEFAULT '' NOT NULL,
	`site_factors` text DEFAULT '{}' NOT NULL,
	`mix` text DEFAULT '[]' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`local_knowledge` text DEFAULT '' NOT NULL,
	`cost_per_ha` real,
	`status` text DEFAULT 'draft' NOT NULL,
	`reviewed_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ecological_designs_project` ON `ecological_designs` (`project_id`);--> statement-breakpoint
CREATE TABLE `env_offtakes` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`certification_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'prospect' NOT NULL,
	`buyer_org_id` text,
	`buyer_name` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'tCO2e' NOT NULL,
	`schedule` text DEFAULT '[]' NOT NULL,
	`price` real,
	`floor_price` real,
	`escalation_pct` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`prepayment` real,
	`development_funding` real,
	`performance_conditions` text DEFAULT '' NOT NULL,
	`certification_dependent` integer DEFAULT true NOT NULL,
	`replacement_obligation` text DEFAULT '' NOT NULL,
	`counterparty_risk` text DEFAULT '' NOT NULL,
	`contract_id` text,
	`signed_date` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `env_offtakes_project` ON `env_offtakes` (`project_id`);--> statement-breakpoint
CREATE TABLE `land_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`stage` text DEFAULT 'identified' NOT NULL,
	`country` text,
	`subdivision` text,
	`lat` real,
	`lng` real,
	`geometry` text,
	`hectares` real,
	`asking_price` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`tenure` text DEFAULT 'unclear' NOT NULL,
	`seller` text DEFAULT '' NOT NULL,
	`seller_org_id` text,
	`title_status` text DEFAULT '' NOT NULL,
	`ecosystem_condition` text DEFAULT '' NOT NULL,
	`suitability` text DEFAULT '' NOT NULL,
	`option_status` text DEFAULT '' NOT NULL,
	`option_expiry` text,
	`probability_pct` real,
	`intervention` text,
	`capital_required` real,
	`source` text DEFAULT '' NOT NULL,
	`diligence` text DEFAULT '[]' NOT NULL,
	`site_baseline` text,
	`drop_reason` text,
	`project_id` text,
	`owner` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `land_candidates_stage` ON `land_candidates` (`mandate_id`,`stage`);--> statement-breakpoint
CREATE TABLE `monitoring_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`certification_id` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`estimated_units` real,
	`verified_units` real,
	`buffer_units` real,
	`issued_units` real,
	`verifier` text DEFAULT '' NOT NULL,
	`report_date` text,
	`verified_date` text,
	`issuance_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `monitoring_periods_cert` ON `monitoring_periods` (`certification_id`);--> statement-breakpoint
CREATE TABLE `nurseries` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`project_id` text,
	`org_id` text,
	`location` text DEFAULT '' NOT NULL,
	`capacity_per_year` integer,
	`own_operated` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planting_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`species_id` text NOT NULL,
	`nursery_id` text,
	`provenance` text DEFAULT '' NOT NULL,
	`quantity` integer NOT NULL,
	`area_ha` real,
	`season` text DEFAULT '' NOT NULL,
	`planted_date` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`unit_cost` real,
	`establishment_cost_per_ha` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`crew` text DEFAULT '' NOT NULL,
	`survival` text DEFAULT '[]' NOT NULL,
	`replacement_qty` integer DEFAULT 0 NOT NULL,
	`maintenance_cycle` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planting_batches_project` ON `planting_batches` (`project_id`);--> statement-breakpoint
CREATE TABLE `risk_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'identified' NOT NULL,
	`provider_org_id` text,
	`provider` text DEFAULT '' NOT NULL,
	`coverage` real,
	`premium` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`start` text,
	`end` text,
	`covers` text DEFAULT '' NOT NULL,
	`bankability_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `risk_transfers_project` ON `risk_transfers` (`project_id`);--> statement-breakpoint
CREATE TABLE `species` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`scientific_name` text NOT NULL,
	`common_name` text DEFAULT '' NOT NULL,
	`functional_group` text DEFAULT 'other' NOT NULL,
	`native` text DEFAULT '' NOT NULL,
	`climate_tolerance` text DEFAULT '' NOT NULL,
	`soils` text DEFAULT '' NOT NULL,
	`uses` text DEFAULT '' NOT NULL,
	`rotation_years` integer,
	`source` text DEFAULT '' NOT NULL,
	`gbif_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `species_mandate` ON `species` (`mandate_id`,`scientific_name`);--> statement-breakpoint
CREATE TABLE `structure_links` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`kind` text NOT NULL,
	`pct` real,
	`amount` real,
	`currency` text,
	`description` text DEFAULT '' NOT NULL,
	`contract_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `structure_links_project` ON `structure_links` (`project_id`);--> statement-breakpoint
CREATE TABLE `structure_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`jurisdiction` text,
	`entity_id` text,
	`org_id` text,
	`responsibilities` text DEFAULT '' NOT NULL,
	`liabilities` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `structure_nodes_project` ON `structure_nodes` (`project_id`);