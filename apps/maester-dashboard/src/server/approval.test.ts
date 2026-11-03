import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));
const { createConcept, approveConcept, downloadReport, reportStatus } =
  await import("./approval");
const user = {
  id: "pilot",
  email: "mvanfalier@atura.nl",
  orgId: "org",
  channel: "web",
  actor: { sub: "pilot" },
};
const config = { PILOT_USER_ID: "pilot", PILOT_ORG_ID: "org" };
let db: ReturnType<typeof drizzle<typeof schema>>;
const objects = new Map<string, Uint8Array>();
const bucket = {
  put: vi.fn(async (key: string, bytes: Uint8Array) => {
    objects.set(key, bytes);
  }),
  get: vi.fn(async (key: string) => {
    const bytes = objects.get(key);
    return bytes
      ? {
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
        }
      : null;
  }),
};
beforeEach(async () => {
  objects.clear();
  bucket.put.mockClear();
  bucket.get.mockClear();
  db = drizzle(createClient({ url: ":memory:" }), { schema });
  testDb.current = db;
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  await db.insert(schema.tenantRegistry).values([
    { id: "tenant", name: "Klant BV" },
    { id: "other", name: "Ander" },
  ]);
  await db
    .insert(schema.tenantAccess)
    .values({ tenantId: "tenant", orgId: "org", userId: "pilot" });
  await db.insert(schema.scanRuns).values({
    id: "run",
    tenantId: "tenant",
    suite: "cis",
    benchmark: "v1",
    schemaVersion: 1,
    startedAt: "2026-11-03",
    scanStatus: "completed",
    workflowConclusion: "failure",
    expectedTestIds: '["a"]',
  });
  await db.insert(schema.controlResults).values({
    runId: "run",
    tenantId: "tenant",
    testId: "a",
    title: "Controle",
    result: "Failed",
  });
});

describe("versioned report authorization and audit", () => {
  it("requires an explicit employee decision on exact digest before attachment download", async () => {
    const concept = await createConcept(user, config, bucket, "tenant", "run");
    expect(concept.status).toBe("concept");
    expect(bucket.put).toHaveBeenCalledTimes(1);
    await expect(
      downloadReport(user, config, bucket, "tenant", "run", concept.digest),
    ).rejects.toThrow();
    await expect(
      approveConcept(user, config, "tenant", "run", "0".repeat(64)),
    ).rejects.toThrow();
    const approved = await approveConcept(
      user,
      config,
      "tenant",
      "run",
      concept.digest,
    );
    expect(approved.status).toBe("approved");
    const response = await downloadReport(
      user,
      config,
      bucket,
      "tenant",
      "run",
      concept.digest,
    );
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(
      new TextDecoder().decode(
        new Uint8Array(await response.arrayBuffer()).slice(0, 5),
      ),
    ).toBe("%PDF-");
    expect(
      (await db.select().from(schema.reportApprovalEvents)).map(
        (e) => e.actorId,
      ),
    ).toEqual(["pilot"]);
  });
  it("lets the authorized employee download the draft to inspect before approval", async () => {
    const concept = await createConcept(user, config, bucket, "tenant", "run");
    const draft = await downloadReport(
      user,
      config,
      bucket,
      "tenant",
      "run",
      concept.digest,
      true,
    );
    expect(draft.headers.get("content-disposition")).toContain("attachment");
    expect(
      new TextDecoder().decode(
        new Uint8Array(await draft.arrayBuffer()).slice(0, 5),
      ),
    ).toBe("%PDF-");
    expect((await reportStatus(user, config, "tenant", "run")).status).toBe(
      "concept",
    );
    await expect(
      downloadReport(
        { ...user, id: "stranger" },
        config,
        bucket,
        "tenant",
        "run",
        concept.digest,
        true,
      ),
    ).rejects.toThrow();
  });
  it("invalidates approval if a normalized source field changes, never reuses old approval", async () => {
    const old = await createConcept(user, config, bucket, "tenant", "run");
    await approveConcept(user, config, "tenant", "run", old.digest);
    await db.update(schema.controlResults).set({ title: "Andere betekenis" });
    await expect(
      downloadReport(user, config, bucket, "tenant", "run", old.digest),
    ).rejects.toThrow();
    await expect(
      approveConcept(user, config, "tenant", "run", old.digest),
    ).rejects.toThrow();
    const next = await createConcept(user, config, bucket, "tenant", "run");
    expect(next.digest).not.toBe(old.digest);
    expect(next.status).toBe("concept");
    expect((await reportStatus(user, config, "tenant", "run")).status).toBe(
      "concept",
    );
  });
  it("rejects other identities and tenants before touching R2, and fails closed on missing objects", async () => {
    await expect(
      createConcept(
        { ...user, id: "stranger" },
        config,
        bucket,
        "tenant",
        "run",
      ),
    ).rejects.toThrow();
    await expect(
      createConcept(user, config, bucket, "other", "run"),
    ).rejects.toThrow();
    expect(bucket.put).not.toHaveBeenCalled();
    const concept = await createConcept(user, config, bucket, "tenant", "run");
    await approveConcept(user, config, "tenant", "run", concept.digest);
    objects.clear();
    await expect(
      downloadReport(user, config, bucket, "tenant", "run", concept.digest),
    ).rejects.toThrow();
  });
});
