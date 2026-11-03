import { importPKCS8, SignJWT } from "jose";
import { Unzip, UnzipInflate } from "fflate";

const API = "https://api.github.com";
const MAX_ZIP = 256 * 1024;
const MAX_JSON = 64 * 1024;
const MAX_API_JSON = 256 * 1024; // GitHub run metadata is far larger than the safe projection.
function fail(): never {
  throw new Error("Private import rejected");
}
class ImportFailure extends Error {
  constructor() {
    super("Private import rejected");
  }
}
// Only external data/IO errors are isolated; never suppress D1 failures.
async function external<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ImportFailure();
  }
}
function externalReject(): never {
  throw new ImportFailure();
}
async function event(db: D1Database, id: string, tenant: string, now: Date) {
  await db
    .prepare(
      "INSERT INTO import_events(id,tenant_id,code,observed_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,observed_at=excluded.observed_at WHERE tenant_id=excluded.tenant_id",
    )
    .bind(id, tenant, "import_failed", now.toISOString())
    .run();
}
async function resolved(db: D1Database, id: string, tenant: string) {
  await db
    .prepare("DELETE FROM import_events WHERE id=? AND tenant_id=?")
    .bind(id, tenant)
    .run();
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((k) => allowed.includes(k));
const tokenSafe = (v: unknown, max = 100): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  /^[a-zA-Z0-9_.-]+$/.test(v);
const int = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const iso = (v: unknown): v is string =>
  typeof v === "string" &&
  !Number.isNaN(Date.parse(v)) &&
  /^\d{4}-\d\d-\d\dT/.test(v);
function safeParse(data: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    return fail();
  }
}
const RESULTS = ["Passed", "Failed", "Skipped", "NotRun", "Error"];

type Export = {
  schema_version: 1;
  tenant_id: string;
  expected_test_ids: string[];
  scan_status: "completed" | "skipped" | "technical_error";
  error_count: 0;
  controls: {
    id: string;
    result: "Passed" | "Failed" | "Skipped" | "NotRun" | "Error";
  }[];
};
export function validateExport(value: unknown, tenant: string): Export {
  if (
    !record(value) ||
    !keys(value, [
      "schema_version",
      "tenant_id",
      "expected_test_ids",
      "scan_status",
      "error_count",
      "controls",
    ]) ||
    Object.keys(value).length !== 6 ||
    value.schema_version !== 1 ||
    value.tenant_id !== tenant ||
    !tokenSafe(tenant) ||
    value.error_count !== 0 ||
    !["completed", "skipped", "technical_error"].includes(
      value.scan_status as string,
    )
  )
    fail();
  if (
    !Array.isArray(value.expected_test_ids) ||
    !value.expected_test_ids.length ||
    value.expected_test_ids.length > 500 ||
    !value.expected_test_ids.every((v) => tokenSafe(v)) ||
    new Set(value.expected_test_ids).size !== value.expected_test_ids.length
  )
    fail();
  if (
    !Array.isArray(value.controls) ||
    value.controls.length > value.expected_test_ids.length
  )
    fail();
  const seen = new Set<string>();
  for (const c of value.controls) {
    if (
      !record(c) ||
      !keys(c, ["id", "result"]) ||
      Object.keys(c).length !== 2 ||
      !tokenSafe(c.id) ||
      !value.expected_test_ids.includes(c.id) ||
      seen.has(c.id) ||
      !RESULTS.includes(c.result as string)
    )
      fail();
    seen.add(c.id);
  }
  return value as Export;
}

async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length") ?? 0) > limit
  )
    fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return all;
}

export function extractProjection(zip: Uint8Array): Uint8Array {
  // Reject forged ZIP metadata, extra files and advertised bombs BEFORE inflate.
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (
    zip.length < 46 ||
    view.getUint32(zip.length - 22, true) !== 0x06054b50 ||
    view.getUint16(zip.length - 14, true) !== 1 ||
    view.getUint16(zip.length - 12, true) !== 1 ||
    view.getUint16(zip.length - 2, true) !== 0
  )
    fail();
  const centralSize = view.getUint32(zip.length - 10, true);
  const centralOffset = view.getUint32(zip.length - 6, true);
  if (
    centralOffset + centralSize !== zip.length - 22 ||
    centralSize < 46 ||
    view.getUint32(centralOffset, true) !== 0x02014b50
  )
    fail();
  const nameLen = view.getUint16(centralOffset + 28, true);
  const extraLen = view.getUint16(centralOffset + 30, true);
  const commentLen = view.getUint16(centralOffset + 32, true);
  const flags = view.getUint16(centralOffset + 8, true);
  if (
    centralSize !== 46 + nameLen + extraLen + commentLen ||
    (flags & ~8) !== 0 || // only the optional data-descriptor bit is accepted
    view.getUint32(centralOffset + 24, true) > MAX_JSON ||
    view.getUint32(centralOffset + 20, true) > MAX_ZIP ||
    new TextDecoder().decode(
      zip.subarray(centralOffset + 46, centralOffset + 46 + nameLen),
    ) !== "dashboard-result-v1.json"
  )
    fail();
  const local = view.getUint32(centralOffset + 42, true);
  if (local + 30 > centralOffset || view.getUint32(local, true) !== 0x04034b50)
    fail();
  const localNameLength = view.getUint16(local + 26, true);
  const dataStart =
    local + 30 + localNameLength + view.getUint16(local + 28, true);
  const compressedSize = view.getUint32(centralOffset + 20, true);
  const descriptorStart = dataStart + compressedSize;
  const descriptorLength = centralOffset - descriptorStart;
  if (
    view.getUint16(local + 6, true) !== flags ||
    view.getUint16(local + 8, true) !==
      view.getUint16(centralOffset + 10, true) ||
    localNameLength !== nameLen ||
    dataStart > centralOffset ||
    descriptorStart > centralOffset ||
    !zip
      .subarray(local + 30, local + 30 + nameLen)
      .every((byte, i) => byte === zip[centralOffset + 46 + i])
  )
    fail();
  const crc = view.getUint32(centralOffset + 16, true);
  const uncompressedSize = view.getUint32(centralOffset + 24, true);
  if (flags & 8) {
    if (
      (descriptorLength !== 12 && descriptorLength !== 16) ||
      view.getUint32(local + 14, true) !== 0 ||
      view.getUint32(local + 18, true) !== 0 ||
      view.getUint32(local + 22, true) !== 0
    )
      fail();
    const values = descriptorStart + (descriptorLength === 16 ? 4 : 0);
    if (
      (descriptorLength === 16 &&
        view.getUint32(descriptorStart, true) !== 0x08074b50) ||
      view.getUint32(values, true) !== crc ||
      view.getUint32(values + 4, true) !== compressedSize ||
      view.getUint32(values + 8, true) !== uncompressedSize
    )
      fail();
  } else if (
    descriptorLength !== 0 ||
    view.getUint32(local + 14, true) !== crc ||
    view.getUint32(local + 18, true) !== compressedSize ||
    view.getUint32(local + 22, true) !== uncompressedSize
  )
    fail();
  let output: Uint8Array | undefined;
  let count = 0;
  let error = false;
  const unzip = new Unzip((file) => {
    count++;
    if (count !== 1 || file.name !== "dashboard-result-v1.json") {
      error = true;
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, data, final) => {
      if (err) {
        error = true;
        return;
      }
      size += data.length;
      if (size > MAX_JSON) {
        error = true;
        return;
      }
      chunks.push(data);
      if (final) {
        output = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          output.set(chunk, offset);
          offset += chunk.length;
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(zip, true);
  if (error || count !== 1 || !output) fail();
  return output;
}

type Source = {
  tenant_id: string;
  repo_id: number;
  owner: string;
  repo: string;
  installation_id: number;
  workflow_id: number;
  workflow_ref: string;
  workflow_path: string;
  artifact_name: string;
};
type Settings = { GITHUB_APP_ID?: string; GITHUB_APP_PRIVATE_KEY?: string };
async function api(
  fetcher: typeof fetch,
  url: string,
  bearer: string,
  init: RequestInit = {},
) {
  const response = await fetcher(url, {
    ...init,
    redirect: "manual",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${bearer}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) fail();
  return response;
}
async function json(
  fetcher: typeof fetch,
  url: string,
  bearer: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const data = await bounded(
    await api(fetcher, url, bearer, init),
    MAX_API_JSON,
  );
  const result: unknown = safeParse(data);
  if (!record(result)) fail();
  return result;
}
async function installationToken(
  fetcher: typeof fetch,
  settings: Settings,
  source: Source,
): Promise<string> {
  if (
    !settings.GITHUB_APP_ID ||
    !/^\d+$/.test(settings.GITHUB_APP_ID) ||
    !settings.GITHUB_APP_PRIVATE_KEY
  )
    fail();
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(settings.GITHUB_APP_PRIVATE_KEY, "RS256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(settings.GITHUB_APP_ID)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 300)
    .sign(key);
  const response = await json(
    fetcher,
    `${API}/app/installations/${source.installation_id}/access_tokens`,
    jwt,
    {
      method: "POST",
      body: JSON.stringify({
        repository_ids: [source.repo_id],
        permissions: { actions: "read", metadata: "read" },
      }),
      headers: { "Content-Type": "application/json" },
    },
  );
  if (typeof response.token !== "string" || !response.token) fail();
  return response.token;
}
async function download(
  fetcher: typeof fetch,
  url: string,
  token: string,
): Promise<Uint8Array> {
  let response = await fetcher(url, {
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (response.status === 302) {
    const target = new URL(response.headers.get("location") ?? "");
    if (
      target.protocol !== "https:" ||
      !(
        target.hostname === "objects.githubusercontent.com" ||
        target.hostname.endsWith(".blob.core.windows.net")
      )
    )
      fail();
    response = await fetcher(target.href, { redirect: "error" }); // signed URL: never forward App token
  }
  return bounded(response, MAX_ZIP);
}
const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

export async function reconcile(
  db: D1Database,
  bucket: R2Bucket,
  settings: Settings,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT r.tenant_id,s.repo_id,r.owner,r.repo,r.installation_id,s.workflow_id,s.workflow_ref,s.workflow_path,s.artifact_name FROM github_sources s JOIN github_repositories r ON r.repo_id=s.repo_id WHERE s.enabled=1 LIMIT 20",
    )
    .all<Source>();
  for (const source of results) {
    if (
      !int(source.repo_id) ||
      !int(source.installation_id) ||
      !int(source.workflow_id) ||
      !tokenSafe(source.tenant_id) ||
      !tokenSafe(source.owner) ||
      !tokenSafe(source.repo) ||
      !tokenSafe(source.artifact_name) ||
      !/^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/.test(
        source.workflow_path,
      ) ||
      !/^refs\/heads\/[a-zA-Z0-9_.\/-]+$/.test(source.workflow_ref)
    )
      fail();
    const sourceEvent = `${source.repo_id}:${source.workflow_id}:source`;
    let token: string;
    try {
      token = await external(() =>
        installationToken(fetcher, settings, source),
      );
    } catch (error) {
      if (!(error instanceof ImportFailure)) throw error;
      await event(db, sourceEvent, source.tenant_id, now);
      continue;
    }
    const base = `${API}/repos/${source.owner}/${source.repo}`;
    let sourceFailed = false;
    for (let page = 1; page <= 10; page++) {
      let runs: Record<string, unknown> & { workflow_runs: unknown[] };
      try {
        const response = await external(() =>
          json(
            fetcher,
            `${base}/actions/workflows/${source.workflow_id}/runs?status=completed&per_page=10&page=${page}`,
            token,
          ),
        );
        if (
          !Array.isArray(response.workflow_runs) ||
          response.workflow_runs.length > 10
        )
          externalReject();
        runs = response as typeof runs;
      } catch (error) {
        if (!(error instanceof ImportFailure)) throw error;
        await event(db, sourceEvent, source.tenant_id, now);
        sourceFailed = true;
        break;
      }
      for (const run of runs.workflow_runs) {
        if (
          !record(run) ||
          !int(run.id) ||
          !int(run.run_attempt) ||
          run.run_attempt < 1
        )
          fail();
        if (
          run.status !== "completed" ||
          !["push", "workflow_dispatch", "schedule"].includes(
            run.event as string,
          ) ||
          !record(run.head_repository) ||
          run.head_repository.id !== source.repo_id ||
          run.workflow_id !== source.workflow_id ||
          ![
            source.workflow_path,
            `${source.workflow_path}@${source.workflow_ref}`,
            `${source.workflow_path}@${source.workflow_ref.slice(11)}`,
          ].includes(run.path as string) ||
          run.head_branch !== source.workflow_ref.slice(11) ||
          !/^[a-f0-9]{40}$/.test(run.head_sha as string) ||
          !iso(run.created_at) ||
          ![
            "success",
            "failure",
            "cancelled",
            "timed_out",
            "action_required",
            "neutral",
            "skipped",
          ].includes(run.conclusion as string)
        )
          continue;
        // GitHub's artifact listing does not attest the producing attempt.
        if (run.run_attempt !== 1) {
          await db
            .prepare(
              "INSERT OR IGNORE INTO import_events(id,tenant_id,code,observed_at) VALUES (?,?,?,?)",
            )
            .bind(
              `${source.repo_id}:${run.id}:${run.run_attempt}`,
              source.tenant_id,
              "attempt_unverifiable",
              now.toISOString(),
            )
            .run();
          continue;
        }
        const runEvent = `${source.repo_id}:${run.id}:${run.run_attempt}`;
        try {
          const artifacts = await external(() =>
            json(
              fetcher,
              `${base}/actions/runs/${run.id}/artifacts?per_page=100`,
              token,
            ),
          );
          if (
            !Array.isArray(artifacts.artifacts) ||
            artifacts.artifacts.length > 100
          )
            externalReject();
          const matches = artifacts.artifacts.filter(
            (a) =>
              record(a) &&
              a.name === `${source.artifact_name}-${run.id}` &&
              !a.expired,
          );
          if (matches.length > 1) externalReject();
          if (!matches.length) {
            await db
              .prepare(
                "INSERT OR IGNORE INTO import_events(id,tenant_id,code,observed_at) VALUES (?,?,?,?)",
              )
              .bind(
                `${source.repo_id}:${run.id}:${run.run_attempt}`,
                source.tenant_id,
                "projection_missing",
                now.toISOString(),
              )
              .run();
            continue;
          }
          const artifact = matches[0] as Record<string, unknown>;
          const legacyName = `${source.artifact_name.replace(/-dashboard$/, "")}-${run.id}`;
          const legacy = artifacts.artifacts.filter(
            (a) =>
              record(a) &&
              a.name === legacyName &&
              !a.expired &&
              record(a.workflow_run) &&
              a.workflow_run.id === run.id &&
              a.workflow_run.head_repository_id === source.repo_id,
          );
          if (legacy.length !== 1) externalReject();
          if (
            !int(artifact.id) ||
            !int(artifact.size_in_bytes) ||
            artifact.size_in_bytes > MAX_ZIP ||
            !record(artifact.workflow_run) ||
            artifact.workflow_run.id !== run.id ||
            artifact.workflow_run.head_repository_id !== source.repo_id
          )
            externalReject();
          const id = `${source.repo_id}:${run.id}:${run.run_attempt}:${artifact.id}`;
          const indexed = await db
            .prepare(
              "SELECT digest,object_key FROM artifact_index WHERE id=? AND tenant_id=?",
            )
            .bind(id, source.tenant_id)
            .first<{ digest: string; object_key: string }>();
          if (indexed) {
            const read = await external(() => bucket.get(indexed.object_key));
            if (
              !read ||
              (await external(async () =>
                digest(new Uint8Array(await read.arrayBuffer())),
              )) !== indexed.digest
            )
              externalReject();
            await resolved(db, `${id}:readback`, source.tenant_id);
            await resolved(db, runEvent, source.tenant_id);
            continue;
          }
          const bytes = await external(async () =>
            extractProjection(
              await download(
                fetcher,
                `${base}/actions/artifacts/${artifact.id}/zip`,
                token,
              ),
            ),
          );
          const projection = await external(async () =>
            validateExport(safeParse(bytes), source.tenant_id),
          );
          const hash = await digest(bytes);
          const objectKey = `${source.tenant_id}/${crypto.randomUUID()}`;
          try {
            await external(() => bucket.put(objectKey, bytes));
            const read = await external(() => bucket.get(objectKey));
            if (
              !read ||
              (await external(async () =>
                digest(new Uint8Array(await read.arrayBuffer())),
              )) !== hash
            )
              externalReject();
          } catch (error) {
            // No D1 batch has begun: a partial R2 write cannot be referenced.
            await external(() => bucket.delete(objectKey));
            throw error;
          }
          let batchStarted = false;
          try {
            const expires = new Date(run.created_at as string);
            expires.setUTCFullYear(expires.getUTCFullYear() + 1);
            const statements = [
              db
                .prepare(
                  "INSERT INTO scan_runs(id,tenant_id,suite,benchmark,schema_version,started_at,scan_status,workflow_conclusion,expected_test_ids) VALUES (?,?,?,?,?,?,?,?,?)",
                )
                .bind(
                  id,
                  source.tenant_id,
                  source.artifact_name === "maester-atura-dashboard"
                    ? "daily"
                    : "cis",
                  source.artifact_name,
                  1,
                  run.created_at,
                  projection.scan_status,
                  run.conclusion,
                  JSON.stringify(projection.expected_test_ids),
                ),
              ...projection.controls.map((c) =>
                db
                  .prepare(
                    "INSERT INTO control_results(run_id,tenant_id,test_id,title,result) VALUES (?,?,?,?,?)",
                  )
                  .bind(id, source.tenant_id, c.id, c.id, c.result),
              ),
              db
                .prepare(
                  "INSERT INTO artifact_index(id,tenant_id,run_id,object_key,digest,expires_at) VALUES (?,?,?,?,?,?)",
                )
                .bind(
                  id,
                  source.tenant_id,
                  id,
                  objectKey,
                  hash,
                  expires.toISOString(),
                ),
            ];
            batchStarted = true;
            await db.batch(statements);
            const row = await db
              .prepare(
                "SELECT digest FROM artifact_index WHERE id=? AND tenant_id=?",
              )
              .bind(id, source.tenant_id)
              .first<{ digest: string }>();
            if (row?.digest !== hash) fail();
            await resolved(db, `${id}:readback`, source.tenant_id);
            await resolved(db, runEvent, source.tenant_id);
          } catch {
            // A failed batch response/readback does not prove D1 rolled back.
            // Keep R2: a committed index must never reference a deleted object.
            if (!batchStarted) await bucket.delete(objectKey);
            else {
              try {
                await db
                  .prepare(
                    "INSERT OR IGNORE INTO import_events(id,tenant_id,code,observed_at) VALUES (?,?,?,?)",
                  )
                  .bind(
                    `${id}:readback`,
                    source.tenant_id,
                    "readback_unverified",
                    now.toISOString(),
                  )
                  .run();
              } catch {
                /* D1 may be unavailable; preserve R2 regardless. */
              }
            }
            fail();
          }
        } catch (error) {
          if (!(error instanceof ImportFailure)) throw error;
          await event(db, runEvent, source.tenant_id, now);
        }
      }
      if (runs.workflow_runs.length < 10) break;
    }
    if (!sourceFailed) await resolved(db, sourceEvent, source.tenant_id);
  }
}

export async function expireImports(
  db: D1Database,
  bucket: R2Bucket,
  now = new Date(),
): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT id,tenant_id,run_id,object_key FROM artifact_index WHERE expires_at<=? LIMIT 100",
    )
    .bind(now.toISOString())
    .all<{
      id: string;
      tenant_id: string;
      run_id: string;
      object_key: string;
    }>();
  for (const item of results) {
    // Block new PDF versions before enumerating R2 keys; creation's conditional
    // INSERT atomically checks this row so an interleaving cannot orphan a PDF.
    await db
      .prepare(
        "UPDATE scan_runs SET retention_lock=1 WHERE id=? AND tenant_id=?",
      )
      .bind(item.run_id, item.tenant_id)
      .run();
    const { results: reports } = await db
      .prepare(
        "SELECT object_key FROM report_versions WHERE run_id=? AND tenant_id=?",
      )
      .bind(item.run_id, item.tenant_id)
      .all<{ object_key: string }>();
    for (const report of reports) {
      if (
        !/^reports\/[a-f0-9]{64}\/[a-f0-9]{64}(?:-[a-f0-9-]{36})?\.pdf$/.test(
          report.object_key,
        )
      )
        fail();
      await bucket.delete(report.object_key);
      if (await bucket.get(report.object_key)) fail();
    }
    await bucket.delete(item.object_key);
    if (await bucket.get(item.object_key)) fail();
    await db.batch([
      db
        .prepare(
          "DELETE FROM report_approval_events WHERE run_id=? AND tenant_id=?",
        )
        .bind(item.run_id, item.tenant_id),
      db
        .prepare("DELETE FROM report_versions WHERE run_id=? AND tenant_id=?")
        .bind(item.run_id, item.tenant_id),
      db
        .prepare("DELETE FROM control_results WHERE run_id=? AND tenant_id=?")
        .bind(item.run_id, item.tenant_id),
      db
        .prepare("DELETE FROM artifact_index WHERE id=? AND tenant_id=?")
        .bind(item.id, item.tenant_id),
      db
        .prepare("DELETE FROM scan_runs WHERE id=? AND tenant_id=?")
        .bind(item.run_id, item.tenant_id),
      db
        .prepare(
          "INSERT OR IGNORE INTO retention_events(id,tenant_id,deleted_at) VALUES (?,?,?)",
        )
        .bind(item.id, item.tenant_id, now.toISOString()),
    ]);
    if (
      await db
        .prepare("SELECT id FROM artifact_index WHERE id=?")
        .bind(item.id)
        .first()
    )
      fail();
  }
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  await db
    .prepare("DELETE FROM import_events WHERE observed_at<=?")
    .bind(cutoff.toISOString())
    .run();
}
