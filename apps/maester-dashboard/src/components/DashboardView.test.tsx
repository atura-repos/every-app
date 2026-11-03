import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "./DashboardView";

const model = {
  tenants: [{ id: "atura", name: "Atura" }],
  selectedTenant: "atura",
  suite: "daily" as const,
  runs: [
    {
      id: "run-1",
      tenantId: "atura",
      suite: "daily" as const,
      benchmark: "CIS v1",
      startedAt: "2026-11-01T12:00:00Z",
      scanStatus: "technical_error" as const,
      workflowConclusion: "failure",
      expectedTestIds: ["a", "b", "c", "d"],
      counts: { passed: 1, failed: 1, skipped: 1, technical: 1, total: 4 },
      controls: [
        { testId: "a", title: "Control A", result: "Passed" as const },
        { testId: "b", title: "Control B", result: "Failed" as const },
        { testId: "c", title: "Control C", result: "NotRun" as const },
        { testId: "d", title: "Control D", result: "Error" as const },
      ],
    },
  ],
  comparisons: [
    {
      currentId: "run-1",
      previousId: "run-0",
      comparable: false as const,
      reason: "scope_changed" as const,
    },
  ],
};
describe("dashboard presentation", () => {
  it("uses official logo and text labels for every result, scopes and technical status", () => {
    const html = renderToStaticMarkup(<DashboardView {...model} />);
    for (const text of [
      "Atura",
      "Dagelijks",
      "CIS",
      "Geslaagd",
      "Afgekeurd",
      "Overgeslagen",
      "Technische fout",
      "Scope gewijzigd",
      "Control A",
      "Control D",
      "Geen klantversie beschikbaar",
    ])
      expect(html).toContain(text);
    expect(html).toContain("/brand/atura-logo-kleur.svg");
    expect(html).toContain('alt="Atura"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("Start scan");
  });
  it("shows empty state without claiming a historical import", () => {
    const html = renderToStaticMarkup(
      <DashboardView {...model} runs={[]} comparisons={[]} />,
    );
    expect(html).toContain("Nog geen gestructureerde scans beschikbaar");
    expect(html).not.toContain("Control A");
  });
});
