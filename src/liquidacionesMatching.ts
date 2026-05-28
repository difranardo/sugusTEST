import { containsAllTokens, normalizeText } from "./normalize";
import {
  LiquidacionConceptExpected,
  LiquidacionDetailConceptRow,
  LiquidacionEmployeeExpected,
  LiquidacionGridRow
} from "./liquidacionesTypes";

export function parseLocaleNumber(value: unknown): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return undefined;
  }

  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) {
    return undefined;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeNumberText(value: unknown, decimals = 2): string {
  const parsed = parseLocaleNumber(value);
  if (parsed === undefined) {
    return String(value ?? "").trim();
  }
  return parsed.toFixed(decimals);
}

function numberMatches(expected: unknown, actual: unknown, tolerance = 0.02): boolean {
  const expectedNumber = parseLocaleNumber(expected);
  const actualNumber = parseLocaleNumber(actual);
  if (expectedNumber === undefined || actualNumber === undefined) {
    return true;
  }
  return Math.abs(expectedNumber - actualNumber) <= tolerance;
}

function extractCode(value: unknown): string {
  const text = String(value ?? "");
  const match = text.match(/\d+/);
  return match ? String(Number(match[0])) : "";
}

function textCompatible(expected: string, actual: string): boolean {
  if (!expected || !actual) {
    return true;
  }
  return (
    containsAllTokens(expected, actual) ||
    containsAllTokens(actual, expected) ||
    compactPayrollText(expected).includes(compactPayrollText(actual)) ||
    compactPayrollText(actual).includes(compactPayrollText(expected)) ||
    payrollTokensCompatible(expected, actual)
  );
}

function compactPayrollText(value: unknown): string {
  return normalizeText(value)
    .replace(/\bB P S\b/g, "BPS")
    .replace(/\bS N I S\b/g, "SNIS")
    .replace(/\bF R L\b/g, "FRL")
    .replace(/\bI R P F\b/g, "IRPF")
    .replace(/\bVACACIONAL(?:ES)?\b/g, "VACACION")
    .replace(/\bVACACIONES\b/g, "VACACION")
    .replace(/\bREDONDEOS\b/g, "REDONDEO")
    .replace(/[^A-Z0-9]+/g, "");
}

function payrollTokensCompatible(expected: string, actual: string): boolean {
  const expectedCompact = compactPayrollText(expected);
  const actualCompact = compactPayrollText(actual);

  if (!expectedCompact || !actualCompact) {
    return false;
  }

  const aliases: Array<[RegExp, RegExp]> = [
    [/BPS/, /BPS/],
    [/SNIS/, /SNIS|FONASA/],
    [/FRL/, /FRL/],
    [/IRPF.*PRIMARIO/, /IRPF.*PRIMARIO/],
    [/IRPF.*DEDUCCIONES/, /IRPF.*DEDUCCIONES/],
    [/REDONDEO/, /REDONDEO/],
    [/LICENCIA/, /LICENCIA/],
    [/SALVACACION|VACACION/, /VACACION/]
  ];

  return aliases.some(([expectedPattern, actualPattern]) => {
    return expectedPattern.test(expectedCompact) && actualPattern.test(actualCompact);
  });
}

export function validateListRow(expected: LiquidacionEmployeeExpected, row: LiquidacionGridRow): string[] {
  const mismatches: string[] = [];

  if (row.externalNumber && row.externalNumber !== expected.externalNumber) {
    mismatches.push(`nro gente esperado ${expected.externalNumber}, UAT ${row.externalNumber}`);
  }

  if (expected.employeeId && row.employeeId && row.employeeId !== expected.employeeId) {
    mismatches.push(`recurso esperado ${expected.employeeId}, UAT ${row.employeeId}`);
  }

  if (expected.employeeName && row.employeeName && !textCompatible(expected.employeeName, row.employeeName)) {
    mismatches.push(`nombre esperado ${expected.employeeName}, UAT ${row.employeeName}`);
  }

  if (expected.period && row.period && row.period !== expected.period) {
    mismatches.push(`periodo esperado ${expected.period}, UAT ${row.period}`);
  }

  if (expected.liquidationType && row.typeCode) {
    const expectedType = normalizeText(expected.liquidationType);
    const actualCode = normalizeText(row.typeCode);
    const actualDescription = normalizeText(row.typeDescription);
    if (expectedType !== actualCode && !actualDescription.includes(expectedType)) {
      mismatches.push(`tipo esperado ${expected.liquidationType}, UAT ${row.typeCode || row.typeDescription}`);
    }
  }

  if (expected.liquidationDate && row.liquidationDate && expected.liquidationDate !== row.liquidationDate) {
    mismatches.push(`fecha esperada ${expected.liquidationDate}, UAT ${row.liquidationDate}`);
  }

  return mismatches;
}

export function describeExpectedConcept(concept: LiquidacionConceptExpected): string {
  return `${concept.conceptCode} ${concept.conceptDescription} imp=${normalizeNumberText(concept.amount)}`;
}

function describeActualConcept(concept: LiquidacionDetailConceptRow): string {
  const code = extractCode(concept.conceptCode || concept.rawText);
  const description = concept.conceptDescription || concept.rawText;
  return `${code} ${description} imp=${normalizeNumberText(concept.amount)}`.trim();
}

function conceptCodeMatches(expected: LiquidacionConceptExpected, actual: LiquidacionDetailConceptRow): boolean {
  const actualCode = extractCode(actual.conceptCode || actual.rawText);
  return Boolean(expected.conceptCode && actualCode && expected.conceptCode === actualCode);
}

function conceptTextMatches(expected: LiquidacionConceptExpected, actual: LiquidacionDetailConceptRow): boolean {
  const actualText = [actual.conceptDescription, actual.conceptCode, actual.rawText].filter(Boolean).join(" ");
  return textCompatible(expected.conceptDescription, actualText);
}

function conceptIdentityMatches(expected: LiquidacionConceptExpected, actual: LiquidacionDetailConceptRow): boolean {
  return conceptCodeMatches(expected, actual) || conceptTextMatches(expected, actual);
}

function scoreConcept(expected: LiquidacionConceptExpected, actual: LiquidacionDetailConceptRow): number {
  let score = 0;
  if (conceptCodeMatches(expected, actual)) {
    score += 100;
  }
  if (conceptTextMatches(expected, actual)) {
    score += 40;
  }
  if (numberMatches(expected.amount, actual.amount)) {
    score += 20;
  }
  if (textCompatible(expected.conceptDescription, actual.conceptDescription || actual.rawText)) {
    score += 10;
  }
  if (numberMatches(expected.quantity, actual.quantity, 0.0001)) {
    score += 5;
  }
  return score;
}

function conceptMismatches(expected: LiquidacionConceptExpected, actual: LiquidacionDetailConceptRow): string[] {
  const mismatches: string[] = [];

  if (!numberMatches(expected.amount, actual.amount)) {
    mismatches.push(`importe esperado ${expected.amount}, UAT ${actual.amount}`);
  }

  if (actual.quantity && !numberMatches(expected.quantity, actual.quantity, 0.0001)) {
    mismatches.push(`cantidad esperada ${expected.quantity}, UAT ${actual.quantity}`);
  }

  if (actual.unitValue && !numberMatches(expected.unitValue, actual.unitValue)) {
    mismatches.push(`valor unitario esperado ${expected.unitValue}, UAT ${actual.unitValue}`);
  }

  if (actual.taxableAmount && !numberMatches(expected.taxableAmount, actual.taxableAmount)) {
    mismatches.push(`gravado JUB esperado ${expected.taxableAmount}, UAT ${actual.taxableAmount}`);
  }

  if (actual.conceptDescription && !textCompatible(expected.conceptDescription, actual.conceptDescription)) {
    mismatches.push(`descripcion esperada ${expected.conceptDescription}, UAT ${actual.conceptDescription}`);
  }

  return mismatches;
}

export function compareConcepts(
  expectedConcepts: LiquidacionConceptExpected[],
  actualConcepts: LiquidacionDetailConceptRow[]
): { missing: string[]; mismatched: string[]; extra: string[] } {
  const usedActualIndexes = new Set<number>();
  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const expected of expectedConcepts) {
    let bestIndex = -1;
    let bestScore = -1;

    for (let index = 0; index < actualConcepts.length; index += 1) {
      if (usedActualIndexes.has(index)) {
        continue;
      }

      const actual = actualConcepts[index];
      if (!conceptIdentityMatches(expected, actual)) {
        continue;
      }

      const score = scoreConcept(expected, actual);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) {
      missing.push(describeExpectedConcept(expected));
      continue;
    }

    usedActualIndexes.add(bestIndex);
    const actual = actualConcepts[bestIndex];
    const differences = conceptMismatches(expected, actual);
    if (differences.length > 0) {
      mismatched.push(`${describeExpectedConcept(expected)} -> ${differences.join(" | ")}`);
    }
  }

  const extra = actualConcepts
    .filter((_, index) => !usedActualIndexes.has(index))
    .map(describeActualConcept)
    .filter(Boolean);

  return { missing, mismatched, extra };
}
