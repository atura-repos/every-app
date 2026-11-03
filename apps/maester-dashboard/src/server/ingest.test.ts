import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
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
    "INSERT INTO github_sources(tenant_id,repo_id,owner,repo,installation_id,workflow_id,workflow_ref,artifact_name,enabled) VALUES ('atura',42,'atura','scanner',7,12,'refs/heads/main','maester-atura-dashboard',1)",
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
            path: ".github/workflows/maester.yml",
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
        ],
      });
    if (url.endsWith("/artifacts/900/zip"))
      return new Response(new Uint8Array(zip(doc)).buffer);
    throw Error("Unexpected fetch");
  }) as typeof fetch;
});

describe("validated private reconciliation", () => {
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
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "Private import rejected",
    );
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
    await expect(
      reconcile(db, bucket, settings, fetcher, now),
    ).rejects.toThrow();
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
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "Private import rejected",
    );
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
    await expect(reconcile(db, bucket, settings, fetcher, now)).rejects.toThrow(
      "Private import rejected",
    );
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
  it("deletes expired R2 objects and rows with audit readback", async () => {
    await reconcile(db, bucket, settings, fetcher, now);
    await client.execute({
      sql: "INSERT INTO import_events(id,tenant_id,code,observed_at) VALUES (?,?,?,?)",
      args: ["old", "atura", "projection_missing", "2026-11-02T00:00:00Z"],
    });
    const future = new Date("2027-11-04T00:00:00Z");
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
