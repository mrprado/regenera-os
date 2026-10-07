CREATE TABLE `project_context_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`predicate` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`evidence_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `context_edges_project` ON `project_context_edges` (`mandate_id`,`project_id`);
--> statement-breakpoint
CREATE TABLE `project_context_records` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `context_project_kind` ON `project_context_records` (`mandate_id`,`project_id`,`kind`);
--> statement-breakpoint
CREATE TABLE `reporting_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`cadence` text NOT NULL,
	`state` text DEFAULT 'OPEN' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `reporting_project` ON `reporting_periods` (`mandate_id`,`project_id`);
--> statement-breakpoint
CREATE TABLE `reporting_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`approved_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `reporting_periods`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `reporting_snapshot_period` ON `reporting_snapshots` (`period_id`,`revision`);
--> statement-breakpoint
CREATE TRIGGER reporting_snapshot_immutable_update BEFORE UPDATE ON reporting_snapshots BEGIN SELECT RAISE(ABORT,'Reporting snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER reporting_snapshot_immutable_delete BEFORE DELETE ON reporting_snapshots BEGIN SELECT RAISE(ABORT,'Reporting snapshots are immutable'); END;
