DROP INDEX reporting_snapshot_period;
--> statement-breakpoint
CREATE UNIQUE INDEX reporting_snapshot_period ON reporting_snapshots(period_id,revision);
