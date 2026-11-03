CREATE TABLE `controlled_original_index` (
	`run_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`artifact_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL,
	`size` integer NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
