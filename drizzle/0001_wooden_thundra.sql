CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`deal_id` text,
	`type` text NOT NULL,
	`method` text,
	`detail` text DEFAULT '' NOT NULL,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`actor` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activities_mandate_contact` ON `activities` (`mandate_id`,`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `activities_mandate_org` ON `activities` (`mandate_id`,`org_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `activities_mandate_deal` ON `activities` (`mandate_id`,`deal_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_key` text NOT NULL,
	`prompt_version` integer NOT NULL,
	`model` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`web_searches` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_runs_created` ON `ai_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`full_name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`title` text,
	`seniority` text,
	`email` text,
	`email_lower` text,
	`email_status` text DEFAULT 'unknown' NOT NULL,
	`linkedin_url` text,
	`location` text,
	`country` text,
	`language` text,
	`timezone` text,
	`apollo_person_id` text,
	`source` text NOT NULL,
	`segment_id` text,
	`lead_state` text DEFAULT 'sourced' NOT NULL,
	`tier` text,
	`score` integer,
	`consent_basis` text DEFAULT 'legitimate_interest' NOT NULL,
	`suppressed` integer DEFAULT false NOT NULL,
	`linkedin_profile_text` text,
	`field_sources` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "contacts_email_status_check" CHECK(email_status IN ('unknown', 'inferred', 'unverified', 'verified_manual', 'verified_provider', 'invalid')),
	CONSTRAINT "contacts_lead_state_check" CHECK(lead_state IN ('sourced', 'researched', 'qualified', 'parked', 'queued', 'contacted', 'engaged', 'nurture'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_mandate_email` ON `contacts` (`mandate_id`,`email_lower`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_mandate_linkedin` ON `contacts` (`mandate_id`,`linkedin_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_mandate_apollo` ON `contacts` (`mandate_id`,`apollo_person_id`);--> statement-breakpoint
CREATE INDEX `contacts_mandate_org` ON `contacts` (`mandate_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `contacts_mandate_name` ON `contacts` (`mandate_id`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `contacts_mandate_state` ON `contacts` (`mandate_id`,`lead_state`);--> statement-breakpoint
CREATE INDEX `contacts_mandate_score` ON `contacts` (`mandate_id`,`score`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`contact_id` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`stage` text DEFAULT 'lead' NOT NULL,
	`practice` text,
	`engagement` text DEFAULT 'diagnostic' NOT NULL,
	`fee_type` text DEFAULT 'one_time' NOT NULL,
	`fee_terms` text DEFAULT '{}' NOT NULL,
	`value_estimate` real,
	`probability` integer,
	`sector` text,
	`ticket` text,
	`source` text DEFAULT 'other' NOT NULL,
	`next_action` text,
	`next_action_date` text,
	`lost_reason` text,
	`notes` text DEFAULT '' NOT NULL,
	`legacy_pipeline_entry_id` integer,
	`stage_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "deals_stage_check" CHECK(stage IN ('lead', 'contacted', 'engaged', 'call_booked', 'proposal', 'signed', 'active', 'expansion', 'completed', 'churned', 'lost', 'nurture'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deals_mandate_legacy` ON `deals` (`mandate_id`,`legacy_pipeline_entry_id`);--> statement-breakpoint
CREATE INDEX `deals_mandate_stage` ON `deals` (`mandate_id`,`stage`,`next_action_date`);--> statement-breakpoint
CREATE TABLE `dossiers` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`contact_id` text,
	`depth` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`fields` text,
	`confidence` text,
	`status` text DEFAULT 'gathering' NOT NULL,
	`error` text,
	`refreshed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dossiers_mandate_org` ON `dossiers` (`mandate_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `dossiers_mandate_contact` ON `dossiers` (`mandate_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text,
	`file_key` text,
	`mapping` text,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`processed_rows` integer DEFAULT 0 NOT NULL,
	`created` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`flagged` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `list_members` (
	`list_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_members_pk` ON `list_members` (`list_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `list_members_entity` ON `list_members` (`entity_id`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_mandate_name` ON `lists` (`mandate_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `merges` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`kept_id` text NOT NULL,
	`merged_id` text NOT NULL,
	`before` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`deal_id` text,
	`channel` text DEFAULT 'email' NOT NULL,
	`direction` text DEFAULT 'out' NOT NULL,
	`mailbox_role` text DEFAULT 'primary' NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_by` text,
	`gmail_message_id` text,
	`gmail_thread_id` text,
	`error` text,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "messages_status_check" CHECK(status IN ('draft', 'style_failed', 'pending_approval', 'approved', 'sending', 'sent', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `messages_status` ON `messages` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `messages_mandate_contact` ON `messages` (`mandate_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`domain` text,
	`website` text,
	`country` text,
	`location` text,
	`sector` text,
	`industry` text,
	`headcount` integer,
	`founded_year` integer,
	`segment_id` text,
	`description` text,
	`linkedin_url` text,
	`apollo_org_id` text,
	`lei` text,
	`wikidata_id` text,
	`sec_cik` text,
	`parent_org_id` text,
	`lat` real,
	`lng` real,
	`geo_source` text,
	`source` text NOT NULL,
	`field_sources` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_mandate_domain` ON `organizations` (`mandate_id`,`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_mandate_apollo` ON `organizations` (`mandate_id`,`apollo_org_id`);--> statement-breakpoint
CREATE INDEX `organizations_mandate_name` ON `organizations` (`mandate_id`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `organizations_mandate_sector` ON `organizations` (`mandate_id`,`sector`);--> statement-breakpoint
CREATE INDEX `organizations_mandate_country` ON `organizations` (`mandate_id`,`country`);--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`email` text,
	`type` text,
	`tier` text DEFAULT 'standard' NOT NULL,
	`referral_status` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partners_mandate_email` ON `partners` (`mandate_id`,`email`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`version` integer NOT NULL,
	`model` text NOT NULL,
	`system` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompts_key_version` ON `prompts` (`key`,`version`);--> statement-breakpoint
CREATE TABLE `provider_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`http_status` integer,
	`ok` integer NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_calls_provider_created` ON `provider_calls` (`provider`,`created_at`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`tab` text NOT NULL,
	`query` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scores` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`fit` integer NOT NULL,
	`trigger` integer NOT NULL,
	`access` integer NOT NULL,
	`total` integer NOT NULL,
	`tier` text NOT NULL,
	`rationale` text NOT NULL,
	`match` text,
	`screening_quadrant` text,
	`screening` text,
	`model_version` text NOT NULL,
	`scored_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scores_mandate_contact` ON `scores` (`mandate_id`,`contact_id`,`scored_at`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`group` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`sectors` text NOT NULL,
	`titles` text NOT NULL,
	`triggers` text DEFAULT '' NOT NULL,
	`practices` text NOT NULL,
	`entry_offer` text DEFAULT '' NOT NULL,
	`angle` text DEFAULT '' NOT NULL,
	`apollo_filters` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "segments_group_check" CHECK("group" IN ('capital', 'corporate', 'public', 'channel', 'community')),
	CONSTRAINT "segments_path_check" CHECK(path IN ('capital_mandate', 'project_diagnostic', 'partner_network'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segments_key_unique` ON `segments` (`key`);--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`published_at` text NOT NULL,
	`deadline` text,
	`country` text,
	`lat` real,
	`lng` real,
	`org_name` text,
	`summary` text DEFAULT '' NOT NULL,
	`query_key` text,
	`status` text DEFAULT 'new' NOT NULL,
	`relevance` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signals_source_external` ON `signals` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `signals_status_published` ON `signals` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `site_events` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`kind` text NOT NULL,
	`site_id` integer NOT NULL,
	`payload` text NOT NULL,
	`contact_id` text,
	`deal_id` text,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_events_kind_site` ON `site_events` (`mandate_id`,`kind`,`site_id`);--> statement-breakpoint
CREATE TABLE `source_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppression` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`domain` text,
	`reason` text NOT NULL,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_email` ON `suppression` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_domain` ON `suppression` (`domain`);--> statement-breakpoint
CREATE TABLE `trigger_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`source` text NOT NULL,
	`label` text NOT NULL,
	`query` text NOT NULL,
	`trigger_type` text NOT NULL,
	`segment_keys` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`last_count` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trigger_queries_key_unique` ON `trigger_queries` (`key`);--> statement-breakpoint
CREATE TABLE `triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`org_id` text NOT NULL,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`event_date` text,
	`source_url` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`urgency` integer DEFAULT 3 NOT NULL,
	`country` text,
	`lat` real,
	`lng` real,
	`signal_id` text,
	`relevance` integer,
	`suggested_engagement` text,
	`decision_read` text,
	`status` text DEFAULT 'new' NOT NULL,
	`dismiss_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `triggers_mandate_org` ON `triggers` (`mandate_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `triggers_status_created` ON `triggers` (`status`,`created_at`);