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

function extractNamedFile(
  zip: Uint8Array,
  filename: string,
  maxOutput: number,
): Uint8Array {
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
    view.getUint32(centralOffset + 24, true) > maxOutput ||
    view.getUint32(centralOffset + 20, true) > MAX_ZIP ||
    new TextDecoder().decode(
      zip.subarray(centralOffset + 46, centralOffset + 46 + nameLen),
    ) !== filename
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
    if (count !== 1 || file.name !== filename) {
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
      if (size > maxOutput) {
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
export function extractProjection(zip: Uint8Array): Uint8Array {
  return extractNamedFile(zip, "dashboard-result-v1.json", MAX_JSON);
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

// Exact counterpart of scripts/export_controlled_original.py at scanner commit 49b24fc.
// Do not substitute workflow metadata or source titles into this document.
const CONTROLLED_WORKFLOWS: Record<string, [string, string]> = {
  "maester-atura-dashboard": ["maester.yml", "Maester daily"],
  "maester-atura-cis-graph-dashboard": ["cis-assessment.yml", "CIS M365 Graph"],
  "maester-atura-cis-exo-dashboard": [
    "cis-exo-assessment.yml",
    "CIS M365 Graph + EXO",
  ],
  "maester-atura-cis-teams-dashboard": [
    "cis-teams-assessment.yml",
    "CIS M365 Graph + EXO + Teams",
  ],
};
const CONTROLLED_CSS =
  "body{font:16px system-ui,sans-serif;color:#17233b;background:#f5f7fa;margin:0;padding:2rem}main{max-width:60rem;margin:auto;background:white;padding:2rem;border-top:6px solid #156f86}h1{color:#125469}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #d5dfe5;padding:.65rem}small{color:#48566b}";
function canonicalControlled(
  projection: Export,
  source: Source,
  runId: number,
  attempt: number,
): Uint8Array {
  const workflow = CONTROLLED_WORKFLOWS[source.artifact_name];
  if (
    !workflow ||
    source.workflow_path !== `.github/workflows/${workflow[0]}` ||
    !/^[1-9][0-9]{0,19}$/.test(String(runId)) ||
    !/^[1-9][0-9]{0,19}$/.test(String(attempt)) ||
    projection.scan_status !== "completed" ||
    projection.controls.length !== projection.expected_test_ids.length ||
    projection.controls.some((c, i) => c.id !== projection.expected_test_ids[i])
  )
    fail();
  const rows = projection.controls
    .map((c) => `<tr><td>${c.id}</td><td>${c.result}</td></tr>`)
    .join("");
  return new TextEncoder().encode(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Atura controlled assessment derivative</title><style>' +
      CONTROLLED_CSS +
      "</style></head><body><main><h1>Atura | Assessment</h1>" +
      "<p>Controlled derivative (controlled-original-v1); not the original Maester HTML report. Evidence, errors and free-text titles are intentionally omitted.</p>" +
      `<p>Suite: ${workflow[1]} | Run ${runId} | Attempt ${attempt}</p>` +
      "<h2>Control outcomes</h2><table><thead><tr><th>Control ID</th><th>Result</th></tr></thead><tbody>" +
      rows +
      "</tbody></table><p><small>Atura Security | Statuses are recorded without supporting evidence.</small></p></main></body></html>",
  );
}

async function importControlled(
  db: D1Database,
  bucket: R2Bucket,
  fetcher: typeof fetch,
  base: string,
  token: string,
  source: Source,
  run: Record<string, unknown>,
  artifacts: unknown[],
  runId: string,
  expires: string,
  now: Date,
) {
  const statusId = `${runId}:controlled`;
  try {
    const sourceName = source.artifact_name.replace(/-dashboard$/, "");
    const matches = artifacts.filter(
      (a) =>
        record(a) &&
        a.name ===
          `${sourceName}-controlled-original-v1-${run.id}-${run.run_attempt}` &&
        a.expired === false,
    );
    const indexed = await db
      .prepare(
        "SELECT c.artifact_id,c.object_key,c.digest,c.size,s.retention_lock FROM controlled_original_index c JOIN scan_runs s ON s.id=c.run_id AND s.tenant_id=c.tenant_id WHERE c.run_id=? AND c.tenant_id=?",
      )
      .bind(runId, source.tenant_id)
      .first<{
        artifact_id: number;
        object_key: string;
        digest: string;
        size: number;
        retention_lock: number;
      }>();
    if (indexed?.retention_lock) return;
    if (!matches.length) {
      if (indexed) {
        const existing = await external(() => bucket.get(indexed.object_key));
        if (existing) {
          const bytes = new Uint8Array(
            await external(() => existing.arrayBuffer()),
          );
          if (
            bytes.length === indexed.size &&
            (await digest(bytes)) === indexed.digest
          ) {
            await resolved(db, statusId, source.tenant_id);
            return;
          }
        }
      }
      await db
        .prepare(
          "INSERT INTO import_events(id,tenant_id,code,observed_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,observed_at=excluded.observed_at WHERE tenant_id=excluded.tenant_id",
        )
        .bind(
          statusId,
          source.tenant_id,
          "controlled_missing",
          now.toISOString(),
        )
        .run();
      return;
    }
    if (matches.length !== 1) externalReject();
    const artifact = matches[0] as Record<string, unknown>;
    if (
      !int(artifact.id) ||
      !int(artifact.size_in_bytes) ||
      artifact.size_in_bytes > MAX_ZIP ||
      !record(artifact.workflow_run) ||
      artifact.workflow_run.id !== run.id ||
      artifact.workflow_run.head_repository_id !== source.repo_id
    )
      externalReject();
    if (indexed && indexed.artifact_id !== artifact.id) externalReject();
    const projectionIndex = await db
      .prepare(
        "SELECT a.object_key,a.digest,s.retention_lock FROM artifact_index a JOIN scan_runs s ON s.id=a.run_id AND s.tenant_id=a.tenant_id WHERE a.id=? AND a.tenant_id=?",
      )
      .bind(runId, source.tenant_id)
      .first<{ object_key: string; digest: string; retention_lock: number }>();
    if (!projectionIndex || projectionIndex.retention_lock) return;
    const projectionBody = await external(() =>
      bucket.get(projectionIndex.object_key),
    );
    if (!projectionBody) externalReject();
    const projectionBytes = await external(
      async () => new Uint8Array(await projectionBody.arrayBuffer()),
    );
    if ((await digest(projectionBytes)) !== projectionIndex.digest)
      externalReject();
    const projection = await external(async () =>
      validateExport(safeParse(projectionBytes), source.tenant_id),
    );
    const canonical = await external(async () =>
      canonicalControlled(
        projection,
        source,
        run.id as number,
        run.run_attempt as number,
      ),
    );
    if (canonical.length > MAX_JSON) externalReject();
    const canonicalHash = await digest(canonical);
    if (
      indexed &&
      (indexed.digest !== canonicalHash || indexed.size !== canonical.length)
    )
      externalReject();
    if (indexed) {
      const existing = await external(() => bucket.get(indexed.object_key));
      if (
        existing &&
        (await digest(
          new Uint8Array(await external(() => existing.arrayBuffer())),
        )) === canonicalHash
      ) {
        await resolved(db, statusId, source.tenant_id);
        return;
      }
    }
    const bytes = await external(async () =>
      extractNamedFile(
        await download(
          fetcher,
          `${base}/actions/artifacts/${artifact.id}/zip`,
          token,
        ),
        "controlled-original-v1.html",
        MAX_JSON,
      ),
    );
    if (
      bytes.length !== canonical.length ||
      bytes.some((b, i) => b !== canonical[i])
    )
      externalReject();
    const objectKey =
      indexed?.object_key ?? `${source.tenant_id}/${crypto.randomUUID()}`;
    if (!indexed) {
      const ledger = await db
        .prepare(
          "INSERT INTO pending_r2_objects(object_key,tenant_id,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM scan_runs WHERE id=? AND tenant_id=? AND retention_lock=0 AND started_at<?)",
        )
        .bind(
          objectKey,
          source.tenant_id,
          expires,
          runId,
          source.tenant_id,
          now.toISOString(),
        )
        .run();
      if (!ledger.success) fail();
      const pending = await db
        .prepare(
          "SELECT object_key FROM pending_r2_objects WHERE object_key=? AND tenant_id=?",
        )
        .bind(objectKey, source.tenant_id)
        .first();
      if (!pending) return;
    }
    if (indexed) {
      // Retention may lock and remove the old index while the archive is downloaded.
      // The post-write check below closes the remaining put/delete race.
      const active = await db
        .prepare(
          "SELECT 1 FROM controlled_original_index c JOIN scan_runs s ON s.id=c.run_id AND s.tenant_id=c.tenant_id JOIN pending_r2_objects p ON p.object_key=c.object_key AND p.tenant_id=c.tenant_id WHERE c.run_id=? AND c.tenant_id=? AND c.object_key=? AND s.retention_lock=0 AND s.started_at<?",
        )
        .bind(runId, source.tenant_id, objectKey, now.toISOString())
        .first();
      if (!active) return;
    }
    try {
      await external(() => bucket.put(objectKey, bytes));
      const read = await external(() => bucket.get(objectKey));
      if (
        !read ||
        (await digest(
          new Uint8Array(await external(() => read.arrayBuffer())),
        )) !== canonicalHash
      )
        externalReject();
    } catch (error) {
      // An indexed key may be shared by a concurrent repair. Deleting it on
      // our own failure could erase that repair's verified bytes. Retention
      // still owns its pending ledger; only an expired/unindexed key is ours
      // to delete here.
      if (indexed) {
        const active = await db
          .prepare(
            "SELECT 1 FROM controlled_original_index c JOIN scan_runs s ON s.id=c.run_id AND s.tenant_id=c.tenant_id JOIN pending_r2_objects p ON p.object_key=c.object_key AND p.tenant_id=c.tenant_id WHERE c.run_id=? AND c.tenant_id=? AND c.object_key=? AND s.retention_lock=0 AND s.started_at<?",
          )
          .bind(runId, source.tenant_id, objectKey, now.toISOString())
          .first();
        if (!active) await external(() => bucket.delete(objectKey));
      } else {
        await external(() => bucket.delete(objectKey));
      }
      throw error;
    }
    if (indexed) {
      // If expiry removed the index while R2 was writing, the old key is no
      // longer tracked; discard these bytes instead of resurrecting an orphan.
      const active = await db
        .prepare(
          "SELECT 1 FROM controlled_original_index c JOIN scan_runs s ON s.id=c.run_id AND s.tenant_id=c.tenant_id JOIN pending_r2_objects p ON p.object_key=c.object_key AND p.tenant_id=c.tenant_id WHERE c.run_id=? AND c.tenant_id=? AND c.object_key=? AND s.retention_lock=0 AND s.started_at<?",
        )
        .bind(runId, source.tenant_id, objectKey, now.toISOString())
        .first();
      if (!active) {
        await external(() => bucket.delete(objectKey));
        return;
      }
    }
    if (!indexed) {
      const pending = await db
        .prepare(
          "SELECT object_key FROM pending_r2_objects WHERE object_key=? AND tenant_id=?",
        )
        .bind(objectKey, source.tenant_id)
        .first();
      const active = await db
        .prepare(
          "SELECT id FROM scan_runs WHERE id=? AND tenant_id=? AND retention_lock=0",
        )
        .bind(runId, source.tenant_id)
        .first();
      if (!pending || !active) {
        await external(() => bucket.delete(objectKey));
        return;
      }
      // Conditional insertion shares the same D1 serialization boundary as expiry's run lock.
      // Pending ledger remains until the retention sweep even on an uncertain response.
      await db
        .prepare(
          "INSERT INTO controlled_original_index(run_id,tenant_id,artifact_id,object_key,digest,size,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM scan_runs WHERE id=? AND tenant_id=? AND retention_lock=0) AND EXISTS (SELECT 1 FROM pending_r2_objects WHERE object_key=? AND tenant_id=?)",
        )
        .bind(
          runId,
          source.tenant_id,
          artifact.id,
          objectKey,
          canonicalHash,
          bytes.length,
          expires,
          runId,
          source.tenant_id,
          objectKey,
          source.tenant_id,
        )
        .run();
    }
    const verified = await db
      .prepare(
        "SELECT artifact_id,object_key,digest,size FROM controlled_original_index WHERE run_id=? AND tenant_id=?",
      )
      .bind(runId, source.tenant_id)
      .first<{
        artifact_id: number;
        object_key: string;
        digest: string;
        size: number;
      }>();
    if (
      !verified ||
      verified.artifact_id !== artifact.id ||
      verified.object_key !== objectKey ||
      verified.digest !== canonicalHash ||
      verified.size !== bytes.length
    )
      fail();
    await resolved(db, statusId, source.tenant_id);
  } catch (error) {
    if (!(error instanceof ImportFailure)) throw error;
    await event(db, statusId, source.tenant_id, now);
  }
}

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
      !int(source.workflow_id) ||
      !tokenSafe(source.tenant_id)
    )
      fail(); // without a trusted tenant/source identity, no scoped event is possible
    const sourceEvent = `${source.repo_id}:${source.workflow_id}:source`;
    if (
      !int(source.installation_id) ||
      !tokenSafe(source.owner) ||
      !tokenSafe(source.repo) ||
      !tokenSafe(source.artifact_name) ||
      !/^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/.test(
        source.workflow_path,
      ) ||
      !/^refs\/heads\/[a-zA-Z0-9_.\/-]+$/.test(source.workflow_ref)
    ) {
      await event(db, sourceEvent, source.tenant_id, now);
      continue;
    }
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
        ) {
          await event(db, sourceEvent, source.tenant_id, now);
          sourceFailed = true;
          continue;
        }
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
        // Retention is measured from the source scan, not from import time.
        // GitHub must not be able to resurrect a run after local expiry.
        const runExpires = new Date(run.created_at as string);
        runExpires.setUTCFullYear(runExpires.getUTCFullYear() + 1);
        if (runExpires <= now) continue;
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
            // GitHub expires artifacts before our D1/R2 retention window. An
            // intact imported projection remains valid without its source ZIP.
            const { results: existing } = await db
              .prepare(
                "SELECT a.id,a.object_key,a.digest,s.retention_lock FROM artifact_index a JOIN scan_runs s ON s.id=a.run_id AND s.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.id GLOB ? LIMIT 2",
              )
              .bind(source.tenant_id, `${runEvent}:*`)
              .all<{
                id: string;
                object_key: string;
                digest: string;
                retention_lock: number;
              }>();
            if (existing.length > 1) fail();
            if (existing[0]?.retention_lock) continue;
            if (existing.length === 1) {
              const saved = await external(() =>
                bucket.get(existing[0].object_key),
              );
              if (
                saved &&
                (await digest(
                  new Uint8Array(await external(() => saved.arrayBuffer())),
                )) === existing[0].digest
              ) {
                await resolved(db, runEvent, source.tenant_id);
                await resolved(
                  db,
                  `${existing[0].id}:readback`,
                  source.tenant_id,
                );
                await importControlled(
                  db,
                  bucket,
                  fetcher,
                  base,
                  token,
                  source,
                  run,
                  artifacts.artifacts,
                  existing[0].id,
                  runExpires.toISOString(),
                  now,
                );
                continue;
              }
            }
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
              "SELECT a.digest,a.object_key,s.retention_lock FROM artifact_index a JOIN scan_runs s ON s.id=a.run_id AND s.tenant_id=a.tenant_id WHERE a.id=? AND a.tenant_id=?",
            )
            .bind(id, source.tenant_id)
            .first<{
              digest: string;
              object_key: string;
              retention_lock: number;
            }>();
          if (indexed) {
            if (indexed.retention_lock) continue;
            const read = await external(() => bucket.get(indexed.object_key));
            if (
              !read ||
              (await external(async () =>
                digest(new Uint8Array(await read.arrayBuffer())),
              )) !== indexed.digest
            ) {
              // Repair only from the same provenance-bound, still-available
              // artifact and only if the normalized projection digest agrees.
              const recovered = await external(async () =>
                extractProjection(
                  await download(
                    fetcher,
                    `${base}/actions/artifacts/${artifact.id}/zip`,
                    token,
                  ),
                ),
              );
              await external(async () =>
                validateExport(safeParse(recovered), source.tenant_id),
              );
              if ((await digest(recovered)) !== indexed.digest)
                externalReject();
              await external(() => bucket.put(indexed.object_key, recovered));
              const verified = await external(() =>
                bucket.get(indexed.object_key),
              );
              if (
                !verified ||
                (await external(async () =>
                  digest(new Uint8Array(await verified.arrayBuffer())),
                )) !== indexed.digest
              )
                externalReject();
              // If expiry won the race after our first lookup, do not leave
              // a repaired object behind once its D1 index is gone/locked.
              const current = await db
                .prepare(
                  "SELECT s.retention_lock FROM artifact_index a JOIN scan_runs s ON s.id=a.run_id WHERE a.id=? AND a.tenant_id=?",
                )
                .bind(id, source.tenant_id)
                .first<{ retention_lock: number }>();
              if (!current || current.retention_lock) {
                await external(() => bucket.delete(indexed.object_key));
                continue;
              }
            }
            await resolved(db, `${id}:readback`, source.tenant_id);
            await resolved(db, runEvent, source.tenant_id);
            await importControlled(
              db,
              bucket,
              fetcher,
              base,
              token,
              source,
              run,
              artifacts.artifacts,
              id,
              runExpires.toISOString(),
              now,
            );
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
          // Persist the retention index before any R2 write. Even an uncertain
          // D1 batch cannot strand bytes outside the one-year cleanup path.
          const expires = new Date(run.created_at as string);
          expires.setUTCFullYear(expires.getUTCFullYear() + 1);
          await db
            .prepare(
              "INSERT INTO pending_r2_objects(object_key,tenant_id,expires_at) VALUES (?,?,?)",
            )
            .bind(objectKey, source.tenant_id, expires.toISOString())
            .run();
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
          await importControlled(
            db,
            bucket,
            fetcher,
            base,
            token,
            source,
            run,
            artifacts.artifacts,
            id,
            expires.toISOString(),
            now,
          );
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
    const controlled = await db
      .prepare(
        "SELECT object_key FROM controlled_original_index WHERE run_id=? AND tenant_id=?",
      )
      .bind(item.run_id, item.tenant_id)
      .first<{ object_key: string }>();
    if (controlled) {
      if (!controlled.object_key.startsWith(`${item.tenant_id}/`)) fail();
      await bucket.delete(controlled.object_key);
      if (await bucket.get(controlled.object_key)) fail();
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
        .prepare(
          "DELETE FROM controlled_original_index WHERE run_id=? AND tenant_id=?",
        )
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
  // Independently sweep pre-indexed uploads. This ledger survives a failed or
  // uncertain scan-run batch, including cases with no artifact_index row.
  let pendingCursor = "";
  for (let page = 0; page < 100; page++) {
    const { results: pending } = await db
      .prepare(
        "SELECT object_key,tenant_id,expires_at FROM pending_r2_objects WHERE expires_at<=? AND object_key>? ORDER BY object_key LIMIT 100",
      )
      .bind(now.toISOString(), pendingCursor)
      .all<{ object_key: string; tenant_id: string; expires_at: string }>();
    for (const item of pending) {
      const projectionKey =
        /^[-a-zA-Z0-9_]+\/[a-f0-9-]{36}$/.test(item.object_key) &&
        item.object_key.startsWith(`${item.tenant_id}/`);
      const pdfKey =
        /^reports\/[a-f0-9]{64}\/[a-f0-9]{64}-[a-f0-9-]{36}\.pdf$/.test(
          item.object_key,
        );
      if (!tokenSafe(item.tenant_id) || (!projectionKey && !pdfKey)) fail();
      await bucket.delete(item.object_key);
      if (await bucket.get(item.object_key)) fail();
      // Re-sweep during a one-day grace period: an in-flight put can finish
      // after the first delete, but must remain findable on the next pass.
      const ledgerEnd = new Date(item.expires_at);
      if (!Number.isFinite(ledgerEnd.getTime())) fail();
      ledgerEnd.setUTCDate(ledgerEnd.getUTCDate() + 1);
      if (now < ledgerEnd) continue;
      await db
        .prepare(
          "DELETE FROM pending_r2_objects WHERE object_key=? AND tenant_id=?",
        )
        .bind(item.object_key, item.tenant_id)
        .run();
    }
    if (pending.length < 100) break;
    if (page === 99) fail();
    pendingCursor = pending[pending.length - 1].object_key;
  }
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  await db
    .prepare("DELETE FROM import_events WHERE observed_at<=?")
    .bind(cutoff.toISOString())
    .run();
}
