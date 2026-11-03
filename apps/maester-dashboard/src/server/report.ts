import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import logo from "./atura-logo.png?inline";

// Only normalized D1 columns enter this renderer. Never pass an imported HTML body.
export function sanitizeField(value: string, max = 160): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

type Report = {
  tenantName: string;
  suite: "daily" | "cis";
  benchmark: string;
  startedAt: string;
  scanStatus: string;
  workflowConclusion: string | null;
  counts: {
    passed: number;
    failed: number;
    skipped: number;
    notRun: number;
    technical: number;
    total: number;
  };
  controls: { testId: string; title: string; result: string }[];
  digest: string;
};
const navy = rgb(34 / 255, 49 / 255, 95 / 255);
const teal = rgb(76 / 255, 181 / 255, 174 / 255);
const labels: Record<string, string> = {
  Passed: "Geslaagd",
  Failed: "Afgekeurd",
  Skipped: "Overgeslagen",
  NotRun: "Niet uitgevoerd",
  Error: "Technische fout",
};
export async function renderReport(report: Report): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Atura Maester - concept beveiligingsrapport");
  pdf.setAuthor("Atura");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const image = await pdf.embedPng(logo);
  let page = pdf.addPage([595, 842]);
  let y = 710;
  const text = (
    value: string,
    x: number,
    top: number,
    size = 11,
    heavy = false,
  ) => {
    page.drawText(sanitizeField(value, 95), {
      x,
      y: top,
      size,
      font: heavy ? bold : regular,
      color: navy,
    });
  };
  const newPage = () => {
    page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 40, y: 787, width: 515, height: 3, color: teal });
    text("Atura | Maester - concept", 40, 765, 11, true);
    y = 725;
  };
  page.drawRectangle({ x: 0, y: 730, width: 595, height: 112, color: navy });
  page.drawImage(image, { x: 42, y: 763, width: 150, height: 52 });
  page.drawRectangle({ x: 40, y: 727, width: 515, height: 4, color: teal });
  text("Atura | CONCEPT - niet voor distributie", 40, y, 17, true);
  y -= 36;
  text("Maester beveiligingsinzichten", 40, y, 18, true);
  y -= 30;
  text(`Organisatie: ${report.tenantName}`, 40, y);
  y -= 20;
  text(
    `Scan: ${report.suite === "cis" ? "CIS-assessment" : "Dagelijkse controles"}`,
    40,
    y,
  );
  y -= 20;
  text(`Benchmark: ${report.benchmark} | Datum: ${report.startedAt}`, 40, y);
  y -= 20;
  text(
    `Scanstatus: ${report.scanStatus} | Workflow: ${report.workflowConclusion ?? "onbekend"}`,
    40,
    y,
  );
  y -= 24;
  text(
    `Geslaagd ${report.counts.passed}   Afgekeurd ${report.counts.failed}   Overgeslagen ${report.counts.skipped}`,
    40,
    y,
  );
  y -= 19;
  text(
    `Technische fouten ${report.counts.technical}   Niet uitgevoerd ${report.counts.notRun}   Verwacht ${report.counts.total}`,
    40,
    y,
  );
  y -= 28;
  text("Controleoverzicht", 40, y, 14, true);
  y -= 24;
  for (const control of report.controls.slice(0, 500)) {
    if (y < 74) newPage();
    text(`${control.testId}: ${control.title}`, 40, y);
    y -= 16;
    text(labels[control.result] ?? "Onbekend", 57, y, 10, true);
    y -= 23;
  }
  if (y < 105) newPage();
  text(`Bronversie SHA-256: ${report.digest}`, 40, y, 9);
  y -= 20;
  text(
    "Interne beoordeling vereist. Dit document is niet verzonden aan de klant.",
    40,
    y,
    9,
  );
  return pdf.save();
}
