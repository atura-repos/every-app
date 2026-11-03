import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { zipSync, strToU8 } from "fflate";
import {
  reconcile,
  validateExport,
  expireImports,
  extractProjection,
} from "./ingest";

const pem = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const privatePem = `-----BEGIN PRIVATE KEY-----\n${btoa(
  String.fromCharCode(
    ...new Uint8Array(await crypto.subtle.exportKey("pkcs8", pem.privateKey)),
  ),
)
  .match(/.{1,64}/g)!
  .join("\n")}\n-----END PRIVATE KEY-----`;
const doc = {
  schema_version: 1,
  tenant_id: "atura",
  expected_test_ids: ["a", "b"],
  scan_status: "completed",
  error_count: 0,
  controls: [
    { id: "a", result: "Passed" },
    { id: "b", result: "Skipped" },
  ],
};
const zip = (value: unknown) =>
  zipSync({ "dashboard-result-v1.json": strToU8(JSON.stringify(value)) });
const controlledHtml = () =>
  strToU8(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Atura controlled assessment derivative</title><style>' +
      "body{font:16px system-ui,sans-serif;color:#17233b;background:#f5f7fa;margin:0;padding:2rem}main{max-width:60rem;margin:auto;background:white;padding:2rem;border-top:6px solid #156f86}h1{color:#125469}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #d5dfe5;padding:.65rem}small{color:#48566b}" +
      "</style></head><body><main><h1>Atura | Assessment</h1><p>Controlled derivative (controlled-original-v1); not the original Maester HTML report. Evidence, errors and free-text titles are intentionally omitted.</p>" +
      "<p>Suite: Maester daily | Run 100 | Attempt 1</p><h2>Control outcomes</h2><table><thead><tr><th>Control ID</th><th>Result</th></tr></thead><tbody><tr><td>a</td><td>Passed</td></tr><tr><td>b</td><td>Skipped</td></tr></tbody></table><p><small>Atura Security | Statuses are recorded without supporting evidence.</small></p></main></body></html>",
  );
const controlledZip = (bytes = controlledHtml()) =>
  zipSync({ "controlled-original-v1.html": bytes });
// GitHub's upload-artifact ZIP uses flag bit 3 and a trailing data descriptor.
function zipWithDescriptor(value: unknown) {
  const original = zip(value);
  const end = new DataView(
    original.buffer,
    original.byteOffset,
    original.byteLength,
  );
  const central = end.getUint32(original.length - 6, true);
  const result = new Uint8Array(original.length + 16);
  result.set(original.subarray(0, central));
  result.set(original.subarray(central), central + 16);
  const view = new DataView(result.buffer);
  view.setUint16(6, 8, true);
  view.setUint32(14, 0, true);
  view.setUint32(18, 0, true);
  view.setUint32(22, 0, true);
  view.setUint32(central, 0x08074b50, true);
  view.setUint32(central + 4, end.getUint32(central + 16, true), true);
  view.setUint32(central + 8, end.getUint32(central + 20, true), true);
  view.setUint32(central + 12, end.getUint32(central + 24, true), true);
  view.setUint16(central + 16 + 8, 8, true);
  view.setUint32(result.length - 6, central + 16, true);
  return result;
}
let client: ReturnType<typeof createClient>;
let db: D1Database;
let objects: Map<string, Uint8Array>;
let bucket: R2Bucket;
let fetcher: typeof fetch;
let calls: string[];
const now = new Date("2026-11-03T00:00:00Z");
const settings = { GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: privatePem };

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await migrate(drizzle(client, { schema }), {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  await client.execute(
    "INSERT INTO tenant_registry(id,name) VALUES ('atura','Atura')",
  );
  await client.execute(
    "INSERT INTO github_repositories(repo_id,tenant_id,owner,repo,installation_id) VALUES (42,'atura','atura','scanner',7)",
  );
  await client.execute(
    "INSERT INTO github_sources(repo_id,workflow_id,workflow_ref,workflow_path,artifact_name,enabled) VALUES (42,12,'refs/heads/main','.github/workflows/maester.yml','maester-atura-dashboard',1)",
  );
  db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const query = {
        bind(...args: unknown[]) {
          values = args;
          return query;
        },
        async all() {
          const r = await client.execute({ sql, args: values as never[] });
          return { results: r.rows };
        },
        async first() {
          const r = await client.execute({ sql, args: values as never[] });
          return r.rows[0] ?? null;
        },
        async run() {
          await client.execute({ sql, args: values as never[] });
          return { success: true };
        },
      };
      return query;
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
  objects = new Map();
  bucket = {
    async put(k: string, v: ArrayBuffer | Uint8Array) {
      objects.set(k, new Uint8Array(v));
      return {} as R2Object;
    },
    async get(k: string) {
      const v = objects.get(k);
      return v
        ? ({
            arrayBuffer: async () =>
              v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength),
          } as R2ObjectBody)
        : null;
    },
    async delete(k: string) {
      objects.delete(k);
    },
  } as unknown as R2Bucket;
  calls = [];
  fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.endsWith("/access_tokens")) {
      expect(JSON.parse(init!.body as string)).toEqual({
        repository_ids: [42],
        permissions: { actions: "read", metadata: "read" },
      });
      return Response.json({ token: "ephemeral" });
    }
    if (url.includes("/workflows/12/runs"))
      return Response.json({
        workflow_runs: [
          {
            id: 100,
            run_attempt: 1,
            status: "completed",
            event: "push",
            head_branch: "main",
            head_repository: { id: 42 },
            head_sha: "a".repeat(40),
            created_at: "2026-11-02T00:00:00Z",
            conclusion: "failure",
            workflow_id: 12,
            path: ".github/workflows/maester.yml@refs/heads/main",
          },
        ],
      });
    if (url.endsWith("/runs/100/artifacts?per_page=100"))
      return Response.json({
        artifacts: [
          {
            id: 900,
            name: "maester-atura-dashboard-100",
            size_in_bytes: 500,
            expired: false,
            workflow_run: { id: 100, head_repository_id: 42 },
          },
          {
            id: 901,
            name: "maester-atura-100",
            size_in_bytes: 500,
            expired: false,
            workflow_run: { id: 100, head_repository_id: 42 },
          },
          {
            id: 902,
            name: "maester-atura-controlled-original-v1-100-1",
            size_in_bytes: 2000,
            expired: false,
            workflow_run: { id: 100, head_repository_id: 42 },
          },
        ],
      });
    if (url.endsWith("/artifacts/900/zip"))
      return new Response(new Uint8Array(zip(doc)).buffer);
    if (url.endsWith("/artifacts/902/zip"))
      return new Response(new Uint8Array(controlledZip()).buffer);
    throw Error("Unexpected fetch");
  }) as typeof fetch;
});

describe("validated private reconciliation", () => {
  it("matches the scanner's independently rendered controlled HTML bytes", async () => {
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(controlledHtml()).buffer,
      ),
    );
    expect(
      Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(""),
    ).toBe("28c6dfb8db10b40153d99eacb205a586f2cd056351fe8177a5333652541ce1b9");
  });
  it("stores canonical controlled HTML separately and expires its private bytes", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const rows = (
      await client.execute("SELECT * FROM controlled_original_index")
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: "atura",
      run_id: "42:100:1:900",
      artifact_id: 902,
      size: controlledHtml().length,
      expires_at: "2027-11-02T00:00:00.000Z",
    });
    expect(objects.get(rows[0].object_key as string)).toEqual(controlledHtml());
    expect(rows[0].object_key).not.toBe(
      (await client.execute("SELECT object_key FROM artifact_index")).rows[0]
        .object_key,
    );
    await expireImports(db, bucket, new Date("2027-11-04T00:00:00Z"));
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
    expect(objects.size).toBe(0);
  });
  it("does not report an expired GitHub artifact missing when its indexed controlled copy is intact", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/runs/100/artifacts?per_page=100")) {
        const payload = (await (await original(url, init)).json()) as {
          artifacts: Record<string, unknown>[];
        };
        return Response.json({
          artifacts: payload.artifacts.filter(
            (artifact) => artifact.id !== 902,
          ),
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(1);
  });
  it("records a safe status if the indexed copy is lost after GitHub artifact expiry", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const key = (
      await client.execute("SELECT object_key FROM controlled_original_index")
    ).rows[0].object_key as string;
    objects.delete(key);
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/runs/100/artifacts?per_page=100")) {
        const payload = (await (await original(url, init)).json()) as {
          artifacts: Record<string, unknown>[];
        };
        return Response.json({
          artifacts: payload.artifacts.filter(
            (artifact) => artifact.id !== 902,
          ),
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "controlled_missing" }]);
  });
  it("records absent controlled artifact safely without blocking projection", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/runs/100/artifacts?per_page=100")) {
        const payload = (await (await original(url, init)).json()) as {
          artifacts: Record<string, unknown>[];
        };
        return Response.json({
          artifacts: payload.artifacts.filter((a) => a.id !== 902),
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM artifact_index")).rows,
    ).toHaveLength(1);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "controlled_missing" }]);
  });
  it("retries rejected HTML later without blocking indexed projection", async () => {
    const original = fetcher;
    let archive = controlledZip(strToU8("<script>bad()</script>"));
    fetcher = (async (url: string, init?: RequestInit) =>
      url.endsWith("/artifacts/902/zip")
        ? new Response(new Uint8Array(archive).buffer)
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM artifact_index")).rows,
    ).toHaveLength(1);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
    archive = controlledZip();
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(1);
  });
  it("rejects cross-run controlled artifact binding and legacy ZIP member", async () => {
    const original = fetcher;
    let crossRun = true;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/artifacts/902/zip") && !crossRun)
        return new Response(
          new Uint8Array(zipSync({ "legacy.html": controlledHtml() })).buffer,
        );
      if (url.endsWith("/runs/100/artifacts?per_page=100") && crossRun) {
        const payload = (await (await original(url, init)).json()) as {
          artifacts: Record<string, unknown>[];
        };
        return Response.json({
          artifacts: payload.artifacts.map((a) =>
            a.id === 902
              ? { ...a, workflow_run: { id: 101, head_repository_id: 42 } }
              : a,
          ),
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
    crossRun = false;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
  });
  it("rejects a forged controlled ZIP descriptor and preserves the projection", async () => {
    const original = fetcher;
    const archive = controlledZip();
    const view = new DataView(archive.buffer);
    const central = view.getUint32(archive.length - 6, true);
    view.setUint32(central + 24, 65537, true);
    fetcher = (async (url: string, init?: RequestInit) =>
      url.endsWith("/artifacts/902/zip")
        ? new Response(new Uint8Array(archive).buffer)
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM artifact_index")).rows,
    ).toHaveLength(1);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
  });
  it("retains a pending ledger for uncertain D1 controlled readback and expires orphan bytes", async () => {
    const actual = db;
    db = {
      ...actual,
      prepare(sql: string) {
        const stmt = actual.prepare(sql);
        if (
          !sql.startsWith(
            "SELECT artifact_id,object_key,digest,size FROM controlled_original_index",
          )
        )
          return stmt;
        return {
          ...stmt,
          bind(...args: unknown[]) {
            return { ...stmt.bind(...args), first: async () => null };
          },
        } as D1PreparedStatement;
      },
    } as D1Database;
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "Private import rejected",
    );
    db = actual;
    expect(
      (await client.execute("SELECT * FROM pending_r2_objects")).rows,
    ).toHaveLength(2);
    await expireImports(db, bucket, new Date("2027-11-04T00:00:00Z"));
    expect(objects.size).toBe(0);
  });
  it("cleans partial controlled R2 writes and retries next schedule", async () => {
    const put = bucket.put.bind(bucket);
    let failOnce = true;
    bucket.put = (async (key: string, bytes: Uint8Array) => {
      if (key !== undefined && failOnce && objects.size === 1) {
        failOnce = false;
        objects.set(key, new Uint8Array(bytes));
        throw Error("R2 unavailable");
      }
      return put(key, bytes);
    }) as R2Bucket["put"];
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
    expect(objects.size).toBe(1); // projection only
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(1);
  });
  it("does not orphan a controlled upload when expiry wins after the ledger write", async () => {
    const put = bucket.put.bind(bucket);
    let expired = false;
    bucket.put = (async (key: string, bytes: Uint8Array) => {
      if (!expired && objects.size === 1) {
        expired = true;
        await expireImports(db, bucket, new Date("2027-11-04T00:00:00Z"));
      }
      return put(key, bytes);
    }) as R2Bucket["put"];
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
    expect(objects.size).toBe(0);
  });
  it("does not delete a peer's successful indexed repair when its own R2 write fails", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const key = (
      await client.execute("SELECT object_key FROM controlled_original_index")
    ).rows[0].object_key as string;
    const saved = objects.get(key)!;
    objects.delete(key);
    const put = bucket.put.bind(bucket);
    let reached!: () => void;
    let release!: () => void;
    const atFailure = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let repairs = 0;
    bucket.put = (async (objectKey: string, bytes: Uint8Array) => {
      if (objectKey === key && ++repairs === 1) {
        reached();
        await gate;
        throw Error("R2 unavailable");
      }
      return put(objectKey, bytes);
    }) as R2Bucket["put"];
    const first = reconcile(db, bucket, settings, fetcher, now);
    await atFailure;
    await reconcile(db, bucket, settings, fetcher, now);
    release();
    await first;
    expect(objects.get(key)).toEqual(saved);
  });
  it("does not resurrect indexed controlled bytes when expiry wins during repair", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const rows = (
      await client.execute("SELECT object_key FROM controlled_original_index")
    ).rows;
    const key = rows[0].object_key as string;
    objects.delete(key);
    const put = bucket.put.bind(bucket);
    bucket.put = (async (objectKey: string, bytes: Uint8Array) => {
      if (objectKey === key)
        await expireImports(db, bucket, new Date("2027-11-04T00:00:00Z"));
      return put(objectKey, bytes);
    }) as R2Bucket["put"];
    await reconcile(db, bucket, settings, fetcher, now);
    expect(objects.has(key)).toBe(false);
    expect(
      (await client.execute("SELECT * FROM controlled_original_index")).rows,
    ).toHaveLength(0);
  });
  it("isolates a broken ZIP, retries it next schedule, and clears the resolved event", async () => {
    const original = fetcher;
    let broken = true;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/12/runs")) {
        const response = await original(url, init);
        const data = (await response.json()) as {
          workflow_runs: Record<string, unknown>[];
        };
        return Response.json({
          workflow_runs: [
            { ...data.workflow_runs[0], id: 101 },
            data.workflow_runs[0],
          ],
        });
      }
      if (url.endsWith("/runs/101/artifacts?per_page=100")) {
        const response = await original(url.replace("101", "100"), init);
        const data = (await response.json()) as {
          artifacts: Record<string, unknown>[];
        };
        return Response.json({
          artifacts: data.artifacts.map((a) => ({
            ...a,
            id: (a.id as number) + 10,
            name: (a.name as string).replace("100", "101"),
            workflow_run: { id: 101, head_repository_id: 42 },
          })),
        });
      }
      if (url.endsWith("/artifacts/910/zip"))
        return broken
          ? new Response("bad zip")
          : new Response(new Uint8Array(zip(doc)).buffer);
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT id FROM scan_runs")).rows,
    ).toHaveLength(1);
    expect(
      (await client.execute("SELECT id,code FROM import_events")).rows,
    ).toEqual([{ id: "42:101:1", code: "import_failed" }]);
    broken = false;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT id FROM scan_runs")).rows,
    ).toHaveLength(2);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
  });
  it("isolates a failed source listing and retries it without blocking another source", async () => {
    await client.execute(
      "INSERT INTO github_sources(repo_id,workflow_id,workflow_ref,workflow_path,artifact_name,enabled) VALUES (42,13,'refs/heads/main','.github/workflows/other.yml','maester-atura-cis-graph-dashboard',1)",
    );
    const original = fetcher;
    let unavailable = true;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/13/runs")) {
        if (unavailable) throw new Error("Bearer secret in transport error");
        return Response.json({ workflow_runs: [] });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
    expect(
      (await client.execute("SELECT id,code FROM import_events")).rows,
    ).toEqual([{ id: "42:13:source", code: "import_failed" }]);
    unavailable = false;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
  });
  it("accepts the data-descriptor ZIP emitted by GitHub Actions", () => {
    const body = extractProjection(zipWithDescriptor(doc));
    expect(
      validateExport(JSON.parse(new TextDecoder().decode(body)), "atura"),
    ).toEqual(doc);
  });
  it("rejects a forged data descriptor even if the ZIP central directory is intact", () => {
    const tampered = zipWithDescriptor(doc);
    const end = new DataView(tampered.buffer);
    const central = end.getUint32(tampered.length - 6, true);
    end.setUint32(central - 4, 0, true);
    expect(() => extractProjection(tampered)).toThrow(
      "Private import rejected",
    );
  });
  it("rejects unknown fields, malformed scope, duplicates, unsafe titles and oversized export", () => {
    expect(() => validateExport({ ...doc, raw: "secret" }, "atura")).toThrow();
    expect(() =>
      validateExport({ ...doc, tenant_id: "other" }, "atura"),
    ).toThrow();
    expect(() =>
      validateExport({ ...doc, expected_test_ids: ["a", "a"] }, "atura"),
    ).toThrow();
    expect(() =>
      validateExport(
        { ...doc, controls: [{ id: "c", result: "Passed" }] },
        "atura",
      ),
    ).toThrow();
    expect(() =>
      validateExport(
        {
          ...doc,
          controls: [{ id: "a", result: "Passed", title: "Bearer abc" }],
        },
        "atura",
      ),
    ).toThrow();
    expect(() =>
      validateExport(
        {
          ...doc,
          controls: [{ id: "a", result: "Passed", title: "x".repeat(300) }],
        },
        "atura",
      ),
    ).toThrow();
    expect(() =>
      validateExport(
        { ...doc, controls: [{ id: "a", result: "Skipped" }] },
        "atura",
      ),
    ).not.toThrow();
  });
  it("paginates bounded run-list responses instead of requesting 100 oversized records", async () => {
    const original = fetcher;
    const pages: string[] = [];
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/12/runs")) {
        pages.push(url);
        if (!url.includes("per_page=10"))
          return Response.json({ padding: "x".repeat(100_000) });
        if (url.endsWith("&page=1"))
          return Response.json({
            padding: "x".repeat(100_000),
            workflow_runs: Array.from({ length: 10 }, (_, i) => ({
              id: 200 + i,
              run_attempt: 1,
              status: "queued",
            })),
          });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain("page=2");
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
  });
  it("imports once with scoped short-lived token and reads back D1 and R2", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
    expect(
      (await client.execute("SELECT * FROM control_results")).rows,
    ).toHaveLength(2);
    const rows = (await client.execute("SELECT * FROM artifact_index")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe("atura");
    expect(objects.has(rows[0].object_key as string)).toBe(true);
    expect(
      calls.some((url) => url.includes("/installation/repositories")),
    ).toBe(false);
  });
  it("migrates existing source rows without silently enabling unverified paths", async () => {
    const legacy = createClient({ url: ":memory:" });
    await legacy.execute(
      "CREATE TABLE tenant_registry(id text PRIMARY KEY, name text NOT NULL)",
    );
    await legacy.execute(
      "INSERT INTO tenant_registry VALUES ('atura','Atura')",
    );
    await legacy.execute(
      "CREATE TABLE github_sources(tenant_id text NOT NULL, repo_id integer PRIMARY KEY, owner text NOT NULL, repo text NOT NULL, installation_id integer NOT NULL, workflow_id integer NOT NULL, workflow_ref text NOT NULL, artifact_name text NOT NULL, enabled integer NOT NULL)",
    );
    await legacy.execute(
      "INSERT INTO github_sources VALUES ('atura',42,'atura','scanner',7,12,'refs/heads/main','maester-atura-dashboard',1)",
    );
    const sql = readFileSync(
      fileURLToPath(
        new URL("../../drizzle/0005_dry_cassandra_nova.sql", import.meta.url),
      ),
      "utf8",
    );
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await legacy.execute(statement);
    }
    expect(
      (
        await legacy.execute(
          "SELECT tenant_id,repo_id FROM github_repositories",
        )
      ).rows,
    ).toMatchObject([{ tenant_id: "atura", repo_id: 42 }]);
    expect(
      (await legacy.execute("SELECT workflow_path,enabled FROM github_sources"))
        .rows,
    ).toMatchObject([{ workflow_path: "", enabled: 0 }]);
    expect(
      (await legacy.execute("PRAGMA foreign_key_check")).rows,
    ).toHaveLength(0);
    await legacy.close();
  });
  it("stores four workflows in one repository but prohibits a second tenant for that repository", async () => {
    for (const [id, name] of [
      [13, "maester-atura-cis-graph-dashboard"],
      [14, "maester-atura-cis-exo-dashboard"],
      [15, "maester-atura-cis-teams-dashboard"],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO github_sources(repo_id,workflow_id,workflow_ref,workflow_path,artifact_name,enabled) VALUES (?,?,?,?,?,1)",
        args: [42, id, "refs/heads/main", `.github/workflows/${id}.yml`, name],
      });
    }
    expect(
      (await client.execute("SELECT * FROM github_sources WHERE repo_id=42"))
        .rows,
    ).toHaveLength(4);
    await client.execute(
      "INSERT INTO tenant_registry(id,name) VALUES ('other','Other')",
    );
    await expect(
      client.execute(
        "INSERT INTO github_repositories(repo_id,tenant_id,owner,repo,installation_id) VALUES (42,'other','other','scanner',7)",
      ),
    ).rejects.toThrow();
    await expect(
      client.execute(
        "UPDATE github_repositories SET tenant_id='other' WHERE repo_id=42",
      ),
    ).rejects.toThrow();
  });
  it("rejects a run from a different workflow despite the workflow-list endpoint", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/12/runs")) {
        const response = await original(url, init);
        const data = (await response.json()) as {
          workflow_runs: Record<string, unknown>[];
        };
        return Response.json({
          workflow_runs: [{ ...data.workflow_runs[0], workflow_id: 13 }],
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
    expect(calls.some((url) => url.includes("/runs/100/artifacts"))).toBe(
      false,
    );
  });
  it("accepts GitHub's live bare workflow path when branch identity matches", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/12/runs")) {
        const response = await original(url, init);
        const data = (await response.json()) as {
          workflow_runs: Record<string, unknown>[];
        };
        return Response.json({
          workflow_runs: [
            { ...data.workflow_runs[0], path: ".github/workflows/maester.yml" },
          ],
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
  });
  it("rejects a run with a different workflow path or ref", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/12/runs")) {
        const response = await original(url, init);
        const data = (await response.json()) as {
          workflow_runs: Record<string, unknown>[];
        };
        return Response.json({
          workflow_runs: [
            {
              ...data.workflow_runs[0],
              path: ".github/workflows/other.yml@refs/heads/main",
            },
          ],
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
  });
  it("rejects a run whose path suffix names a different branch", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/12/runs")) {
        const response = await original(url, init);
        const data = (await response.json()) as {
          workflow_runs: Record<string, unknown>[];
        };
        return Response.json({
          workflow_runs: [
            {
              ...data.workflow_runs[0],
              path: ".github/workflows/maester.yml@refs/heads/other",
            },
          ],
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
  });
  it("records a malformed configured source while importing a later valid workflow", async () => {
    await client.execute("DELETE FROM github_sources");
    await client.execute(
      "INSERT INTO github_sources(repo_id,workflow_id,workflow_ref,workflow_path,artifact_name,enabled) VALUES (42,11,'refs/heads/main','bad-path','maester-atura-dashboard',1)",
    );
    await client.execute(
      "INSERT INTO github_sources(repo_id,workflow_id,workflow_ref,workflow_path,artifact_name,enabled) VALUES (42,12,'refs/heads/main','.github/workflows/maester.yml','maester-atura-dashboard',1)",
    );
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
  });
  it("records a malformed run while importing a later valid run", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/runs?")) {
        const response = await original(url, init);
        const payload = (await response.json()) as { workflow_runs: unknown[] };
        return Response.json({
          ...payload,
          workflow_runs: [{ status: "completed" }, ...payload.workflow_runs],
        });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
  });
  it("expires an unindexed R2 upload left by an uncertain D1 batch", async () => {
    const actual = db;
    db = {
      ...actual,
      batch: async () => {
        throw new Error("D1 batch interrupted");
      },
    } as unknown as D1Database;
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "Private import rejected",
    );
    expect(objects.size).toBe(1);
    db = actual;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(objects.size).toBe(3);
    await expireImports(db, bucket, new Date("2027-11-04T00:00:00Z"));
    expect(objects.size).toBe(0);
  });
  it("keeps R2 bytes when a committed D1 batch has a failed readback", async () => {
    const actual = db;
    db = {
      ...actual,
      prepare(sql: string) {
        const statement = actual.prepare(sql);
        if (!sql.includes("SELECT digest FROM artifact_index"))
          return statement;
        return {
          ...statement,
          bind(...args: unknown[]) {
            const bound = statement.bind(...args);
            return { ...bound, first: async () => null };
          },
        } as D1PreparedStatement;
      },
    } as D1Database;
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "Private import rejected",
    );
    const rows = (await client.execute("SELECT object_key FROM artifact_index"))
      .rows;
    expect(rows).toHaveLength(1);
    expect(objects.has(rows[0].object_key as string)).toBe(true);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "readback_unverified" }]);
  });
  it("restores a missing indexed R2 object from the verified same-run artifact", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const rows = (await client.execute("SELECT object_key FROM artifact_index"))
      .rows;
    const key = rows[0].object_key as string;
    objects.delete(key);
    await reconcile(db, bucket, settings, fetcher, now);
    expect(objects.has(key)).toBe(true);
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
  });
  it("clears an uncertain readback only after the indexed D1 and R2 digest verify", async () => {
    const actual = db;
    let once = true;
    db = {
      ...actual,
      prepare(sql: string) {
        const statement = actual.prepare(sql);
        if (!sql.includes("SELECT digest FROM artifact_index") || !once)
          return statement;
        once = false;
        return {
          ...statement,
          bind(...args: unknown[]) {
            const bound = statement.bind(...args);
            return { ...bound, first: async () => null };
          },
        } as D1PreparedStatement;
      },
    } as D1Database;
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "Private import rejected",
    );
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "readback_unverified" }]);
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
  });
  it("isolates R2 read failure and removes unindexed bytes before retry", async () => {
    const originalGet = bucket.get.bind(bucket);
    let broken = true;
    bucket.get = (async (key: string) => {
      if (broken) throw new Error("R2 response secret");
      return originalGet(key);
    }) as R2Bucket["get"];
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
    expect(objects.size).toBe(0);
    broken = false;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
  });
  it("does not hide a D1 failure as a per-run import event", async () => {
    const actual = db;
    db = {
      ...actual,
      prepare(sql: string) {
        if (
          sql.includes(
            "SELECT a.digest,a.object_key,s.retention_lock FROM artifact_index",
          )
        )
          throw new Error("D1 unavailable");
        return actual.prepare(sql);
      },
    } as D1Database;
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "D1 unavailable",
    );
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
  });
  it("retains a healthy imported projection after the GitHub projection artifact expires", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/runs/100/artifacts?per_page=100")) {
        return Response.json({ artifacts: [] });
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
    expect(
      (await client.execute("SELECT * FROM artifact_index")).rows,
    ).toHaveLength(1);
  });
  it("records missing projection as technical import state without importing legacy HTML", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) =>
      url.endsWith("/runs/100/artifacts?per_page=100")
        ? Response.json({
            artifacts: [
              {
                id: 901,
                name: "legacy-html-100",
                size_in_bytes: 100,
                expired: false,
              },
            ],
          })
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "projection_missing" }]);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
    expect(objects.size).toBe(0);
  });
  it("does not import an unpaired dashboard artifact", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) =>
      url.endsWith("/runs/100/artifacts?per_page=100")
        ? Response.json({
            artifacts: [
              {
                id: 900,
                name: "maester-atura-dashboard-100",
                size_in_bytes: 500,
                expired: false,
                workflow_run: { id: 100, head_repository_id: 42 },
              },
            ],
          })
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
  });
  it("does not import a rerun artifact whose attempt cannot be verified", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) =>
      url.includes("/workflows/12/runs")
        ? Response.json({
            workflow_runs: [
              {
                id: 100,
                run_attempt: 2,
                status: "completed",
                event: "push",
                head_branch: "main",
                head_repository: { id: 42 },
                head_sha: "a".repeat(40),
                created_at: "2026-11-02T00:00:00Z",
                conclusion: "failure",
                workflow_id: 12,
                path: ".github/workflows/maester.yml@refs/heads/main",
              },
            ],
          })
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "attempt_unverifiable" }]);
  });
  it("rejects fork/PR runs without an import", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows/12/runs"))
        return Response.json({
          workflow_runs: [
            {
              id: 100,
              run_attempt: 1,
              status: "completed",
              event: "pull_request",
              head_repository: { id: 99 },
              head_branch: "main",
            },
          ],
        });
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
  });
  it("fails closed on decompression bombs and leaves no index", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) =>
      url.endsWith("/artifacts/900/zip")
        ? new Response(
            new Uint8Array(
              zip({ ...doc, padding: "x".repeat(200_000) }),
            ).buffer,
          )
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
    expect(
      (await client.execute("SELECT * FROM artifact_index")).rows,
    ).toHaveLength(0);
  });
  it("rejects additional ZIP entries before writing any rows", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) =>
      url.endsWith("/artifacts/900/zip")
        ? new Response(
            new Uint8Array(
              zipSync({
                "dashboard-result-v1.json": strToU8(JSON.stringify(doc)),
                "legacy.html": strToU8("<script>bad()</script>"),
              }),
            ).buffer,
          )
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
    expect(
      (await client.execute("SELECT * FROM artifact_index")).rows,
    ).toHaveLength(0);
  });
  it("does not include malformed projection content in errors", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) =>
      url.endsWith("/artifacts/900/zip")
        ? new Response(
            new Uint8Array(
              zipSync({
                "dashboard-result-v1.json": strToU8('{"Bearer secret":'),
              }),
            ).buffer,
          )
        : original(url, init)) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect(
      (await client.execute("SELECT code FROM import_events")).rows,
    ).toEqual([{ code: "import_failed" }]);
  });
  it("follows only trusted signed archive redirects without forwarding the App token", async () => {
    const original = fetcher;
    fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/artifacts/900/zip"))
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://objects.githubusercontent.com/archive",
          },
        });
      if (url === "https://objects.githubusercontent.com/archive") {
        expect(init?.headers).toBeUndefined();
        return new Response(new Uint8Array(zip(doc)).buffer);
      }
      return original(url, init);
    }) as typeof fetch;
    await reconcile(db, bucket, settings, fetcher, now);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      1,
    );
  });
  it("deletes associated approved PDF bytes, versions and actor audit on retention", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const run = (await client.execute("SELECT id FROM scan_runs")).rows[0]
      .id as string;
    const pdfKey = `reports/${"d".repeat(64)}/${"e".repeat(64)}.pdf`;
    objects.set(pdfKey, new Uint8Array([37, 80, 68, 70]));
    await client.execute({
      sql: "INSERT INTO report_versions(tenant_id,run_id,digest,object_key,pdf_sha256,created_at,approved_at,approved_by) VALUES (?,?,?,?,?,?,?,?)",
      args: [
        "atura",
        run,
        "d".repeat(64),
        pdfKey,
        "e".repeat(64),
        now.toISOString(),
        now.toISOString(),
        "pilot",
      ],
    });
    await client.execute({
      sql: "INSERT INTO report_approval_events(id,tenant_id,run_id,digest,actor_id,actor_org_id,approved_at) VALUES (?,?,?,?,?,?,?)",
      args: [
        "event",
        "atura",
        run,
        "d".repeat(64),
        "pilot",
        "org",
        now.toISOString(),
      ],
    });
    await expireImports(db, bucket, new Date("2027-11-04T00:00:00Z"));
    expect(objects.has(pdfKey)).toBe(false);
    expect(
      (await client.execute("SELECT * FROM report_versions")).rows,
    ).toHaveLength(0);
    expect(
      (await client.execute("SELECT * FROM report_approval_events")).rows,
    ).toHaveLength(0);
    expect(
      (await client.execute("SELECT * FROM retention_events")).rows,
    ).toHaveLength(1);
  });
  it("never reimports an expired run even if GitHub still returns its artifact", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const future = new Date("2027-11-04T00:00:00Z");
    await expireImports(db, bucket, future);
    await reconcile(db, bucket, settings, fetcher, future);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
    expect(objects.size).toBe(0);
  });
  it("retries an interrupted R2 retention deletion without unlocking the run", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    const priorDelete = bucket.delete.bind(bucket);
    let first = true;
    bucket.delete = (async (key: string) => {
      if (first) {
        first = false;
        throw new Error("R2 unavailable");
      }
      return priorDelete(key);
    }) as R2Bucket["delete"];
    const future = new Date("2027-11-04T00:00:00Z");
    await expect(expireImports(db, bucket, future)).rejects.toThrow(
      "R2 unavailable",
    );
    const rows = (await client.execute("SELECT retention_lock FROM scan_runs"))
      .rows;
    expect(rows).toEqual([{ retention_lock: 1 }]);
    await expireImports(db, bucket, future);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
    expect(objects.size).toBe(0);
  });
  it("deletes expired R2 objects and rows with audit readback", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    await client.execute({
      sql: "INSERT INTO import_events(id,tenant_id,code,observed_at) VALUES (?,?,?,?)",
      args: ["old", "atura", "projection_missing", "2026-11-02T00:00:00Z"],
    });
    const future = new Date("2027-11-04T00:00:00Z");
    const priorDelete = bucket.delete.bind(bucket);
    bucket.delete = (async (key: string) => {
      const rows = await client.execute("SELECT retention_lock FROM scan_runs");
      if (rows.rows.length) expect(rows.rows[0].retention_lock).toBe(1);
      return priorDelete(key);
    }) as R2Bucket["delete"];
    await expireImports(db, bucket, future);
    expect((await client.execute("SELECT * FROM scan_runs")).rows).toHaveLength(
      0,
    );
    expect(
      (await client.execute("SELECT * FROM artifact_index")).rows,
    ).toHaveLength(0);
    expect(
      (await client.execute("SELECT * FROM retention_events")).rows,
    ).toHaveLength(1);
    expect(objects.size).toBe(0);
    expect(
      (await client.execute("SELECT * FROM import_events")).rows,
    ).toHaveLength(0);
  });
});
