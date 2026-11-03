# Maester-dashboard (Atura pilot)

Read-only EveryApp-managed app. No public routes, ingestion transport, scan trigger, report download, PDF release or automatic email. No customer data or historical JSON is bundled. GitHub Actions artifacts currently expire after ~14 days; an empty dashboard is expected until a separately reviewed importer populates verified normalized rows. `REPORTS` is reserved for a future reviewed download path; it is **not** accessible by this version.

## Security boundary

- Gateway authentication **and a narrow, explicit app grant** are prerequisites. Do not give this app an everyone/org-wide grant. Verify the actual Entra sign-in and direct-URL denial for another member before release.
- Every read checks the SDK-signed `context.user`: exact email `mvanfalier@atura.nl`, required `PILOT_USER_ID`, required `PILOT_ORG_ID`, `web` channel, actor equals user, and an explicit `(tenant_id, org_id, user_id)` row in this app's own D1. Missing settings or grant fail closed. No browser cache of private results; user-provided tenant and suite are validated server-side. The pilot's immutable Gateway user and organization IDs must be determined by an authorized operator and supplied as app secrets, not guessed from email. Neither secrets nor access rows are seeded by this source tree.
- The app has its **own** D1 `DB` and reserved R2 `REPORTS`, never Gateway D1. No public webhook/health endpoint, no tools. Do not import unsafe scan data directly into tables. Future importer must authenticate immutable repo/workflow mapping, validate schema/version, limits, field allowlist and idempotency, prevent cross-tenant controls and test duplicates, and separately review public-route transport. A Gateway grant does not authenticate a webhook.
- The read model supports schema_version 1: `tenant_id`, `expected_test_ids`, control `test_id`, `title`, `result` (Passed/Failed/NotRun/Error). Scan status and workflow conclusion are separate. Missing controls count as skipped except a crashed scan, when they count as technical. Comparison requires same tenant/suite/benchmark/expected ID set and unchanged title per ID; technical scans are not comparable. Titles are a conservative proxy for meaning; an importer must bind semantic definition/version before customer use.
- Do not release customer reports: PDF approval, R2 object-isolation, retention deletion and audit have not been implemented. The UI states that no client version is available. No customer onboarding or production pilot is authorized by this code alone.

## Local verification

`pnpm -C apps/maester-dashboard test` and `pnpm -C apps/maester-dashboard build` from this repository. Tests use the generated migration in in-memory SQLite, fictional identities/tenants only. Review `drizzle/` before deployment; the migration contains no tenant seed. No deploy or push was performed for this initial app.

Brand sources: Atura official September 2026 handover `brand/source/2026-09-official-handbook/{HANDOVER.md,tokens.css}` and unmodified `public/brand/atura-logo-kleur.svg`. The CSS token source is copied verbatim; no logo redraw/recolor. A production design/accessibility review remains necessary.
