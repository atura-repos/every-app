import { ReportActions } from "./ReportActions";
import type {
  compareRuns,
  listTenants,
  readDashboard,
} from "@/server/dashboard";

type Data = Awaited<ReturnType<typeof readDashboard>>;
type Props = Data & {
  tenants: Awaited<ReturnType<typeof listTenants>>;
  selectedTenant: string;
  suite: "daily" | "cis";
};
const labels = {
  Passed: "Geslaagd",
  Failed: "Afgekeurd",
  Skipped: "Overgeslagen (scan)",
  NotRun: "Niet uitgevoerd",
  Error: "Technische fout",
} as const;

export function DashboardView({
  tenants,
  selectedTenant,
  suite,
  runs,
  importEvents,
  comparisons,
}: Props) {
  const link = (tenant: string, type: "daily" | "cis") =>
    `/?tenant=${encodeURIComponent(tenant)}&suite=${type}`;
  return (
    <main className="dashboard">
      <header className="masthead">
        <img src="/brand/atura-logo-kleur.svg" alt="Atura" width="168" />
        <div>
          <p className="eyebrow">Beveiligingsinzichten · interne pilot</p>
          <h1>Maester-dashboard</h1>
        </div>
        <a href="/" aria-label="Overzicht">
          Overzicht
        </a>
      </header>
      <div className="layout">
        <aside aria-label="Tenantnavigatie">
          <h2>Organisaties</h2>
          <nav>
            {tenants.map((tenant) => (
              <a
                key={tenant.id}
                aria-current={selectedTenant === tenant.id ? "page" : undefined}
                href={link(tenant.id, suite)}
              >
                {tenant.name}
              </a>
            ))}
          </nav>
          <p>
            Alleen expliciet gemachtigde Atura-medewerkers. Geen klanttoegang.
          </p>
        </aside>
        <div className="content">
          <nav aria-label="Scantype" className="tabs">
            <a
              aria-current={suite === "daily" ? "page" : undefined}
              href={link(selectedTenant, "daily")}
            >
              Dagelijks
            </a>
            <a
              aria-current={suite === "cis" ? "page" : undefined}
              href={link(selectedTenant, "cis")}
            >
              CIS-assessment
            </a>
          </nav>
          <section aria-labelledby="runs-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Runhistorie</p>
                <h2 id="runs-title">
                  {suite === "daily"
                    ? "Dagelijkse controles"
                    : "CIS-assessments"}
                </h2>
              </div>
              <span className="muted">
                Alleen gestructureerde, geverifieerde resultaten
              </span>
            </div>
            {runs.length === 0 ? (
              <div className="empty">
                Nog geen gestructureerde scans beschikbaar. Oude
                GitHub-artifacts kunnen verlopen zijn; ontbrekende historie
                wordt niet gereconstrueerd.
              </div>
            ) : (
              runs.map((run) => (
                <article
                  className="run"
                  key={run.id}
                  aria-label={`Run ${run.id}`}
                >
                  <div className="run-top">
                    <div>
                      <h3>
                        <time dateTime={run.startedAt}>{run.startedAt}</time>
                      </h3>
                      <p className="muted">
                        Benchmark: {run.benchmark} · Run-ID: {run.id}
                      </p>
                    </div>
                    <span className="badge">
                      {run.scanStatus === "technical_error"
                        ? "Technische fout in scan"
                        : run.scanStatus === "skipped"
                          ? "Scan overgeslagen"
                          : "Scan afgerond"}
                    </span>
                  </div>
                  <p className="muted">
                    Workflowconclusie: {run.workflowConclusion ?? "onbekend"}{" "}
                    (geen testresultaat)
                  </p>
                  <div className="metrics">
                    <div>
                      <strong>{run.counts.passed}</strong>
                      <span>Geslaagd</span>
                    </div>
                    <div>
                      <strong>{run.counts.failed}</strong>
                      <span>Afgekeurd</span>
                    </div>
                    <div>
                      <strong>{run.counts.skipped}</strong>
                      <span>Overgeslagen</span>
                    </div>
                    <div>
                      <strong>{run.counts.technical}</strong>
                      <span>Technische fout</span>
                    </div>
                    <div>
                      <strong>{run.counts.total}</strong>
                      <span>Verwacht</span>
                    </div>
                  </div>
                  <ReportActions tenant={selectedTenant} run={run.id} />
                  <details>
                    <summary>Controles bekijken</summary>
                    <ul className="controls">
                      {run.controls.map((control) => (
                        <li key={control.testId}>
                          <span>
                            {control.title} <small>({control.testId})</small>
                          </span>
                          <strong data-result={control.result}>
                            {labels[control.result]}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              ))
            )}
          </section>
          <section aria-labelledby="import-title">
            <h2 id="import-title">Importstatus</h2>
            {importEvents.length ? (
              <ul>
                {importEvents.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.observedAt}>{event.observedAt}</time>{" "}
                    {event.id} ·{" "}
                    {event.code === "projection_missing"
                      ? "Veilige projectie ontbreekt — controleer de GitHub-run en herstart de import na herstel."
                      : event.code === "attempt_unverifiable"
                        ? "Herpoging niet verifieerbaar — controleer de artifact-herkomst."
                        : "Import mislukt — controleer de bron en probeer na herstel opnieuw."}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Geen geregistreerde importproblemen.</p>
            )}
          </section>
          <section aria-labelledby="trend-title">
            <h2 id="trend-title">Vergelijking met vorige run</h2>
            {comparisons.length ? (
              <ul className="comparisons">
                {comparisons.map((item) => (
                  <li key={item.currentId}>
                    {item.previousId} → {item.currentId}:{" "}
                    {item.comparable
                      ? `${item.improved.length} verbeterd · ${item.regressed.length} verslechterd${"unresolved" in item && item.unresolved ? ` · ${item.unresolved.length} niet beoordeelbaar` : ""}`
                      : item.reason === "scope_changed"
                        ? "Scope gewijzigd — geen trendvergelijking"
                        : "Technische fout — geen trendvergelijking"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nog geen vergelijkbare herhaalscan.</p>
            )}
          </section>
          <footer>
            Geen klantversie beschikbaar zonder expliciete goedkeuring. Geen
            automatische klantmail of distributie.
          </footer>
        </div>
      </div>
    </main>
  );
}
