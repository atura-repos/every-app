import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  controlResults,
  importEvents,
  scanRuns,
  tenantAccess,
  tenantRegistry,
} from "@/db/schema";

type Identity = {
  id: string;
  email: string;
  orgId: string;
  channel: string;
  actor?: { sub?: string };
};
type Config = { PILOT_USER_ID?: string; PILOT_ORG_ID?: string };
type Run = typeof scanRuns.$inferSelect;
type Control = typeof controlResults.$inferSelect;

export function authorizePilot(user: Identity, config: Config): void {
  if (
    !config.PILOT_USER_ID ||
    !config.PILOT_ORG_ID ||
    user.id !== config.PILOT_USER_ID ||
    user.orgId !== config.PILOT_ORG_ID ||
    user.email !== "mvanfalier@atura.nl" ||
    user.channel !== "web" ||
    user.actor?.sub !== user.id
  )
    throw new Error("Access denied");
}

export function selectTenant(
  tenants: { id: string }[],
  requested?: string,
): string {
  const selected = requested ?? tenants[0]?.id;
  if (!selected || !tenants.some((tenant) => tenant.id === selected))
    throw new Error("Access denied");
  return selected;
}

export async function listTenants(user: Identity, config: Config) {
  authorizePilot(user, config);
  return db
    .select({ id: tenantRegistry.id, name: tenantRegistry.name })
    .from(tenantAccess)
    .innerJoin(tenantRegistry, eq(tenantAccess.tenantId, tenantRegistry.id))
    .where(
      and(eq(tenantAccess.userId, user.id), eq(tenantAccess.orgId, user.orgId)),
    )
    .orderBy(tenantRegistry.name);
}

export function summarizeRun(run: Run, controls: Control[]) {
  const ids: unknown = JSON.parse(run.expectedTestIds);
  if (
    run.schemaVersion !== 1 ||
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Invalid scan scope");
  const expected = new Set(ids as string[]);
  const results = new Map<string, Control["result"]>();
  for (const control of controls) {
    if (
      control.runId !== run.id ||
      control.tenantId !== run.tenantId ||
      !expected.has(control.testId) ||
      results.has(control.testId)
    )
      throw new Error("Invalid control scope");
    results.set(control.testId, control.result);
  }
  const counts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    technical: 0,
    total: expected.size,
  };
  for (const id of expected) {
    const result = results.get(id);
    if (result === "Passed") counts.passed++;
    else if (result === "Failed") counts.failed++;
    else if (
      result === "Error" ||
      (result === undefined && run.scanStatus === "technical_error")
    )
      counts.technical++;
    else counts.skipped++;
  }
  return {
    id: run.id,
    tenantId: run.tenantId,
    suite: run.suite,
    benchmark: run.benchmark,
    startedAt: run.startedAt,
    scanStatus: run.scanStatus,
    workflowConclusion: run.workflowConclusion,
    expectedTestIds: [...expected],
    counts,
    controls: [...expected].map((testId) => ({
      testId,
      title: controls.find((c) => c.testId === testId)?.title ?? testId,
      result:
        results.get(testId) ??
        (run.scanStatus === "technical_error" ? "Error" : "NotRun"),
    })),
  };
}

type Summary = ReturnType<typeof summarizeRun>;
export function compareRuns(previous: Summary, current: Summary) {
  if (
    previous.tenantId !== current.tenantId ||
    previous.suite !== current.suite ||
    previous.benchmark !== current.benchmark ||
    previous.expectedTestIds.length !== current.expectedTestIds.length ||
    previous.expectedTestIds.some(
      (id) =>
        !current.expectedTestIds.includes(id) ||
        previous.controls.find((c) => c.testId === id)?.title !==
          current.controls.find((c) => c.testId === id)?.title,
    )
  ) {
    return { comparable: false as const, reason: "scope_changed" as const };
  }
  if (previous.scanStatus !== "completed" || current.scanStatus !== "completed")
    return { comparable: false as const, reason: "technical_error" as const };
  const earlier = new Map(
    previous.controls.map((control) => [control.testId, control.result]),
  );
  const improved: string[] = [],
    regressed: string[] = [],
    unresolved: string[] = [];
  for (const control of current.controls) {
    const old = earlier.get(control.testId);
    if (old === "Failed" && control.result === "Passed")
      improved.push(control.testId);
    else if (old === "Passed" && control.result === "Failed")
      regressed.push(control.testId);
    else if (
      old !== control.result &&
      (old === "NotRun" ||
        old === "Skipped" ||
        old === "Error" ||
        control.result === "NotRun" ||
        control.result === "Skipped" ||
        control.result === "Error")
    )
      unresolved.push(control.testId);
  }
  return unresolved.length
    ? { comparable: true as const, improved, regressed, unresolved }
    : { comparable: true as const, improved, regressed };
}

export async function readDashboard(
  user: Identity,
  config: Config,
  tenantId: string,
  suite: "daily" | "cis",
) {
  authorizePilot(user, config);
  const grant = await db
    .select({ id: tenantAccess.tenantId })
    .from(tenantAccess)
    .where(
      and(
        eq(tenantAccess.tenantId, tenantId),
        eq(tenantAccess.orgId, user.orgId),
        eq(tenantAccess.userId, user.id),
      ),
    )
    .limit(1);
  if (!grant.length) throw new Error("Access denied");
  const rows = await db
    .select()
    .from(scanRuns)
    .where(and(eq(scanRuns.tenantId, tenantId), eq(scanRuns.suite, suite)))
    .orderBy(desc(scanRuns.startedAt))
    .limit(100);
  const runs: Summary[] = [];
  for (const row of rows) {
    const controls = await db
      .select()
      .from(controlResults)
      .where(
        and(
          eq(controlResults.tenantId, tenantId),
          eq(controlResults.runId, row.id),
        ),
      );
    runs.push(summarizeRun(row, controls));
  }
  const importEventsForTenant = await db
    .select({
      id: importEvents.id,
      code: importEvents.code,
      observedAt: importEvents.observedAt,
    })
    .from(importEvents)
    .where(eq(importEvents.tenantId, tenantId))
    .orderBy(desc(importEvents.observedAt))
    .limit(20);
  return {
    runs,
    importEvents: importEventsForTenant.map((event) => ({
      ...event,
      code: [
        "projection_missing",
        "attempt_unverifiable",
        "import_failed",
      ].includes(event.code)
        ? event.code
        : "import_failed",
    })),
    comparisons: runs.slice(0, -1).map((current, index) => ({
      currentId: current.id,
      previousId: runs[index + 1].id,
      ...compareRuns(runs[index + 1], current),
    })),
  };
}
