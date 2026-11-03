CREATE TABLE `report_approval_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`digest` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_org_id` text NOT NULL,
	`approved_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `report_versions` (
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`digest` text NOT NULL,
	`object_key` text NOT NULL,
	`pdf_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	`approved_at` text,
	`approved_by` text,
	PRIMARY KEY(`tenant_id`, `run_id`, `digest`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action
);
