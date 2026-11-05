# P0 organizational external-link publication policy

Organizational external links are navigation-only bookmarks. Publication does not deploy an app, grant access at the destination, establish SSO, or assert that the destination is trustworthy. An owner/admin must choose **Everyone** or **Selected members and groups** explicitly on each create; no default audience is inferred. Restricted grants still require live, organization-scoped membership/group validation.

## Destination on create or URL change

- Require an absolute HTTPS URL with a public, dotted DNS hostname. Reject userinfo, custom ports (only default HTTPS), IP literals including alternate numeric representations, localhost/single-label and reserved/private host suffixes, backslashes, control characters, and encoded CR/LF. URL parsing canonicalizes the stored URL.
- Reject query parameter **names** suggesting secrets (tokens, API keys, authorization, credentials, passwords, codes, signatures, sessions, SAML responses, etc.). Never include the rejected URL, query values, or parameter names in validation errors or application logs. This is a conservative name-based filter, not a guarantee that other parameters or path fragments cannot carry secrets. Operators must inspect the destination and avoid credential-bearing URLs entirely.
- URL syntax does not prove DNS resolves to a public address now or later; this is not an SSRF defense. The Gateway does not fetch these links. A public DNS name can redirect to a different site; destination authentication and exposure need separate verification.

## Edit and legacy compatibility

Every edit requires the admin to re-enter the destination **hostname** matching the current URL, even when editing only the name or audience. The field is empty when the form opens and after a save/cancel. The server verifies it independently. An existing URL is not revalidated under the new publication policy if its bytes are unchanged, so legacy links remain listable, editable and deletable. A changed URL must meet the new publication policy. This does not silently republish or rewrite legacy URLs.

Personal bookmarks continue using the previous shared `externalLinkFormSchema`; the organizational create schema is separate. No migration or retroactive removal of existing links is performed.

## Acceptance checks

Unit schema tests cover audience selection, URL classes, secret query names and hostname confirmation; admin form tests cover explicit choice/re-entry. Migrated SQLite tests cover unchanged legacy edits, rejection before persistence, scoped list/delete and grant behavior. Local tests are not a staging rollout or a live user acceptance check.
