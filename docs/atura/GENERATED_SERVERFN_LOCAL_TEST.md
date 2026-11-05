# Generated server-function transport: local proof for PR #14

From the repository root, run:

```sh
pnpm -C apps/every-app-gateway build
node apps/every-app-gateway/scripts/generated-serverfn-transport.mjs
```

This test uses the **production `cf build` output**, not `cf dev` and not a Vitest stand-in for `@tanstack/react-start/server-entry` or `createServerFn`. A pinned Wrangler 4.157.0 starts that bundle with `--no-bundle --local`, its static assets and a freshly migrated **local-only** D1. The script extracts the current generated function IDs from Vite's server manifest, signs disposable Better Auth cookies for two synthetic database sessions, sends serialized TanStack POST payloads to `/_serverFn/<generated-id>` over HTTP, and checks the responses and D1 counts. Temporary Wrangler configuration, session material, logs and local database are removed on completion (including assertion failure). No tenant, Cloudflare account or remote database is contacted; `pnpm dlx` only downloads the pinned local CLI if it is not cached. Port 18788 must be free.

Checks: member can create only their own link (HTTP 200 serialized result with their user and organization); a direct member POST to publish an organization link returns **HTTP 200 with a serialized authorization error**, and leaves zero shared rows; admin POST returns HTTP 200 with the shared row; same-origin headers succeed, a sibling origin with `Sec-Fetch-Site: same-site` returns HTTP 403 `server_fn_denied`, and absent `Origin` **and** Fetch Metadata returns HTTP 403 `csrf_denied`, both without an additional row. A rejected URL containing a synthetic private-query marker returns a serialized validation error without the marker in its response or the captured Worker log. HTTP 200 for a serialized function error is the installed TanStack transport, **not** an authorization success or an HTTP 409 conflict.

The synthetic canary check exercises validation and the real generated handler. The separate `src/middleware/publicError.test.ts` regression injects an unexpected exception containing a synthetic private URL and checks the error log and serialized response; the local transport does not inject that exception into the production bundle. It does not prove Cloudflare Access, browser behavior, real accounts or cross-isolate revocation. `cf dev` still fails on the installed `@cloudflare/config` computed import attributes under es2024; this production-bundle route avoids the optimizer instead of modifying it. No deploy or live test is implied.
