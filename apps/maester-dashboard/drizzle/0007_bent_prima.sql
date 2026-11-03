CREATE TABLE `pending_r2_objects` (
	`object_key` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
