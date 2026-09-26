CREATE TABLE `esign_envelopes` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`generated_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text,
	`status` text DEFAULT 'created' NOT NULL,
	`recipients` text NOT NULL,
	`signed_document_url` text,
	`events` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `esign_envelopes_doc` ON `esign_envelopes` (`generated_id`);--> statement-breakpoint
CREATE TABLE `generated_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`template_key` text NOT NULL,
	`title` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`values` text DEFAULT '{}' NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`previous_id` text,
	`legal` integer DEFAULT false NOT NULL,
	`legal_review_status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`confidential` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `generated_documents_entity` ON `generated_documents` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `generated_documents_mandate` ON `generated_documents` (`mandate_id`,`created_at`);