import * as fs from "node:fs";
import * as path from "node:path";
import { FacturacionStatus, FacturacionValidationResult } from "./facturacionTypes";

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\r\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function summarizeFacturacion(results: FacturacionValidationResult[]): Record<FacturacionStatus, number> {
  const initial: Record<FacturacionStatus, number> = {
    MATCH: 0,
    NOT_FOUND: 0,
    MULTIPLE_MATCHES: 0,
    ERROR: 0
  };

  for (const result of results) {
    initial[result.status] += 1;
  }

  return initial;
}

export function writeFacturacionReports(
  results: FacturacionValidationResult[],
  outputDir: string
): { csvPath: string; jsonPath: string } {
  fs.mkdirSync(outputDir, { recursive: true });
  const baseName = `sugus-facturacion-report-${timestamp()}`;
  const csvPath = path.join(outputDir, `${baseName}.csv`);
  const jsonPath = path.join(outputDir, `${baseName}.json`);

  const headers = [
    "excelRow",
    "clientCode",
    "clientName",
    "movementDescription",
    "expectedDocType",
    "expectedTypeLetter",
    "expectedNumber",
    "expectedIssueDate",
    "expectedDueDate",
    "expectedDueAmount",
    "expectedBalanceAmount",
    "expectedCurrency",
    "status",
    "matched",
    "reason",
    "foundCount",
    "uatComprobante",
    "uatDocType",
    "uatTypeLetter",
    "uatNumber",
    "uatDate",
    "uatStatus",
    "uatClientName",
    "uatTotal",
    "uatCurrency",
    "uatCae",
    "error"
  ];

  const lines = [
    headers.join(";"),
    ...results.map((result) => {
      const expected = result.expected;
      const found = result.found;
      return [
        expected.rowNumber,
        expected.clientCode,
        expected.clientName,
        expected.movementDescription,
        expected.documentType,
        expected.typeLetter,
        expected.number,
        expected.issueDate,
        expected.dueDate,
        expected.dueAmount,
        expected.balanceAmount,
        expected.currency,
        result.status,
        result.matched,
        result.reason,
        result.foundCount,
        found?.comprobante ?? "",
        found?.documentType || found?.documentTypeLabel || "",
        found?.typeLetter ?? "",
        found?.number ?? "",
        found?.date ?? "",
        found?.status ?? "",
        found?.clientName ?? "",
        found?.total ?? "",
        found?.currency ?? "",
        found?.cae ?? "",
        result.error ?? ""
      ]
        .map(csvEscape)
        .join(";");
    })
  ];

  fs.writeFileSync(csvPath, lines.join("\r\n"), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({ summary: summarizeFacturacion(results), results }, null, 2), "utf8");

  return { csvPath, jsonPath };
}
