import * as fs from "node:fs";
import * as path from "node:path";
import { ValidationResult, ValidationStatus } from "./types";

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

export function summarize(results: ValidationResult[]): Record<ValidationStatus, number> {
  const initial: Record<ValidationStatus, number> = {
    MATCH: 0,
    NOT_FOUND: 0,
    NAME_MISMATCH: 0,
    DOCUMENT_MISMATCH: 0,
    MULTIPLE_MATCHES: 0,
    ERROR: 0
  };

  for (const result of results) {
    initial[result.status] += 1;
  }

  return initial;
}

export function writeReports(results: ValidationResult[], outputDir: string): { csvPath: string; jsonPath: string } {
  fs.mkdirSync(outputDir, { recursive: true });
  const baseName = `sugus-report-${timestamp()}`;
  const csvPath = path.join(outputDir, `${baseName}.csv`);
  const jsonPath = path.join(outputDir, `${baseName}.json`);

  const headers = [
    "excelRow",
    "employeeId",
    "expectedFirstNames",
    "expectedLastNames",
    "expectedDocument",
    "expectedEmail",
    "status",
    "matched",
    "reason",
    "foundCount",
    "foundCandidateCode",
    "foundFirstNames",
    "foundLastNames",
    "foundDocument",
    "foundEmail",
    "foundLegajos",
    "error"
  ];

  const lines = [
    headers.join(";"),
    ...results.map((result) => {
      const found = result.found;
      return [
        result.candidate.rowNumber,
        result.candidate.employeeId,
        result.candidate.expectedFirstNames,
        result.candidate.expectedLastNames,
        result.candidate.document,
        result.candidate.email,
        result.status,
        result.matched,
        result.reason,
        result.foundCount,
        found?.candidateCode ?? "",
        found?.firstNames ?? "",
        found?.lastNames ?? "",
        found?.document ?? "",
        found?.email ?? "",
        found?.legajos ?? "",
        result.error ?? ""
      ]
        .map(csvEscape)
        .join(";");
    })
  ];

  fs.writeFileSync(csvPath, lines.join("\r\n"), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({ summary: summarize(results), results }, null, 2), "utf8");

  return { csvPath, jsonPath };
}

