CREATE TABLE `control_results` (
	`run_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`test_id` text NOT NULL,
	`title` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`run_id`, `test_id`),
	FOREIGN KEY (`run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`suite` text NOT NULL,
	`benchmark` text NOT NULL,
	`schema_version` integer NOT NULL,
	`started_at` text NOT NULL,
	`scan_status` text NOT NULL,
	`workflow_conclusion` text,
	`expected_test_ids` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenant_access` (
	`tenant_id` text NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `org_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenant_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
