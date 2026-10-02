ALTER TABLE `engagements` ADD `price_override_reason` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `price_override_by` text;--> statement-breakpoint
ALTER TABLE `engagements` ADD `price_override_at` text;--> statement-breakpoint
ALTER TABLE `commercial_mandates` ADD `pilot_days` integer;--> statement-breakpoint
ALTER TABLE `commercial_mandates` ADD `pilot_start` text;--> statement-breakpoint
ALTER TABLE `commercial_mandates` ADD `pilot_end` text;--> statement-breakpoint
ALTER TABLE `commercial_mandates` ADD `retainer_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `commercial_mandates` ADD `retainer_approved_by` text;--> statement-breakpoint
ALTER TABLE `commercial_mandates` ADD `retainer_approved_at` text;--> statement-breakpoint
ALTER TABLE `commercial_mandates` ADD `target_margin_pct` real DEFAULT 55 NOT NULL;--> statement-breakpoint
-- Existing retainers: an active mandate's retainer was already counted as contracted revenue, so it stays active; on any
-- other status it is a proposal and is no longer counted as recurring revenue until someone approves it.
UPDATE `commercial_mandates` SET `retainer_status` = 'active' WHERE `retainer` > 0 AND `status` = 'active';--> statement-breakpoint
UPDATE `commercial_mandates` SET `retainer_status` = 'proposed' WHERE `retainer` > 0 AND `status` <> 'active';
