# Atura-managed EveryApp platform

Atura operates the Gateway at `https://apps.atura.nl` in its own Cloudflare account. The source of truth for software releases is `atura-repos/every-app`, not npm's `everyapp@latest` or `every-app/every-app` GitHub releases. Cloudflare remains the infrastructure provider. This fork retains the original MIT license and attribution.

## Release policy

- Merge reviewed changes to Atura `main`; run PR Checks and Integration. Compare upstream changes and migrations before merging; never auto-sync upstream to production.
- Use Node >=22.18 and pinned pnpm. Run `pnpm install --frozen-lockfile`, `pnpm types:check`, `pnpm test:built-cli`, gateway unit tests, and the integration workflow. An individual failure blocks a release until understood.
- Tag a reviewed main commit as `atura-gateway-v<semver>` and manually run **Atura Gateway and CLI Release** with that tag. It creates an immutable Gateway tarball, CLI package and SHA256SUMS in an Atura GitHub Release; it does not deploy anything. Verify the tag, asset checksums and release manifest (`gitSha`, `sha256`, `minCli`) before rollout.
- For administration, run `pnpm everyapp ...` from this checkout; do **not** run the globally installed upstream `everyapp` or `npm install -g everyapp@latest`. For an explicit release use `--release` with an Atura-owned tarball/URL; the Gateway and CLI must remain compatible. The archive is not a replacement for the checkout or its history.

## Migration gate and production rollout

1. Record `pnpm everyapp status --account-id <ATURA_ACCOUNT_ID> --json`: Gateway URL, live version ID, release origin, Access drift, app registry and migrations. Never print deploy credentials. Back up D1 independently, record a Time Travel bookmark, and retain the previous Worker version ID. Verify Cloudflare's retention and restoration permissions. If apps exist, inventory their databases and object stores individually.
2. Install a **separately named** staging Gateway on a different hostname with `pnpm everyapp setup --name <STAGE_NAME> --domain <STAGE_HOST> --account-id <ATURA_ACCOUNT_ID> --json`. It has its own D1, queue and apps. Never reuse production's hostname, database or Access application. Claim its owner account and confirm staging Access before testing a private app, login and deployment end to end.
3. Confirm the staged `release.origin` or checkout tree hash, health, authentication, app routing and Access policies. Inspect any D1 migrations and pending schema changes. Do not interpret unauthenticated `/health` alone as an authentication test.
4. From the reviewed Atura tag/checkout, explicitly deploy to production (`pnpm everyapp update --account-id <ATURA_ACCOUNT_ID> --gateway https://apps.atura.nl --json` or `--release <ATURA_TARBALL>`). Do not use `--no-access`, `--force-dns` or `--allow-downgrade` without a reason and separate approval. If CLI returns `action_required` with `needsTerminal`, the operator must run its non-JSON command and confirm Cloudflare's prompt.
5. Re-read status and compare the production hostname, Worker version ID, Atura release origin and SHA, owner and app inventory, Access policy/drift and live routes. Test an authenticated login and at least one private app; monitor errors. Keep rollback artifacts and bookmarks until the acceptance window closes.

## Recovery

- A bad Gateway Worker can be rolled back to the saved previous version using Cloudflare Workers deployments; this is temporary, because a later EveryApp deploy may reapply the new version. A lasting rollback uses the prior Atura checkout/release with an explicitly authorized `--allow-downgrade` if required. Test against the migrated D1 schema first.
- D1 Time Travel restores the entire database and **loses all subsequent writes**. Do not run `pnpm everyapp db restore --gateway` automatically as a Worker rollback; obtain explicit authorization and verify the restore point and impact first. App databases, KV and R2 require separate recovery plans.
- Staging remains isolated; leave production unchanged if ownership, security checks, compatibility, backup or rollback cannot be verified.
