import { and, eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { db } from "@/db";
import { controlledOriginalIndex, scanRuns, tenantAccess } from "@/db/schema";
import { authorizePilot } from "./dashboard";

type User = Parameters<typeof authorizePilot>[0];
type Config = Parameters<typeof authorizePilot>[1];
type Bindings = Config & { REPORTS: R2Bucket };
const unavailable = (status = 403) =>
  new Response("Controlled report unavailable or access denied", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });

// Called only inside everyApp's signed-identity Worker wrapper. Never serve
// HTML on this origin: even an authenticated GET returns an inert ZIP archive.
export async function handleControlledRequest(
  request: Request,
  env: Bindings,
  user: User | null,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/controlled-original") return;
  if (!user) return unavailable(401);
  if (request.method !== "GET") return unavailable(405);
  try {
    authorizePilot(user, env);
    const tenant = url.searchParams.get("tenant") ?? "";
    const run = url.searchParams.get("run") ?? "";
    if (!tenant || !run || tenant.length > 128 || run.length > 128)
      return unavailable();
    const rows = await db
      .select({
        objectKey: controlledOriginalIndex.objectKey,
        digest: controlledOriginalIndex.digest,
        size: controlledOriginalIndex.size,
        expiresAt: controlledOriginalIndex.expiresAt,
        startedAt: scanRuns.startedAt,
      })
      .from(controlledOriginalIndex)
      .innerJoin(
        scanRuns,
        and(
          eq(scanRuns.id, controlledOriginalIndex.runId),
          eq(scanRuns.tenantId, controlledOriginalIndex.tenantId),
        ),
      )
      .innerJoin(tenantAccess, eq(tenantAccess.tenantId, scanRuns.tenantId))
      .where(
        and(
          eq(controlledOriginalIndex.tenantId, tenant),
          eq(controlledOriginalIndex.runId, run),
          eq(tenantAccess.orgId, user.orgId),
          eq(tenantAccess.userId, user.id),
          eq(scanRuns.retentionLock, 0),
        ),
      )
      .limit(1);
    const entry = rows[0];
    const runDeadline = new Date(entry?.startedAt ?? "");
    runDeadline.setUTCFullYear(runDeadline.getUTCFullYear() + 1);
    if (
      !entry ||
      !Number.isFinite(runDeadline.getTime()) ||
      entry.expiresAt <= new Date().toISOString() ||
      Date.now() >= runDeadline.getTime() ||
      entry.size < 1 ||
      entry.size > 64 * 1024 ||
      !/^[-a-zA-Z0-9_]+\/[a-f0-9-]{36}$/.test(entry.objectKey) ||
      !entry.objectKey.startsWith(`${tenant}/`) ||
      !/^[a-f0-9]{64}$/.test(entry.digest)
    )
      return unavailable();
    const object = await env.REPORTS.get(entry.objectKey);
    if (!object) return unavailable();
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.length !== entry.size) return unavailable();
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== entry.digest) return unavailable();
    const archive = zipSync(
      { "controlled-original-v1.html": bytes },
      { level: 0 },
    );
    if (
      entry.expiresAt <= new Date().toISOString() ||
      Date.now() >= runDeadline.getTime()
    )
      return unavailable();
    return new Response(new Uint8Array(archive).buffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="maester-controlled-report.zip"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
        "referrer-policy": "no-referrer",
      },
    });
  } catch {
    return unavailable();
  }
}
