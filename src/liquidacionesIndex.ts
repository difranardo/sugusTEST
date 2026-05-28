import { loadConfig } from "./config";
import { readLiquidacionesExcel } from "./liquidacionesExcel";
import { LiquidacionesBot } from "./liquidacionesBot";
import { compareConcepts } from "./liquidacionesMatching";
import { writeLiquidacionesReports, summarizeLiquidaciones } from "./liquidacionesReporter";
import {
  LiquidacionEmployeeExpected,
  LiquidacionGridRow,
  LiquidacionNumberExpected,
  LiquidacionValidationResult
} from "./liquidacionesTypes";
import { containsAllTokens } from "./normalize";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const [key, inlineValue] = withoutPrefix.split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

function asString(value: unknown, fallback = ""): string {
  if (value === undefined || value === null || value === false) {
    return fallback;
  }
  return String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "yes", "si", "s"].includes(String(value ?? "").toLowerCase());
}

function selectGroups(
  groups: LiquidacionNumberExpected[],
  liquidacion: string,
  limitLiquidaciones: number
): LiquidacionNumberExpected[] {
  const filtered = liquidacion ? groups.filter((group) => group.externalNumber === liquidacion) : groups;
  return limitLiquidaciones > 0 ? filtered.slice(0, limitLiquidaciones) : filtered;
}

function rowMatchesExpected(row: LiquidacionGridRow, expected: LiquidacionEmployeeExpected): boolean {
  if (row.employeeId && expected.employeeId && row.employeeId === expected.employeeId) {
    return true;
  }

  return Boolean(
    row.employeeName &&
      expected.employeeName &&
      (containsAllTokens(expected.employeeName, row.employeeName) || containsAllTokens(row.employeeName, expected.employeeName))
  );
}

function baseResult(expected: LiquidacionEmployeeExpected, row?: LiquidacionGridRow): LiquidacionValidationResult {
  return {
    externalNumber: expected.externalNumber,
    employeeId: expected.employeeId,
    employeeName: expected.employeeName,
    internalNumber: row?.internalNumber ?? "",
    status: "ERROR",
    matched: false,
    reason: "",
    expectedConcepts: expected.concepts.length,
    foundConcepts: 0,
    missingConcepts: [],
    mismatchedConcepts: [],
    extraConcepts: [],
    listRow: row
  };
}

async function validateExpectedEmployee(
  bot: LiquidacionesBot,
  expected: LiquidacionEmployeeExpected,
  row: LiquidacionGridRow,
  skipDetail: boolean
): Promise<LiquidacionValidationResult> {
  const result = baseResult(expected, row);

  if (skipDetail) {
    result.status = "MATCH";
    result.matched = true;
    result.reason = "Recurso encontrado. Detalle omitido por --skipDetail.";
    return result;
  }

  const detailRows = await bot.readDetailConcepts(row, expected.concepts.length);
  result.detailRows = detailRows;
  const comparison = compareConcepts(expected.concepts, detailRows);
  result.foundConcepts = detailRows.length;
  result.missingConcepts = comparison.missing;
  result.mismatchedConcepts = comparison.mismatched;
  result.extraConcepts = comparison.extra;

  const hasDetailDifferences =
    comparison.missing.length > 0 || comparison.mismatched.length > 0 || comparison.extra.length > 0;

  if (hasDetailDifferences) {
    result.status = "DETAIL_MISMATCH";
    result.reason = [
      comparison.missing.length > 0 ? `Faltan conceptos: ${comparison.missing.length}` : "",
      comparison.mismatched.length > 0 ? `Conceptos con diferencias: ${comparison.mismatched.length}` : "",
      comparison.extra.length > 0 ? `Conceptos extra en UAT: ${comparison.extra.length}` : ""
    ]
      .filter(Boolean)
      .join(" | ");
    return result;
  }

  result.status = "MATCH";
  result.matched = true;
  result.reason = "Recurso encontrado. Valor unitario, monto liq y monto fac coinciden.";
  return result;
}

function notFoundResult(expected: LiquidacionEmployeeExpected): LiquidacionValidationResult {
  return {
    ...baseResult(expected),
    status: "NOT_FOUND_LIST",
    reason: "No aparecio en la grilla para ese numero de liquidacion."
  };
}

function multipleRowsResult(expected: LiquidacionEmployeeExpected, rows: LiquidacionGridRow[]): LiquidacionValidationResult {
  return {
    ...baseResult(expected, rows[0]),
    status: "MULTIPLE_LIST_ROWS",
    reason: `Hay ${rows.length} filas UAT para el mismo recurso/nombre.`
  };
}

function extraRowResult(externalNumber: string, row: LiquidacionGridRow): LiquidacionValidationResult {
  return {
    externalNumber,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    internalNumber: row.internalNumber,
    status: "EXTRA_IN_UAT",
    matched: false,
    reason: "La fila aparece en UAT pero no esta en el Excel para esa liquidacion.",
    expectedConcepts: 0,
    foundConcepts: 0,
    missingConcepts: [],
    mismatchedConcepts: [],
    extraConcepts: [],
    listRow: row
  };
}

function errorResult(expected: LiquidacionEmployeeExpected, error: unknown, row?: LiquidacionGridRow): LiquidacionValidationResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...baseResult(expected, row),
    status: "ERROR",
    reason: "Fallo tecnico validando esta liquidacion.",
    error: message
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const requestedLiquidacion = asString(args.liquidacion);
  const limitLiquidaciones = asNumber(args.limitLiquidaciones, config.limit ?? 0);
  const skipDetail = asBoolean(args.skipDetail);

  const excelData = await readLiquidacionesExcel(config.excelPath, config.startRow ?? 2);
  const groups = selectGroups(excelData.groups, requestedLiquidacion, limitLiquidaciones);

  if (requestedLiquidacion && groups.length === 0) {
    throw new Error(`No encontre la liquidacion ${requestedLiquidacion} en el Excel.`);
  }

  console.log(`Excel: ${config.excelPath}`);
  console.log(`Filas Excel con liquidacion: ${excelData.rowsWithLiquidacion}`);
  console.log(`Filas Excel omitidas sin liquidacion: ${excelData.skippedRows}`);
  console.log(`Numeros de liquidacion a validar: ${groups.length}`);
  console.log(`Browser: ${config.browser} | headless=${config.headless} | detalle=${!skipDetail}`);

  const bot = new LiquidacionesBot(config);
  const results: LiquidacionValidationResult[] = [];

  try {
    await bot.start();
    console.log("Abriendo Sugus UAT y logueando...");
    await bot.login();
    console.log("Navegando a Liquidaciones > Consulta de Liquidaciones...");
    await bot.openLiquidacionesPage();

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      console.log("");
      console.log(
        `[${index + 1}/${groups.length}] Liquidacion gente ${group.externalNumber}: ${
          group.employees.length
        } recursos esperados`
      );

      let gridRows: LiquidacionGridRow[] = [];
      try {
        gridRows = await bot.searchLiquidacion(group.externalNumber, group.employees.length);
      } catch (error) {
        const diagnostic = await bot.saveDiagnostic(`liquidacion-${group.externalNumber}-search`);
        for (const expected of group.employees) {
          results.push(errorResult(expected, `${error instanceof Error ? error.message : String(error)}. ${diagnostic}`));
        }
        console.log(`  ERROR buscando ${group.externalNumber}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      const usedRows = new Set<number>();
      for (const expected of group.employees) {
        const matches = gridRows
          .map((row, rowIndex) => ({ row, rowIndex }))
          .filter(({ row }) => rowMatchesExpected(row, expected));

        if (matches.length === 0) {
          if (expected.employeeId) {
            try {
              console.log(`  No aparecio en la pagina actual. Rebusco recurso ${expected.employeeId} con filtro directo...`);
              const fallbackRows = await bot.searchLiquidacionForEmployee(group.externalNumber, expected.employeeId);
              const fallbackMatches = fallbackRows
                .map((row, rowIndex) => ({ row, rowIndex }))
                .filter(({ row }) => rowMatchesExpected(row, expected));

              if (fallbackMatches.length === 1) {
                const match = fallbackMatches[0];
                const result = await validateExpectedEmployee(bot, expected, match.row, skipDetail);
                results.push(result);
                console.log(
                  `  ${result.status} recurso ${expected.employeeId} liq interna ${match.row.internalNumber} (filtro directo)`
                );
                continue;
              }

              if (fallbackMatches.length > 1) {
                const result = multipleRowsResult(
                  expected,
                  fallbackMatches.map(({ row }) => row)
                );
                results.push(result);
                console.log(`  MULTIPLE_LIST_ROWS ${expected.employeeId} ${expected.employeeName} (filtro directo)`);
                continue;
              }
            } catch (error) {
              const result = errorResult(expected, error);
              results.push(result);
              console.log(
                `  ERROR rebuscando recurso ${expected.employeeId}: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
              continue;
            }
          }

          const result = notFoundResult(expected);
          results.push(result);
          console.log(`  NOT_FOUND_LIST ${expected.employeeId} ${expected.employeeName}`);
          continue;
        }

        if (matches.length > 1) {
          const result = multipleRowsResult(
            expected,
            matches.map(({ row }) => row)
          );
          results.push(result);
          console.log(`  MULTIPLE_LIST_ROWS ${expected.employeeId} ${expected.employeeName}`);
          continue;
        }

        const match = matches[0];
        usedRows.add(match.rowIndex);

        try {
          const result = await validateExpectedEmployee(bot, expected, match.row, skipDetail);
          results.push(result);
          console.log(`  ${result.status} recurso ${expected.employeeId} liq interna ${match.row.internalNumber}`);
        } catch (error) {
          const diagnostic = await bot.saveDiagnostic(
            `liquidacion-${group.externalNumber}-recurso-${expected.employeeId || "sin-recurso"}`
          );
          const result = errorResult(
            expected,
            `${error instanceof Error ? error.message : String(error)}. Diagnostico: ${diagnostic}`,
            match.row
          );
          results.push(result);
          console.log(
            `  ERROR recurso ${expected.employeeId} ${expected.employeeName}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      gridRows.forEach((row, rowIndex) => {
        if (!usedRows.has(rowIndex)) {
          results.push(extraRowResult(group.externalNumber, row));
          console.log(`  EXTRA_IN_UAT recurso ${row.employeeId} ${row.employeeName}`);
        }
      });
    }
  } finally {
    await bot.stop();
  }

  const reportPaths = writeLiquidacionesReports(results, config.outputDir);
  const summary = summarizeLiquidaciones(results);
  const matched = summary.MATCH;
  const notMatched = results.length - matched;

  console.log("");
  console.log("Resumen liquidaciones:");
  console.log(`  Matchearon: ${matched}`);
  console.log(`  No matchearon: ${notMatched}`);
  console.log(`  MATCH: ${summary.MATCH}`);
  console.log(`  LIST_MISMATCH: ${summary.LIST_MISMATCH}`);
  console.log(`  NOT_FOUND_LIST: ${summary.NOT_FOUND_LIST}`);
  console.log(`  MULTIPLE_LIST_ROWS: ${summary.MULTIPLE_LIST_ROWS}`);
  console.log(`  DETAIL_MISMATCH: ${summary.DETAIL_MISMATCH}`);
  console.log(`  EXTRA_IN_UAT: ${summary.EXTRA_IN_UAT}`);
  console.log(`  ERROR: ${summary.ERROR}`);
  console.log("");
  console.log(`CSV: ${reportPaths.csvPath}`);
  console.log(`JSON: ${reportPaths.jsonPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
