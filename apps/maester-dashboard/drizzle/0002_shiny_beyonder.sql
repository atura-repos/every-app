CREATE TABLE `artifact_index` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `github_sources` (
	`tenant_id` text NOT NULL,
	`repo_id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`installation_id` integer NOT NULL,
	`workflow_id` integer NOT NULL,
	`workflow_ref` text NOT NULL,
	`artifact_name` text NOT NULL,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `retention_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`deleted_at` text NOT NULL
);
