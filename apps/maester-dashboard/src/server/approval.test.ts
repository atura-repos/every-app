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
let client: ReturnType<typeof createClient>;
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
  delete: vi.fn(async (key: string) => {
    objects.delete(key);
  }),
};
const sweepDb = (): D1Database =>
  ({
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async all() {
          return {
            results: (await client.execute({ sql, args: args as never[] }))
              .rows,
          };
        },
        async first() {
          return (
            (await client.execute({ sql, args: args as never[] })).rows[0] ??
            null
          );
        },
        async run() {
          await client.execute({ sql, args: args as never[] });
          return { success: true };
        },
      };
      return statement;
    },
  }) as unknown as D1Database;
beforeEach(async () => {
  objects.clear();
  bucket.put.mockClear();
  bucket.get.mockClear();
  client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema });
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
  it("keeps only the indexed PDF after two concurrent concept creations", async () => {
    let arrivals = 0;
    let release!: () => void;
    const bothUploaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    const put = bucket.put.getMockImplementation()!;
    bucket.put.mockImplementation(async (key: string, bytes: Uint8Array) => {
      await put(key, bytes);
      if (++arrivals === 2) release();
      await bothUploaded;
    });
    const versions = await Promise.all([
      createConcept(user, config, bucket, "tenant", "run"),
      createConcept(user, config, bucket, "tenant", "run"),
    ]);
    expect(versions.map((v) => v.status)).toEqual(["concept", "concept"]);
    const rows = await db.select().from(schema.reportVersions);
    expect(rows).toHaveLength(1);
    expect(objects.size).toBe(1);
    expect(objects.has(rows[0].objectKey)).toBe(true);
  });
  it("pre-registers each PDF upload so an interrupted upload can be swept without a report version", async () => {
    const put = bucket.put.getMockImplementation()!;
    bucket.put.mockImplementationOnce(
      async (key: string, bytes: Uint8Array) => {
        const pending = await db.select().from(schema.pendingR2Objects);
        expect(pending.map((row) => row.objectKey)).toEqual([key]);
        await put(key, bytes);
        throw new Error("interrupted upload");
      },
    );
    await expect(
      createConcept(user, config, bucket, "tenant", "run"),
    ).rejects.toThrow("interrupted upload");
    expect(await db.select().from(schema.reportVersions)).toHaveLength(0);
    const pending = await db.select().from(schema.pendingR2Objects);
    expect(pending).toHaveLength(1);
    const { expireImports } = await import("./ingest");
    await expireImports(
      sweepDb(),
      bucket as unknown as R2Bucket,
      new Date("2027-11-04T00:00:00Z"),
    );
    expect(await db.select().from(schema.pendingR2Objects)).toHaveLength(0);
    expect(objects.size).toBe(0);
  });
  it("keeps an expiry ledger through a late R2 write and sweeps its bytes again", async () => {
    const put = bucket.put.getMockImplementation()!;
    let began!: () => void;
    let allowWrite!: () => void;
    let wrote!: () => void;
    let finish!: () => void;
    const atPut = new Promise<void>((resolve) => {
      began = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      allowWrite = resolve;
    });
    const atWritten = new Promise<void>((resolve) => {
      wrote = resolve;
    });
    const finishGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    bucket.put.mockImplementationOnce(
      async (key: string, bytes: Uint8Array) => {
        began();
        await writeGate;
        await put(key, bytes);
        wrote();
        await finishGate;
        throw new Error("Worker interrupted");
      },
    );
    const creating = createConcept(user, config, bucket, "tenant", "run");
    await atPut;
    const { expireImports } = await import("./ingest");
    await expireImports(
      sweepDb(),
      bucket as unknown as R2Bucket,
      new Date("2027-11-03T06:00:00Z"),
    );
    expect(await db.select().from(schema.pendingR2Objects)).toHaveLength(1);
    allowWrite();
    await atWritten;
    expect(objects.size).toBe(1);
    await expireImports(
      sweepDb(),
      bucket as unknown as R2Bucket,
      new Date("2027-11-03T12:00:00Z"),
    );
    expect(objects.size).toBe(0);
    finish();
    await expect(creating).rejects.toThrow("Worker interrupted");
  });
  it("cleans a partially uploaded PDF when R2 put reports a failure", async () => {
    const put = bucket.put.getMockImplementation()!;
    bucket.put.mockImplementationOnce(
      async (key: string, bytes: Uint8Array) => {
        await put(key, bytes);
        throw new Error("R2 put interrupted");
      },
    );
    await expect(
      createConcept(user, config, bucket, "tenant", "run"),
    ).rejects.toThrow("R2 put interrupted");
    expect(objects.size).toBe(0);
    expect(await db.select().from(schema.reportVersions)).toHaveLength(0);
  });
  it("does not leave a PDF behind when retention starts during concept rendering", async () => {
    const put = bucket.put.getMockImplementation()!;
    bucket.put.mockImplementationOnce(
      async (key: string, bytes: Uint8Array) => {
        await put(key, bytes);
        await db.run("UPDATE scan_runs SET retention_lock=1 WHERE id='run'");
      },
    );
    await expect(
      createConcept(user, config, bucket, "tenant", "run"),
    ).rejects.toThrow("Retention in progress");
    expect(objects.size).toBe(0);
    expect(await db.select().from(schema.reportVersions)).toHaveLength(0);
  });
  it("cleans R2 when saving the concept version fails before D1 commits", async () => {
    const insert = vi.spyOn(db, "run").mockImplementation(() => {
      throw new Error("D1 unavailable");
    });
    try {
      await expect(
        createConcept(user, config, bucket, "tenant", "run"),
      ).rejects.toThrow("D1 unavailable");
      expect(objects.size).toBe(0);
    } finally {
      insert.mockRestore();
    }
  });
  it("denies PDF status and downloads at the retention deadline before the sweep", async () => {
    const concept = await createConcept(user, config, bucket, "tenant", "run");
    await approveConcept(user, config, "tenant", "run", concept.digest);
    bucket.get.mockClear();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-11-03T00:00:00Z"));
      await expect(reportStatus(user, config, "tenant", "run")).rejects.toThrow(
        "Report expired",
      );
      await expect(
        downloadReport(user, config, bucket, "tenant", "run", concept.digest),
      ).rejects.toThrow("Report expired");
      await expect(
        downloadReport(
          user,
          config,
          bucket,
          "tenant",
          "run",
          concept.digest,
          true,
        ),
      ).rejects.toThrow("Report expired");
      expect(bucket.get).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not finish an in-flight PDF download after the retention deadline", async () => {
    const concept = await createConcept(user, config, bucket, "tenant", "run");
    await approveConcept(user, config, "tenant", "run", concept.digest);
    const get = bucket.get.getMockImplementation()!;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-11-02T23:59:59Z"));
      bucket.get.mockImplementationOnce(async (key: string) => {
        const object = await get(key);
        vi.setSystemTime(new Date("2027-11-03T00:00:00Z"));
        return object;
      });
      await expect(
        downloadReport(user, config, bucket, "tenant", "run", concept.digest),
      ).rejects.toThrow("Report expired");
    } finally {
      vi.useRealTimers();
    }
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
