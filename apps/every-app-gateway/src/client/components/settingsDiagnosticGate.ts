const STAGING_ORIGIN = "https://stage-apps.atura.nl";

/** Exact origin and explicit opt-in; never accept lookalike hostnames. */
export function settingsDiagnosticEnabled(
  origin: string,
  path: string,
  search: string,
): boolean {
  return (
    origin === STAGING_ORIGIN &&
    path === "/settings" &&
    new URLSearchParams(search).get("atura-diagnostics") === "1"
  );
}
