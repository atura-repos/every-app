import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  controlResults,
  pendingR2Objects,
  reportApprovalEvents,
  reportVersions,
  scanRuns,
  tenantAccess,
  tenantRegistry,
} from "@/db/schema";
import { authorizePilot, summarizeRun } from "./dashboard";
import { renderReport } from "./report";

type Identity = Parameters<typeof authorizePilot>[0];
type Config = Parameters<typeof authorizePilot>[1];
type Bucket = {
  put(
    key: string,
    bytes: Uint8Array,
    options?: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer | SharedArrayBuffer>;
  } | null>;
  delete(key: string): Promise<void>;
};
const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const scope = (tenantId: string, runId: string) =>
  and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.runId, runId));

async function source(
  user: Identity,
  config: Config,
  tenantId: string,
  runId: string,
) {
  authorizePilot(user, config);
  if (!tenantId || !runId || tenantId.length > 128 || runId.length > 128)
    throw new Error("Invalid report scope");
  const tenant = await db
    .select({ name: tenantRegistry.name })
    .from(tenantAccess)
    .innerJoin(tenantRegistry, eq(tenantAccess.tenantId, tenantRegistry.id))
    .where(
      and(
        eq(tenantAccess.tenantId, tenantId),
        eq(tenantAccess.orgId, user.orgId),
        eq(tenantAccess.userId, user.id),
      ),
    )
    .limit(1);
  if (!tenant.length) throw new Error("Access denied");
  const rows = await db
    .select()
    .from(scanRuns)
    .where(and(eq(scanRuns.tenantId, tenantId), eq(scanRuns.id, runId)))
    .limit(1);
  if (!rows.length) throw new Error("Report not found");
  const deadline = new Date(rows[0].startedAt);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + 1);
  if (
    !Number.isFinite(deadline.getTime()) ||
    rows[0].retentionLock ||
    Date.now() >= deadline.getTime()
  )
    throw new Error("Report expired");
  const controls = await db
    .select()
    .from(controlResults)
    .where(
      and(
        eq(controlResults.tenantId, tenantId),
        eq(controlResults.runId, runId),
      ),
    );
  const summary = summarizeRun(rows[0], controls);
  // Canonical and bounded: no raw artifacts or HTML objects enter the digest/PDF.
  if (summary.controls.length > 500) throw new Error("Report too large");
  const fields = {
    tenantId,
    tenantName: tenant[0].name,
    runId,
    suite: summary.suite,
    benchmark: summary.benchmark,
    startedAt: summary.startedAt,
    scanStatus: summary.scanStatus,
    workflowConclusion: summary.workflowConclusion,
    expectedTestIds: summary.expectedTestIds,
    controls: summary.controls.map((c) => ({
      testId: c.testId,
      title: c.title,
      result: c.result,
    })),
    counts: summary.counts,
    schemaVersion: rows[0].schemaVersion,
    pdfTemplateVersion: 1,
  };
  const digest = await sha256(new TextEncoder().encode(JSON.stringify(fields)));
  return { ...fields, digest };
}

export async function reportStatus(
  user: Identity,
  config: Config,
  tenantId: string,
  runId: string,
) {
  const current = await source(user, config, tenantId, runId);
  const rows = await db
    .select()
    .from(reportVersions)
    .where(
      and(scope(tenantId, runId), eq(reportVersions.digest, current.digest)),
    )
    .limit(1);
  const version = rows[0];
  const audit = version?.approvedAt
    ? await db
        .select({ id: reportApprovalEvents.id })
        .from(reportApprovalEvents)
        .where(
          and(
            eq(reportApprovalEvents.tenantId, tenantId),
            eq(reportApprovalEvents.runId, runId),
            eq(reportApprovalEvents.digest, current.digest),
          ),
        )
        .limit(1)
    : [];
  return {
    digest: current.digest,
    status: version
      ? version.approvedAt && audit.length
        ? "approved"
        : "concept"
      : "not_created",
  };
}

export async function createConcept(
  user: Identity,
  config: Config,
  bucket: Bucket,
  tenantId: string,
  runId: string,
) {
  const fields = await source(user, config, tenantId, runId);
  const previous = await reportStatus(user, config, tenantId, runId);
  if (previous.status !== "not_created") return previous;
  const bytes = await renderReport(fields);
  const pdfSha256 = await sha256(bytes);
  // Per-attempt suffix prevents one racing creator from deleting another's
  // content-addressed PDF while the unique D1 digest row is being chosen.
  const objectKey = `reports/${fields.digest}/${pdfSha256}-${crypto.randomUUID()}.pdf`;
  const storedVersion = async () =>
    (
      await db
        .select({ objectKey: reportVersions.objectKey })
        .from(reportVersions)
        .where(
          and(scope(tenantId, runId), eq(reportVersions.digest, fields.digest)),
        )
        .limit(1)
    )[0];
  const expiresAt = new Date(fields.startedAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  if (!Number.isFinite(expiresAt.getTime()))
    throw new Error("Invalid retention deadline");
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  // Register the unique key before writing R2. Even a terminated Worker leaves
  // a durable record for the independent retention sweep.
  await db.run(sql`
    INSERT INTO pending_r2_objects(object_key, tenant_id, expires_at)
    SELECT ${objectKey}, ${tenantId}, ${expiresAt.toISOString()}
    FROM scan_runs
    WHERE id = ${runId} AND tenant_id = ${tenantId}
      AND retention_lock = 0 AND started_at > ${cutoff.toISOString()}
  `);
  const pending = await db
    .select({ objectKey: pendingR2Objects.objectKey })
    .from(pendingR2Objects)
    .where(
      and(
        eq(pendingR2Objects.objectKey, objectKey),
        eq(pendingR2Objects.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!pending.length) throw new Error("Retention in progress");
  try {
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });
  } catch (error) {
    // R2 may have written bytes before reporting failure; do not remove a
    // concurrent creator's indexed object at the same content-addressed key.
    const committed = await storedVersion();
    if (committed?.objectKey !== objectKey) await bucket.delete(objectKey);
    throw error;
  }
  try {
    // This SQL statement races atomically with retention's scan-run lock.
    // An old/locked run cannot acquire a PDF row even if rendering began earlier.
    await db.run(sql`
      INSERT INTO report_versions
        (tenant_id, run_id, digest, object_key, pdf_sha256, created_at)
      SELECT ${tenantId}, ${runId}, ${fields.digest}, ${objectKey}, ${pdfSha256}, ${new Date().toISOString()}
      FROM scan_runs
      WHERE id = ${runId} AND tenant_id = ${tenantId}
        AND retention_lock = 0 AND started_at > ${cutoff.toISOString()}
      ON CONFLICT DO NOTHING
    `);
  } catch (error) {
    // A failed D1 write might have committed. Never delete a referenced object.
    const committed = await storedVersion();
    if (committed?.objectKey !== objectKey) await bucket.delete(objectKey);
    throw error;
  }
  // A concurrent creator may have won the digest's unique version. Its key is retained.
  const committed = await storedVersion();
  if (!committed) {
    await bucket.delete(objectKey);
    throw new Error("Retention in progress");
  }
  if (committed.objectKey !== objectKey) await bucket.delete(objectKey);
  return reportStatus(user, config, tenantId, runId);
}

export async function approveConcept(
  user: Identity,
  config: Config,
  tenantId: string,
  runId: string,
  digest: string,
) {
  const current = await source(user, config, tenantId, runId);
  if (!/^[a-f0-9]{64}$/.test(digest) || current.digest !== digest)
    throw new Error("Stale report version");
  if ((await reportStatus(user, config, tenantId, runId)).status !== "concept")
    throw new Error("Concept missing or already approved");
  const timestamp = new Date().toISOString();
  // D1 batch commits the approval marker and audit event together.
  const [changed] = await db.batch([
    db
      .update(reportVersions)
      .set({ approvedAt: timestamp, approvedBy: user.id })
      .where(
        and(
          scope(tenantId, runId),
          eq(reportVersions.digest, digest),
          isNull(reportVersions.approvedAt),
        ),
      )
      .returning(),
    db.insert(reportApprovalEvents).values({
      id: crypto.randomUUID(),
      tenantId,
      runId,
      digest,
      actorId: user.id,
      actorOrgId: user.orgId,
      approvedAt: timestamp,
    }),
  ]);
  if (!changed.length) throw new Error("Concept changed during approval");
  return reportStatus(user, config, tenantId, runId);
}

export async function downloadReport(
  user: Identity,
  config: Config,
  bucket: Bucket,
  tenantId: string,
  runId: string,
  digest: string,
  allowConcept = false,
) {
  const current = await source(user, config, tenantId, runId);
  if (!/^[a-f0-9]{64}$/.test(digest) || current.digest !== digest)
    throw new Error("Stale report version");
  const status = (await reportStatus(user, config, tenantId, runId)).status;
  if (status !== "approved" && !(allowConcept && status === "concept"))
    throw new Error("Approval required");
  const rows = await db
    .select()
    .from(reportVersions)
    .where(and(scope(tenantId, runId), eq(reportVersions.digest, digest)))
    .limit(1);
  const version = rows[0];
  if (!version || (!allowConcept && !version.approvedAt))
    throw new Error("Approval required");
  const object = await bucket.get(version.objectKey);
  if (!object) throw new Error("PDF unavailable");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    (await sha256(bytes)) !== version.pdfSha256 ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    throw new Error("PDF integrity failure");
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="atura-maester-${allowConcept ? "concept-" : ""}${digest.slice(0, 12)}.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
}
