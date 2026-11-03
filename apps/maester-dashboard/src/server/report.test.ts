import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderReport, sanitizeField } from "./report";

const report = {
  tenantName: "Voorbeeld BV",
  suite: "cis" as const,
  benchmark: "CIS v1",
  startedAt: "2026-11-03T10:00:00Z",
  scanStatus: "completed",
  workflowConclusion: "failure",
  counts: {
    passed: 1,
    failed: 1,
    skipped: 0,
    notRun: 0,
    technical: 0,
    total: 2,
  },
  controls: [
    { testId: "a", title: "Veilige instelling", result: "Passed" },
    {
      testId: "b",
      title: "<script>alert('secret')</script> MFA",
      result: "Failed",
    },
  ],
  digest: "a".repeat(64),
};

describe("customer concept PDF", () => {
  it("produces real readable branded pages from only bounded plain fields, never executable imported HTML", async () => {
    const bytes = await renderReport(report);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const document = await getDocument({ data: bytes }).promise;
    expect(document.numPages).toBeGreaterThanOrEqual(1);
    const text = (
      await Promise.all(
        Array.from({ length: document.numPages }, async (_, i) =>
          (await (await document.getPage(i + 1)).getTextContent()).items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" "),
        ),
      )
    ).join(" ");
    expect(text).toContain("Atura");
    expect(text).toContain("Voorbeeld BV");
    expect(text).toContain("CONCEPT");
    expect(text).toContain("MFA");
    expect(text).toContain("Afgekeurd");
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("secret");
  });
  it("prints skipped and not-executed totals separately", async () => {
    const bytes = await renderReport({
      ...report,
      counts: {
        passed: 0,
        failed: 0,
        skipped: 1,
        notRun: 1,
        technical: 0,
        total: 2,
      },
      controls: [
        { testId: "a", title: "a", result: "Skipped" },
        { testId: "b", title: "b", result: "NotRun" },
      ],
    });
    const document = await getDocument({ data: bytes }).promise;
    const text = (await (await document.getPage(1)).getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(text).toContain("Overgeslagen 1");
    expect(text).toContain("Niet uitgevoerd 1");
    expect(text).not.toContain("Overgeslagen 2");
  });
  it("removes markup, control characters, and bounds untrusted field lengths", () => {
    expect(sanitizeField("<img src=x onerror=alert(1)>OK\u0000", 10)).toBe(
      "OK",
    );
    expect(sanitizeField("x".repeat(500), 80)).toHaveLength(80);
    expect(sanitizeField("MFA 🔐 control")).toBe("MFA control");
  });
});
