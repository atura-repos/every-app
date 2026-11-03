import { useEffect, useState } from "react";

type State = { digest: string; status: "not_created" | "concept" | "approved" };
export function ReportActions({
  tenant,
  run,
}: {
  tenant: string;
  run: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/reports?tenant=${encodeURIComponent(tenant)}&run=${encodeURIComponent(run)}`;
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Status niet beschikbaar");
        if (active) setState((await response.json()) as State);
      })
      .catch(() => {
        if (active) setError("PDF-status niet beschikbaar");
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  const act = async (action: "concept" | "approve") => {
    if (busy || (action === "approve" && !state?.digest)) return;
    if (
      action === "approve" &&
      !window.confirm(
        `Keur uitsluitend PDF-versie ${state?.digest} goed? Er wordt geen e-mail verstuurd.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, digest: state?.digest }),
      });
      if (!response.ok)
        throw new Error(
          "Versie gewijzigd of toegang geweigerd. Ververs de pagina.",
        );
      setState((await response.json()) as State);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "PDF niet beschikbaar",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="report-actions">
      <button type="button" disabled={busy} onClick={() => void act("concept")}>
        PDF-concept maken
      </button>
      <button
        type="button"
        disabled={busy || state?.status !== "concept"}
        onClick={() => void act("approve")}
      >
        Goedkeuren (deze versie)
      </button>
      {state?.status === "concept" && (
        <a href={`${endpoint}&digest=${state.digest}&preview=1`}>
          Concept-PDF downloaden om te beoordelen
        </a>
      )}
      {state?.status === "approved" && (
        <a href={`${endpoint}&digest=${state.digest}`}>
          Goedgekeurde PDF downloaden
        </a>
      )}
      <span aria-live="polite">
        {state?.digest
          ? `Versie SHA-256: ${state.digest} · ${state.status}`
          : "Nog geen concept"}
        {error ? ` · ${error}` : ""}
      </span>
    </div>
  );
}
