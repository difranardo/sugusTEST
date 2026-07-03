import { loadConfig } from "./config";
import {
  allFacturacionDocumentTypes,
  readFacturacionExcel
} from "./facturacionExcel";
import { FacturacionBot } from "./facturacionBot";
import { writeFacturacionReports, summarizeFacturacion } from "./facturacionReporter";
import {
  FacturacionDocumentType,
  FacturacionExpectedDocument,
  FacturacionValidationResult
} from "./facturacionTypes";

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

function parseDocumentTypes(value: string): Set<FacturacionDocumentType> {
  const allowed = new Set(allFacturacionDocumentTypes);
  const values = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error("No se indico ningun tipo de documento para facturacion.");
  }

  for (const item of values) {
    if (!allowed.has(item as FacturacionDocumentType)) {
      throw new Error(`Tipo de documento no soportado: ${item}. Usar ${allFacturacionDocumentTypes.join(",")}.`);
    }
  }

  return new Set(values as FacturacionDocumentType[]);
}

function describeDocument(document: FacturacionExpectedDocument): string {
  return [
    `fila ${document.rowNumber}`,
    document.documentType,
    document.typeLetter,
    document.number,
    document.clientCode ? `cliente ${document.clientCode}` : "",
    document.clientName
  ]
    .filter(Boolean)
    .join(" | ");
}

function errorResult(expected: FacturacionExpectedDocument, error: unknown): FacturacionValidationResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    expected,
    status: "ERROR",
    matched: false,
    reason: "Fallo tecnico validando este comprobante.",
    foundCount: 0,
    error: message
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const documentTypes = parseDocumentTypes(
    asString(args.documentTypes, process.env.SUGUS_FACTURACION_DOCUMENT_TYPES || allFacturacionDocumentTypes.join(","))
  );
  const excelData = await readFacturacionExcel(
    config.excelPath,
    config.facturacionTipo,
    documentTypes,
    config.startRow ?? 1
  );
  const documents =
    config.limit && config.limit > 0 ? excelData.documents.slice(0, config.limit) : excelData.documents;

  if (documents.length === 0) {
    throw new Error("No encontre comprobantes de facturacion para validar en el Excel.");
  }

  console.log(`Excel: ${config.excelPath}`);
  console.log(`Comprobantes a validar: ${documents.length}`);
  console.log(`Filas omitidas sin comprobante: ${excelData.skippedRows}`);
  console.log(`Filas omitidas por tipo no soportado/no solicitado: ${excelData.unsupportedRows}`);
  console.log(`Tipos incluidos: ${Array.from(documentTypes).join(",")}`);
  console.log(`Tipo letra: ${config.facturacionTipo} | Fecha desde: ${config.facturacionFechaDesde}`);
  console.log(`Browser: ${config.browser} | headless=${config.headless}`);

  const bot = new FacturacionBot(config);
  const results: FacturacionValidationResult[] = [];

  try {
    await bot.start();
    console.log("Abriendo Sugus UAT y logueando...");
    await bot.login();
    console.log("Navegando a Facturacion > Facturas / NC / ND...");
    await bot.openFacturacionPage();

    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      const prefix = `[${index + 1}/${documents.length}]`;

      try {
        const result = await bot.validateDocument(document);
        results.push(result);
        console.log(`${prefix} ${result.status}: ${describeDocument(document)}`);
      } catch (error) {
        const diagnostic = await bot.saveDiagnostic(`facturacion-${document.documentType}-${document.number}`);
        const result = errorResult(
          document,
          `${error instanceof Error ? error.message : String(error)}. Diagnostico: ${diagnostic}`
        );
        results.push(result);
        console.log(`${prefix} ERROR: ${describeDocument(document)} -> ${result.error}`);
      }
    }
  } finally {
    await bot.stop();
  }

  const reportPaths = writeFacturacionReports(results, config.outputDir);
  const summary = summarizeFacturacion(results);
  const matched = summary.MATCH;
  const notMatched = results.length - matched;

  console.log("");
  console.log("Resumen facturacion:");
  console.log(`  Matchearon: ${matched}`);
  console.log(`  No matchearon: ${notMatched}`);
  console.log(`  MATCH: ${summary.MATCH}`);
  console.log(`  NOT_FOUND: ${summary.NOT_FOUND}`);
  console.log(`  MULTIPLE_MATCHES: ${summary.MULTIPLE_MATCHES}`);
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
