import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return state.current;
  },
}));
const { handleControlledRequest } = await import("./controlledDownload");
const user = {
  id: "pilot",
  email: "mvanfalier@atura.nl",
  orgId: "org",
  channel: "web",
  actor: { sub: "pilot" },
};
const other = { ...user, id: "stranger", actor: { sub: "stranger" } };
const html = new TextEncoder().encode(
  "<!doctype html><html><body>Controlled derivative</body></html>",
);
let db: ReturnType<typeof drizzle<typeof schema>>;
let object: Uint8Array | null;
const bucket = {
  get: vi.fn(async (_key: string) =>
    object ? { arrayBuffer: async () => new Uint8Array(object!).buffer } : null,
  ),
};
const env = {
  PILOT_USER_ID: "pilot",
  PILOT_ORG_ID: "org",
  REPORTS: bucket as unknown as R2Bucket,
};
const url = (tenant = "tenant", run = "run") =>
  `https://app.example/api/controlled-original?tenant=${tenant}&run=${run}`;
const sha = async (data: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

beforeEach(async () => {
  bucket.get.mockClear();
  db = drizzle(createClient({ url: ":memory:" }), { schema });
  state.current = db;
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  await db.insert(schema.tenantRegistry).values([
    { id: "tenant", name: "Atura" },
    { id: "other", name: "Other" },
  ]);
  await db
    .insert(schema.tenantAccess)
    .values({ tenantId: "tenant", orgId: "org", userId: "pilot" });
  await db.insert(schema.scanRuns).values({
    id: "run",
    tenantId: "tenant",
    suite: "daily",
    benchmark: "daily",
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    scanStatus: "completed",
    expectedTestIds: '["MT.1001"]',
  });
  await db.insert(schema.controlledOriginalIndex).values({
    runId: "run",
    tenantId: "tenant",
    artifactId: 902,
    objectKey: "tenant/00000000-0000-4000-8000-000000000001",
    digest: await sha(html),
    size: html.length,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  object = html;
});

describe("controlled derivative archive perimeter", () => {
  it("delivers only a ZIP attachment with exact checked HTML to the current tenant grant", async () => {
    const response = await handleControlledRequest(
      new Request(url()),
      env,
      user,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/zip");
    expect(response?.headers.get("content-disposition")).toContain(
      "attachment;",
    );
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    const entries = unzipSync(new Uint8Array(await response!.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["controlled-original-v1.html"]);
    expect(entries["controlled-original-v1.html"]).toEqual(html);
  });
  it("rejects absent, wrong-user, wrong-tenant, revoked-grant and locked requests before reading R2", async () => {
    expect(
      (await handleControlledRequest(new Request(url()), env, null))?.status,
    ).toBe(401);
    expect(
      (await handleControlledRequest(new Request(url()), env, other))?.status,
    ).toBe(403);
    expect(
      (await handleControlledRequest(new Request(url("other")), env, user))
        ?.status,
    ).toBe(403);
    expect(bucket.get).not.toHaveBeenCalled();
    await db.delete(schema.tenantAccess);
    expect(
      (await handleControlledRequest(new Request(url()), env, user))?.status,
    ).toBe(403);
    await db
      .insert(schema.tenantAccess)
      .values({ tenantId: "tenant", orgId: "org", userId: "pilot" });
    await db.update(schema.scanRuns).set({ retentionLock: 1 });
    expect(
      (await handleControlledRequest(new Request(url()), env, user))?.status,
    ).toBe(403);
    expect(bucket.get).not.toHaveBeenCalled();
  });
  it("refuses missing or corrupted private bytes, expired metadata, and non-GET methods", async () => {
    object = null;
    expect(
      (await handleControlledRequest(new Request(url()), env, user))?.status,
    ).toBe(403);
    object = new TextEncoder().encode("<script>corrupt()</script>");
    expect(
      (await handleControlledRequest(new Request(url()), env, user))?.status,
    ).toBe(403);
    object = html;
    await db
      .update(schema.controlledOriginalIndex)
      .set({ expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(
      (await handleControlledRequest(new Request(url()), env, user))?.status,
    ).toBe(403);
    expect(
      (
        await handleControlledRequest(
          new Request(url(), { method: "POST" }),
          env,
          user,
        )
      )?.status,
    ).toBe(405);
  });
});
