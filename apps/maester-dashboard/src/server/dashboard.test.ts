import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));
const {
  listTenants,
  readDashboard,
  authorizePilot,
  compareRuns,
  summarizeRun,
  selectTenant,
} = await import("./dashboard");

const mikkie = {
  id: "pilot-id",
  email: "mvanfalier@atura.nl",
  orgId: "atura-org",
  channel: "web",
  actor: { sub: "pilot-id" },
};
const config = { PILOT_USER_ID: "pilot-id", PILOT_ORG_ID: "atura-org" };
let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(async () => {
  db = drizzle(createClient({ url: ":memory:" }), { schema });
  testDb.current = db;
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  await db.insert(schema.tenantRegistry).values([
    { id: "atura", name: "Atura" },
    { id: "other", name: "Andere organisatie" },
  ]);
  await db
    .insert(schema.tenantAccess)
    .values({ tenantId: "atura", orgId: "atura-org", userId: "pilot-id" });
});

const run = (
  id: string,
  tenantId: string,
  suite: "daily" | "cis",
  expectedTestIds: string[],
  benchmark = "v1",
  scanStatus: "completed" | "technical_error" = "completed",
) => ({
  id,
  tenantId,
  suite,
  benchmark,
  schemaVersion: 1,
  startedAt: id,
  scanStatus,
  workflowConclusion: "failure",
  expectedTestIds: JSON.stringify(expectedTestIds),
  retentionLock: 0,
});
const control = (
  runId: string,
  tenantId: string,
  testId: string,
  result: "Passed" | "Failed" | "Skipped" | "NotRun" | "Error",
) => ({ runId, tenantId, testId, title: testId, result });

describe("pilot boundary", () => {
  it("rejects absent configuration, wrong signed identity, alternate channel and wrong organization", () => {
    expect(() => authorizePilot(mikkie, {})).toThrow();
    expect(() => authorizePilot({ ...mikkie, id: "other" }, config)).toThrow();
    expect(() =>
      authorizePilot({ ...mikkie, orgId: "other" }, config),
    ).toThrow();
    expect(() =>
      authorizePilot({ ...mikkie, email: "other@atura.nl" }, config),
    ).toThrow();
    expect(() =>
      authorizePilot({ ...mikkie, channel: "mcp" }, config),
    ).toThrow();
    expect(() =>
      authorizePilot({ ...mikkie, actor: { sub: "other" } }, config),
    ).toThrow();
    expect(() => authorizePilot(mikkie, config)).not.toThrow();
  });
  it("advertises only active controlled archives for the selected tenant", async () => {
    await db
      .insert(schema.scanRuns)
      .values([
        run("2026-11-03T00:00:00Z", "atura", "daily", ["MT.1001"]),
        run("2026-11-02T00:00:00Z", "other", "daily", ["MT.1001"]),
      ]);
    await db.insert(schema.controlledOriginalIndex).values([
      {
        runId: "2026-11-03T00:00:00Z",
        tenantId: "atura",
        artifactId: 1,
        objectKey: "atura/key",
        digest: "a".repeat(64),
        size: 10,
        expiresAt: "2999-01-01T00:00:00Z",
      },
      {
        runId: "2026-11-02T00:00:00Z",
        tenantId: "other",
        artifactId: 2,
        objectKey: "other/key",
        digest: "b".repeat(64),
        size: 10,
        expiresAt: "2999-01-01T00:00:00Z",
      },
    ]);
    const model = await readDashboard(mikkie, config, "atura", "daily");
    expect(model.controlledRunIds).toEqual(["2026-11-03T00:00:00Z"]);
    await db
      .update(schema.scanRuns)
      .set({ retentionLock: 1 })
      .where(eq(schema.scanRuns.tenantId, "atura"));
    const locked = await readDashboard(mikkie, config, "atura", "daily");
    expect(locked.controlledRunIds).toEqual([]);
  });
  it("distinguishes missing controlled archive from missing projection", async () => {
    await db.insert(schema.importEvents).values({
      id: "42:100:1:controlled",
      tenantId: "atura",
      code: "controlled_missing",
      observedAt: "2026-11-03T00:00:00Z",
    });
    const model = await readDashboard(mikkie, config, "atura", "daily");
    expect(model.importEvents[0].code).toBe("controlled_missing");
  });
  it("shows only authorized tenant import-state codes, not other tenants or arbitrary error text", async () => {
    await db.insert(schema.importEvents).values([
      {
        id: "42:100:1",
        tenantId: "atura",
        code: "projection_missing",
        observedAt: "2026-11-03T00:00:00Z",
      },
      {
        id: "99:200:1",
        tenantId: "other",
        code: "private source failure",
        observedAt: "2026-11-03T01:00:00Z",
      },
    ]);
    const data = await readDashboard(mikkie, config, "atura", "daily");
    expect(data.importEvents).toEqual([
      {
        id: "42:100:1",
        code: "projection_missing",
        observedAt: "2026-11-03T00:00:00Z",
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("private source failure");
  });
  it("returns only explicitly granted tenants, never another tenant by guessed id", async () => {
    expect(await listTenants(mikkie, config)).toEqual([
      { id: "atura", name: "Atura" },
    ]);
    await expect(
      readDashboard(mikkie, config, "other", "daily"),
    ).rejects.toThrow();
    await expect(
      readDashboard({ ...mikkie, id: "other" }, config, "atura", "daily"),
    ).rejects.toThrow();
  });
  it("chooses only an authorized tenant and rejects guessed selection", async () => {
    const tenants = await listTenants(mikkie, config);
    expect(selectTenant(tenants)).toBe("atura");
    expect(selectTenant(tenants, "atura")).toBe("atura");
    expect(() => selectTenant(tenants, "other")).toThrow("Access denied");
    expect(() => selectTenant([], undefined)).toThrow("Access denied");
  });
});

describe("run read model", () => {
  it("indexes tenant history queries before scanning runs", async () => {
    const indexes = await db.all<{ name: string }>(
      "PRAGMA index_list('scan_runs')",
    );
    expect(indexes.map((row) => row.name)).toContain(
      "scan_runs_tenant_suite_started_idx",
    );
  });
  it("separates daily and CIS, scopes controls, and distinguishes four result states and technical scan failure", async () => {
    await db
      .insert(schema.scanRuns)
      .values([
        run("2026-11-01", "atura", "daily", ["a", "b", "c", "d", "missing"]),
        run("2026-11-02", "atura", "cis", ["z"]),
        run("2026-11-03", "other", "daily", ["secret"]),
        run("2026-11-04", "atura", "daily", ["x"], "v1", "technical_error"),
      ]);
    await db
      .insert(schema.controlResults)
      .values([
        control("2026-11-01", "atura", "a", "Passed"),
        control("2026-11-01", "atura", "b", "Failed"),
        control("2026-11-01", "atura", "c", "NotRun"),
        control("2026-11-01", "atura", "d", "Error"),
        control("2026-11-02", "atura", "z", "Passed"),
        control("2026-11-03", "other", "secret", "Failed"),
      ]);
    const daily = await readDashboard(mikkie, config, "atura", "daily");
    expect(daily.runs.map((r) => r.id)).toEqual(["2026-11-04", "2026-11-01"]);
    expect(daily.runs[1].counts).toEqual({
      passed: 1,
      failed: 1,
      skipped: 0,
      notRun: 2,
      technical: 1,
      total: 5,
    });
    expect(daily.runs[0].scanStatus).toBe("technical_error");
    expect(daily.runs[1].workflowConclusion).toBe("failure");
    expect(JSON.stringify(daily)).not.toContain("secret");
    expect(
      (await readDashboard(mikkie, config, "atura", "cis")).runs.map(
        (r) => r.id,
      ),
    ).toEqual(["2026-11-02"]);
  });
  it("separates explicit Skipped from NotRun in every summary total", () => {
    const summary = summarizeRun(
      run("x", "atura", "cis", ["skipped", "missing"]),
      [control("x", "atura", "skipped", "Skipped")],
    );
    expect(summary.counts.skipped).toBe(1);
    expect(summary.counts.notRun).toBe(1);
  });
  it("counts missing expected controls as technical when scan crashed, not compliant or merely skipped", () => {
    const broken = summarizeRun(
      run("x", "atura", "daily", ["a", "b"], "v1", "technical_error"),
      [],
    );
    expect(broken.counts).toEqual({
      passed: 0,
      failed: 0,
      skipped: 0,
      notRun: 0,
      technical: 2,
      total: 2,
    });
    expect(broken.controls.map((c) => c.result)).toEqual(["Error", "Error"]);
  });
  it("never counts invalid or unlisted control IDs as passing", () => {
    expect(() =>
      summarizeRun(run("x", "atura", "daily", ["a"]), [
        control("x", "atura", "extra", "Passed"),
      ]),
    ).toThrow();
    expect(() =>
      summarizeRun(run("x", "atura", "daily", ["a", "a"]), []),
    ).toThrow();
  });
});

describe("comparison", () => {
  it("compares only matching suite, benchmark and test set; marks scope changes", () => {
    const previous = summarizeRun(run("1", "atura", "daily", ["a", "b"]), [
      control("1", "atura", "a", "Failed"),
      control("1", "atura", "b", "Passed"),
    ]);
    const current = summarizeRun(run("2", "atura", "daily", ["b", "a"]), [
      control("2", "atura", "a", "Passed"),
      control("2", "atura", "b", "Failed"),
    ]);
    expect(compareRuns(previous, current)).toEqual({
      comparable: true,
      improved: ["a"],
      regressed: ["b"],
    });
    expect(
      compareRuns(
        previous,
        summarizeRun(run("3", "atura", "daily", ["a"]), []),
      ),
    ).toMatchObject({ comparable: false, reason: "scope_changed" });
    expect(
      compareRuns(
        previous,
        summarizeRun(run("4", "atura", "cis", ["a", "b"]), []),
      ),
    ).toMatchObject({ comparable: false, reason: "scope_changed" });
    expect(
      compareRuns(
        previous,
        summarizeRun(run("5", "atura", "daily", ["a", "b"], "v2"), []),
      ),
    ).toMatchObject({ comparable: false, reason: "scope_changed" });
    const retitled = summarizeRun(run("6", "atura", "daily", ["a", "b"]), [
      { ...control("6", "atura", "a", "Passed"), title: "Changed meaning" },
      control("6", "atura", "b", "Passed"),
    ]);
    expect(compareRuns(previous, retitled)).toMatchObject({
      comparable: false,
      reason: "scope_changed",
    });
  });
  it("keeps a Maester-skipped control unresolved rather than calling it a changed finding", () => {
    const prior = summarizeRun(run("1", "atura", "cis", ["a"]), [
      control("1", "atura", "a", "Failed"),
    ]);
    const skipped = summarizeRun(run("2", "atura", "cis", ["a"]), [
      control("2", "atura", "a", "Skipped"),
    ]);
    expect(skipped.controls[0].result).toBe("Skipped");
    expect(skipped.counts.skipped).toBe(1);
    expect(compareRuns(prior, skipped)).toEqual({
      comparable: true,
      improved: [],
      regressed: [],
      unresolved: ["a"],
    });
  });
  it("does not call an unexecuted or technically errored test an improvement", () => {
    const prior = summarizeRun(run("1", "atura", "daily", ["a"]), [
      control("1", "atura", "a", "Failed"),
    ]);
    const skipped = summarizeRun(run("2", "atura", "daily", ["a"]), []);
    expect(compareRuns(prior, skipped)).toEqual({
      comparable: true,
      improved: [],
      regressed: [],
      unresolved: ["a"],
    });
    const broken = summarizeRun(
      run("3", "atura", "daily", ["a"], "v1", "technical_error"),
      [],
    );
    expect(compareRuns(prior, broken)).toMatchObject({
      comparable: false,
      reason: "technical_error",
    });
  });
});
