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
// One immutable repository identity per tenant; workflow rows cannot redefine it.
export const githubRepositories = sqliteTable("github_repositories", {
  repoId: integer("repo_id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantRegistry.id),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  installationId: integer("installation_id").notNull(),
});
export const githubSources = sqliteTable(
  "github_sources",
  {
    repoId: integer("repo_id")
      .notNull()
      .references(() => githubRepositories.repoId),
    workflowId: integer("workflow_id").notNull(),
    workflowRef: text("workflow_ref").notNull(),
    workflowPath: text("workflow_path").notNull(),
    artifactName: text("artifact_name").notNull(),
    enabled: integer("enabled").notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoId, table.workflowId] })],
);
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
export const reportVersions = sqliteTable(
  "report_versions",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantRegistry.id),
    runId: text("run_id")
      .notNull()
      .references(() => scanRuns.id),
    digest: text("digest").notNull(),
    objectKey: text("object_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    createdAt: text("created_at").notNull(),
    approvedAt: text("approved_at"),
    approvedBy: text("approved_by"),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.runId, table.digest] }),
  ],
);
export const reportApprovalEvents = sqliteTable("report_approval_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  runId: text("run_id").notNull(),
  digest: text("digest").notNull(),
  actorId: text("actor_id").notNull(),
  actorOrgId: text("actor_org_id").notNull(),
  approvedAt: text("approved_at").notNull(),
});
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
