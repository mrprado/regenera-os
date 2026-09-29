CREATE TABLE `capital_stack_layers` (
	`id` text PRIMARY KEY NOT NULL,
	`structure_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`layer` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`provider_org_id` text,
	`requirement_id` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`amount` real,
	`pricing` text DEFAULT '' NOT NULL,
	`rate_pct` real,
	`tenor_years` real,
	`amortization` text DEFAULT '' NOT NULL,
	`security` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'assumption' NOT NULL,
	`conditions` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`assumption_status` text DEFAULT 'assumption' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`structure_id`) REFERENCES `capital_structures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capital_stack_layers_structure` ON `capital_stack_layers` (`structure_id`);--> statement-breakpoint
CREATE TABLE `capital_structures` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`based_on_id` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`total_cost` real,
	`cost_source` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`review_status` text DEFAULT 'not_reviewed' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capital_structures_project` ON `capital_structures` (`project_id`);--> statement-breakpoint
CREATE TABLE `funding_pathways` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`provider_org_id` text,
	`funding_opportunity_id` text,
	`capital_profile_id` text,
	`requirement_id` text,
	`structure_layer_id` text,
	`amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'identified' NOT NULL,
	`eligibility` text DEFAULT 'unknown' NOT NULL,
	`eligibility_notes` text DEFAULT '' NOT NULL,
	`eligibility_source` text DEFAULT '' NOT NULL,
	`deadline` text,
	`steps` text DEFAULT '[]' NOT NULL,
	`owner` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `funding_pathways_project` ON `funding_pathways` (`project_id`);--> statement-breakpoint
CREATE INDEX `funding_pathways_deadline` ON `funding_pathways` (`mandate_id`,`deadline`);