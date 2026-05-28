import * as fs from "node:fs";
import * as path from "node:path";
import { LiquidacionDetailConceptRow, LiquidacionStatus, LiquidacionValidationResult } from "./liquidacionesTypes";

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

function formatDetailConcept(row: LiquidacionDetailConceptRow): string {
  return [
    row.conceptCode,
    row.conceptDescription,
    `valorUnit=${row.unitValue}`,
    `montoLiq=${row.amount}`,
    `montoFac=${row.billedAmount}`,
    row.rawCells.length > 0 ? `raw=[${row.rawCells.join(" | ")}]` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

export function summarizeLiquidaciones(results: LiquidacionValidationResult[]): Record<LiquidacionStatus, number> {
  const initial: Record<LiquidacionStatus, number> = {
    MATCH: 0,
    LIST_MISMATCH: 0,
    NOT_FOUND_LIST: 0,
    MULTIPLE_LIST_ROWS: 0,
    DETAIL_MISMATCH: 0,
    EXTRA_IN_UAT: 0,
    ERROR: 0
  };

  for (const result of results) {
    initial[result.status] += 1;
  }

  return initial;
}

export function writeLiquidacionesReports(
  results: LiquidacionValidationResult[],
  outputDir: string
): { csvPath: string; jsonPath: string } {
  fs.mkdirSync(outputDir, { recursive: true });
  const baseName = `sugus-liquidaciones-report-${timestamp()}`;
  const csvPath = path.join(outputDir, `${baseName}.csv`);
  const jsonPath = path.join(outputDir, `${baseName}.json`);

  const headers = [
    "liquidacionGente",
    "employeeId",
    "employeeName",
    "internalLiquidacion",
    "status",
    "matched",
    "reason",
    "expectedConcepts",
    "foundConcepts",
    "missingConcepts",
    "mismatchedConcepts",
    "extraConcepts",
    "uatDetailConcepts",
    "uatType",
    "uatPeriod",
    "uatStatus",
    "uatReceipt",
    "error"
  ];

  const lines = [
    headers.join(";"),
    ...results.map((result) => {
      const row = result.listRow;
      return [
        result.externalNumber,
        result.employeeId,
        result.employeeName,
        result.internalNumber,
        result.status,
        result.matched,
        result.reason,
        result.expectedConcepts,
        result.foundConcepts,
        result.missingConcepts.join(" || "),
        result.mismatchedConcepts.join(" || "),
        result.extraConcepts.join(" || "),
        result.detailRows?.map(formatDetailConcept).join(" || ") ?? "",
        row?.typeDescription || row?.typeCode || "",
        row?.period ?? "",
        row?.status ?? "",
        row?.receiptNumber ?? "",
        result.error ?? ""
      ]
        .map(csvEscape)
        .join(";");
    })
  ];

  fs.writeFileSync(csvPath, lines.join("\r\n"), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({ summary: summarizeLiquidaciones(results), results }, null, 2), "utf8");

  return { csvPath, jsonPath };
}
