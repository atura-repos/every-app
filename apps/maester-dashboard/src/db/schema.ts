import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const tenantRegistry = sqliteTable("tenant_registry", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});
// Operator-provisioned only: immutable repository ID binds tenant and installation.
export const githubSources = sqliteTable("github_sources", {
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantRegistry.id),
  repoId: integer("repo_id").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  installationId: integer("installation_id").notNull(),
  workflowId: integer("workflow_id").notNull(),
  workflowRef: text("workflow_ref").notNull(),
  artifactName: text("artifact_name").notNull(),
  enabled: integer("enabled").notNull(),
});
export const artifactIndex = sqliteTable("artifact_index", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantRegistry.id),
  runId: text("run_id")
    .notNull()
    .references(() => scanRuns.id),
  objectKey: text("object_key").notNull(),
  digest: text("digest").notNull(),
  expiresAt: text("expires_at").notNull(),
});
export const importEvents = sqliteTable("import_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantRegistry.id),
  code: text("code").notNull(),
  observedAt: text("observed_at").notNull(),
});
export const retentionEvents = sqliteTable("retention_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  deletedAt: text("deleted_at").notNull(),
});
export const tenantAccess = sqliteTable(
  "tenant_access",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantRegistry.id),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.orgId, table.userId] }),
  ],
);
export const scanRuns = sqliteTable(
  "scan_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantRegistry.id),
    suite: text("suite", { enum: ["daily", "cis"] }).notNull(),
    benchmark: text("benchmark").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    startedAt: text("started_at").notNull(),
    scanStatus: text("scan_status", {
      enum: ["completed", "skipped", "technical_error"],
    }).notNull(),
    workflowConclusion: text("workflow_conclusion"),
    expectedTestIds: text("expected_test_ids").notNull(),
  },
  (table) => [
    index("scan_runs_tenant_suite_started_idx").on(
      table.tenantId,
      table.suite,
      table.startedAt,
    ),
  ],
);
export const controlResults = sqliteTable(
  "control_results",
  {
    runId: text("run_id")
      .notNull()
      .references(() => scanRuns.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantRegistry.id),
    testId: text("test_id").notNull(),
    title: text("title").notNull(),
    result: text("result", {
      enum: ["Passed", "Failed", "Skipped", "NotRun", "Error"],
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.testId] })],
);
