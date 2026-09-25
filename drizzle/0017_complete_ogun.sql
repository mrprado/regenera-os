CREATE TABLE `bids` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`bidder` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`price` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`schedule_weeks` real,
	`lead_time_weeks` real,
	`warranty_years` real,
	`liquidated_damages` text DEFAULT '' NOT NULL,
	`origin_country` text,
	`factory` text,
	`incoterms` text,
	`port` text,
	`local_content_pct` real,
	`financing_support` text DEFAULT '' NOT NULL,
	`scores` text DEFAULT '{}' NOT NULL,
	`exceptions` text DEFAULT '' NOT NULL,
	`submitted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `procurement_packages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bids_package` ON `bids` (`package_id`);--> statement-breakpoint
CREATE TABLE `boq_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`package_id` text,
	`material` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`quantity` real,
	`unit` text,
	`manufacturer` text,
	`supplier` text,
	`origin` text,
	`distance_km` real,
	`transport_mode` text,
	`unit_cost` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`lead_time_weeks` real,
	`recycled_pct` real,
	`biobased_pct` real,
	`epd_id` text,
	`service_life_years` real,
	`circularity` text DEFAULT 'unknown' NOT NULL,
	`design_for_disassembly` integer DEFAULT false NOT NULL,
	`end_of_life` text DEFAULT '' NOT NULL,
	`hazards` text DEFAULT '' NOT NULL,
	`certification` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `boq_items_project` ON `boq_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `epds` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`manufacturer` text NOT NULL,
	`product` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`program_operator` text DEFAULT '' NOT NULL,
	`registration_number` text DEFAULT '' NOT NULL,
	`pcr` text DEFAULT '' NOT NULL,
	`geography` text DEFAULT '' NOT NULL,
	`declared_unit` text NOT NULL,
	`gwp` text DEFAULT '{}' NOT NULL,
	`valid_from` text,
	`valid_until` text,
	`verified` integer DEFAULT false NOT NULL,
	`verifier` text,
	`url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `epds_mandate` ON `epds` (`mandate_id`,`category`);--> statement-breakpoint
CREATE TABLE `network_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`asset_classes` text DEFAULT '[]' NOT NULL,
	`technologies` text DEFAULT '' NOT NULL,
	`jurisdictions` text DEFAULT '[]' NOT NULL,
	`min_project_size` real,
	`max_project_size` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`completed_assets` integer,
	`track_record` text DEFAULT '' NOT NULL,
	`bonding` text DEFAULT '' NOT NULL,
	`insurance` text DEFAULT '' NOT NULL,
	`balance_sheet` text DEFAULT '' NOT NULL,
	`warranty` text DEFAULT '' NOT NULL,
	`bankable` integer DEFAULT false NOT NULL,
	`references` text DEFAULT '' NOT NULL,
	`performance` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `network_profiles_mandate` ON `network_profiles` (`mandate_id`);--> statement-breakpoint
CREATE INDEX `network_profiles_org` ON `network_profiles` (`org_id`);--> statement-breakpoint
CREATE TABLE `procurement_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'need' NOT NULL,
	`budget` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`bids_due_at` text,
	`award_target_at` text,
	`required_on_site_at` text,
	`es_requirements` text DEFAULT '' NOT NULL,
	`local_content_target_pct` real,
	`weights` text DEFAULT '{}' NOT NULL,
	`awarded_bid_id` text,
	`contract_id` text,
	`owner` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `procurement_packages_project` ON `procurement_packages` (`project_id`);--> statement-breakpoint
CREATE INDEX `procurement_packages_due` ON `procurement_packages` (`mandate_id`,`stage`,`bids_due_at`);