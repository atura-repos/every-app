#!/usr/bin/env node
/** Hermetic HTTP check of the *built* Gateway Worker and generated TanStack RPCs.
 * Run after `pnpm -C apps/every-app-gateway build`. Never uses a real account.
 * Wrangler is fetched with pnpm dlx; state and generated credentials are deleted.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(app, ".cloudflare/output/v0/workers/default");
const bundle = join(output, "bundle");
const manifest = JSON.parse(
  readFileSync(join(bundle, ".vite/manifest.json"), "utf8"),
);
const generated = (source, name) => {
  const entry = Object.entries(manifest).find(
    ([key]) =>
      key.includes(`/serverFunctions/${source}.ts`) &&
      key.includes("tss-serverfn-split"),
  );
  assert.ok(entry, `built server function module missing: ${source}`);
  const text = readFileSync(join(bundle, entry[1].file), "utf8");
  const match = text.match(new RegExp(`id:"([a-f0-9]{64})",name:"${name}"`));
  assert.ok(match, `generated server function missing: ${name}`);
  return match[1];
};
const personal = generated("personalPortal", "createPersonalLink");
const external = generated("externalLinks", "createExternalLink");
const startPackage = realpathSync(
  join(app, "node_modules/@tanstack/react-start/package.json"),
);
const { toJSON } = createRequire(startPackage)("seroval");
const work = mkdtempSync(join(app, ".generated-serverfn-test-"));
const state = join(work, "state");
const config = join(work, "wrangler.jsonc");
const secret = randomBytes(40).toString("hex");
const tokens = {
  member: randomBytes(24).toString("hex"),
  admin: randomBytes(24).toString("hex"),
};
const origin = "http://127.0.0.1:18788";
const marker = "synthetic-canary-42";
let server;
let serverLog = "";
function run(args) {
  return new Promise((done, fail) => {
    const child = spawn("pnpm", ["dlx", "wrangler@4.157.0", ...args], {
      cwd: app,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? done(output)
        : fail(
            new Error(
              `local Wrangler command failed (${code}): ${output.slice(-1200)}`,
            ),
          ),
    );
  });
}
function sql(command) {
  return run([
    "d1",
    "execute",
    "fixture",
    "--local",
    "--config",
    config,
    "--persist-to",
    state,
    "--json",
    "--command",
    command,
  ]).then((text) => JSON.parse(text)[0].results);
}
function cookie(role) {
  const token = tokens[role];
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}
async function call(
  role,
  id,
  data,
  metadata = { origin, "sec-fetch-site": "same-origin" },
) {
  const response = await fetch(`${origin}/_serverFn/${id}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tsr-serverfn": "true",
      cookie: cookie(role),
      ...metadata,
    },
    body: JSON.stringify(toJSON({ data })),
  });
  return {
    status: response.status,
    serialized: response.headers.get("x-tss-serialized"),
    body: await response.text(),
  };
}
const count = async (table) =>
  Number((await sql(`SELECT count(*) AS n FROM ${table}`))[0].n);
try {
  writeFileSync(
    config,
    JSON.stringify({
      name: "generated-serverfn-fixture",
      main: relative(work, join(bundle, "index.js")),
      compatibility_date: "2025-09-02",
      compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
      rules: [{ type: "ESModule", globs: ["**/*.js"], fallthrough: true }],
      assets: {
        directory: relative(work, join(output, "assets")),
        binding: "ASSETS",
        run_worker_first: true,
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "fixture",
          database_id: "00000000-0000-0000-0000-000000000001",
          migrations_dir: relative(work, join(app, "drizzle")),
        },
      ],
      vars: { GATEWAY_URL: origin },
    }),
  );
  writeFileSync(join(work, ".dev.vars"), `BETTER_AUTH_SECRET=${secret}\n`);
  await run([
    "d1",
    "migrations",
    "apply",
    "fixture",
    "--local",
    "--config",
    config,
    "--persist-to",
    state,
  ]);
  const seed = `INSERT INTO organizations (id,name,slug,created_at,status) VALUES ('fixture-org','Fixture','fixture',strftime('%s','now')*1000,'active');
INSERT INTO users (id,name,email,email_verified) VALUES ('fixture-member','Member','member@fixture.invalid',1),('fixture-admin','Admin','admin@fixture.invalid',1);
INSERT INTO members (id,organization_id,user_id,role,created_at) VALUES ('membership-member','fixture-org','fixture-member','member',strftime('%s','now')*1000),('membership-admin','fixture-org','fixture-admin','admin',strftime('%s','now')*1000);
INSERT INTO sessions (id,expires_at,token,user_id,active_organization_id,updated_at) VALUES ('session-member',(strftime('%s','now')+3600)*1000,'${tokens.member}','fixture-member','fixture-org',strftime('%s','now')*1000),('session-admin',(strftime('%s','now')+3600)*1000,'${tokens.admin}','fixture-admin','fixture-org',strftime('%s','now')*1000);`;
  writeFileSync(join(work, "seed.sql"), seed);
  await run([
    "d1",
    "execute",
    "fixture",
    "--local",
    "--config",
    config,
    "--persist-to",
    state,
    "--file",
    join(work, "seed.sql"),
    "--json",
  ]);
  assert.equal(await count("sessions"), 2);
  server = spawn(
    "pnpm",
    [
      "dlx",
      "wrangler@4.157.0",
      "dev",
      "--config",
      config,
      "--no-bundle",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "18788",
      "--persist-to",
      state,
      "--show-interactive-dev-session=false",
      "--log-level",
      "error",
    ],
    { cwd: app, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const channel of [server.stdout, server.stderr])
    channel.on("data", (b) => (serverLog += b));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw Error(`Worker failed to start: ${serverLog.slice(-1200)}`);
    try {
      const health = await fetch(`${origin}/health`);
      if (health.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, `Worker did not become healthy: ${serverLog.slice(-1200)}`);
  const personalData = {
    name: "Own fixture link",
    url: `https://example.invalid/private?marker=${marker}`,
  };
  const externalData = {
    name: "Shared fixture link",
    url: `https://www.cloudflare.com/fixture?marker=${marker}`,
    access: { everyone: true, userIds: [], groupIds: [] },
  };
  const own = await call("member", personal, personalData);
  assert.equal(own.status, 200);
  assert.equal(own.serialized, "true");
  assert.match(own.body, /fixture-member/);
  assert.match(own.body, /fixture-org/);
  assert.equal(JSON.parse(own.body).p.v[1].t, 2);
  assert.equal(await count("personal_links"), 1);
  console.log(
    "member own POST: 200, generated result bound to fixture-member/fixture-org",
  );
  const blocked = await call("member", external, externalData);
  assert.equal(blocked.status, 200);
  assert.match(
    blocked.body,
    /Unauthorized: Organization admin access required/,
  );
  assert.doesNotMatch(blocked.body, new RegExp(marker));
  assert.equal(await count("external_links"), 0);
  console.log(
    "member organization publication POST: 200 serialized authorization error, 0 shared rows",
  );
  const granted = await call("admin", external, externalData);
  assert.equal(granted.status, 200);
  assert.match(granted.body, /fixture-org/);
  assert.equal(JSON.parse(granted.body).p.v[1].t, 2);
  assert.equal(await count("external_links"), 1);
  console.log("admin organization publication POST: 200, 1 shared row");
  for (const [label, headers, expectedError] of [
    [
      "sibling origin",
      {
        origin: "http://sibling.localhost:18788",
        "sec-fetch-site": "same-site",
      },
      "server_fn_denied",
    ],
    ["missing Origin and Fetch Metadata", {}, "csrf_denied"],
  ]) {
    const denied = await call("member", personal, personalData, headers);
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(denied.body).error, expectedError);
    assert.doesNotMatch(denied.body, new RegExp(marker));
    assert.equal(await count("personal_links"), 1);
    console.log(`${label} POST: 403 ${expectedError}, no additional own row`);
  }
  const malformed = await call("admin", external, {
    ...externalData,
    url: `https://www.cloudflare.com/fixture?token=${marker}`,
  });
  assert.equal(malformed.status, 200);
  assert.match(malformed.body, /Invalid request input/);
  assert.doesNotMatch(malformed.body, new RegExp(marker));
  assert.equal(await count("external_links"), 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.doesNotMatch(serverLog, new RegExp(marker));
  console.log(
    "rejected private-query input: 200 serialized validation error, no canary in response or captured Worker log",
  );
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("close", r));
  }
  rmSync(work, { recursive: true, force: true });
}
