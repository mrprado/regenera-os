CREATE TABLE `interventions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`assessment_id` text,
	`system_issue` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`implementation_type` text DEFAULT 'other' NOT NULL,
	`cost_estimate` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`cost_basis` text DEFAULT '' NOT NULL,
	`expected_outcome` text DEFAULT '' NOT NULL,
	`financial_relevance` text DEFAULT '' NOT NULL,
	`risk_reduction` text DEFAULT '' NOT NULL,
	`risk_id` text,
	`funding_pathway` text DEFAULT '' NOT NULL,
	`capital_requirement_id` text,
	`partner_org_id` text,
	`evidence` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `interventions_project` ON `interventions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `system_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`category` text NOT NULL,
	`baseline` text DEFAULT '' NOT NULL,
	`dependencies` text DEFAULT '' NOT NULL,
	`impacts` text DEFAULT '' NOT NULL,
	`thresholds` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`opportunities` text DEFAULT '' NOT NULL,
	`future_state` text DEFAULT '' NOT NULL,
	`capacity` text DEFAULT 'unknown' NOT NULL,
	`implications` text DEFAULT '{}' NOT NULL,
	`frameworks` text DEFAULT '[]' NOT NULL,
	`sources` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`reviewer` text,
	`reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `system_assessments_project` ON `system_assessments` (`project_id`,`category`);