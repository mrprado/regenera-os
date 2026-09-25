CREATE TABLE `integrations` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`dataset` text NOT NULL,
	`category` text NOT NULL,
	`coverage` text DEFAULT '' NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`auth` text DEFAULT 'none' NOT NULL,
	`env_var` text,
	`license` text NOT NULL,
	`license_url` text,
	`commercial_use` text NOT NULL,
	`attribution` text DEFAULT '' NOT NULL,
	`caching` text DEFAULT '' NOT NULL,
	`redistribution` text DEFAULT '' NOT NULL,
	`rate_limit` text DEFAULT '' NOT NULL,
	`refresh` text DEFAULT '' NOT NULL,
	`feature_state` text NOT NULL,
	`state_overridden` integer DEFAULT false NOT NULL,
	`source_tier` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `place_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`dimension` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`numeric` real,
	`unit` text,
	`integration_key` text NOT NULL,
	`source_url` text,
	`tier` integer NOT NULL,
	`state` text DEFAULT 'api_derived' NOT NULL,
	`license` text,
	`observed_for` text,
	`retrieved_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `place_facts_unique` ON `place_facts` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `place_facts_project` ON `place_facts` (`project_id`,`dimension`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`organization` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`document_id` text,
	`tier` integer NOT NULL,
	`published_at` text,
	`retrieved_at` text,
	`effective_at` text,
	`expires_at` text,
	`jurisdiction` text,
	`license` text,
	`integration_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_integration` ON `sources` (`integration_key`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`source_id` text,
	`state` text NOT NULL,
	`confidence` text,
	`value` text,
	`verified_by` text,
	`verified_at` text,
	`next_verification` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_entity` ON `verifications` (`entity`,`entity_id`,`field`);