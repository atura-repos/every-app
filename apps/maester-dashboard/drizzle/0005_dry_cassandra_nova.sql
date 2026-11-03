CREATE TABLE `github_repositories` (
	`repo_id` integer PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`installation_id` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `github_repositories` (`repo_id`, `tenant_id`, `owner`, `repo`, `installation_id`)
SELECT `repo_id`, `tenant_id`, `owner`, `repo`, `installation_id` FROM `github_sources`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_github_sources` (
	`repo_id` integer NOT NULL,
	`workflow_id` integer NOT NULL,
	`workflow_ref` text NOT NULL,
	`workflow_path` text NOT NULL,
	`artifact_name` text NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`repo_id`, `workflow_id`),
	FOREIGN KEY (`repo_id`) REFERENCES `github_repositories`(`repo_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_github_sources`("repo_id", "workflow_id", "workflow_ref", "workflow_path", "artifact_name", "enabled") SELECT "repo_id", "workflow_id", "workflow_ref", '', "artifact_name", 0 FROM `github_sources`;--> statement-breakpoint
DROP TABLE `github_sources`;--> statement-breakpoint
ALTER TABLE `__new_github_sources` RENAME TO `github_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TRIGGER `github_repositories_identity_immutable` BEFORE UPDATE OF `repo_id`, `tenant_id` ON `github_repositories`
WHEN NEW.`repo_id` != OLD.`repo_id` OR NEW.`tenant_id` != OLD.`tenant_id`
BEGIN SELECT RAISE(ABORT, 'repository tenant identity is immutable'); END;