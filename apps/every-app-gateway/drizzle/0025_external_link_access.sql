CREATE TABLE `external_link_groups` (
	`link_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`link_id`, `group_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`link_id`,`organization_id`) REFERENCES `external_links`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `external_link_groups_org_group_idx` ON `external_link_groups` (`organization_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `external_link_users` (
	`link_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`link_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`link_id`,`organization_id`) REFERENCES `external_links`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `external_link_users_org_user_idx` ON `external_link_users` (`organization_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `external_links` ADD `everyone` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `external_links_id_org_unique` ON `external_links` (`id`,`organization_id`);