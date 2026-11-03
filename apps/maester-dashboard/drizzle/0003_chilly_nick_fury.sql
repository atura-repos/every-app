CREATE TABLE `import_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
