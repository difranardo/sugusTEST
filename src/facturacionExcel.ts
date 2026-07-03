import { readExcelSheetRows, SheetRow } from "./excel";
import { normalizeHeader, normalizeText } from "./normalize";
import {
  FacturacionDocumentType,
  FacturacionExcelData,
  FacturacionExpectedDocument
} from "./facturacionTypes";

interface HeaderIndexes {
  clientCode: number;
  clientName: number;
  movementCode: number;
  movementDescription: number;
  number: number;
  issueDate: number;
  dueDate: number;
  dueAmount: number;
  balanceAmount: number;
  currency: number;
}

interface DocumentTypeMapping {
  documentType: FacturacionDocumentType;
  documentTypeLabel: string;
}

export const allFacturacionDocumentTypes: FacturacionDocumentType[] = ["FC", "ET", "NC", "CE", "ND", "DE"];

function getCell(row: SheetRow, index: number): string {
  if (index < 0) {
    return "";
  }
  return String(row.values[index] ?? "").trim();
}

function normalizeNumber(value: string): string {
  return value.replace(/\D/g, "");
}

function findHeaderIndex(headers: string[], exactNames: string[], startsWithNames: string[] = []): number {
  const exact = new Set(exactNames.map(normalizeHeader));
  const startsWith = startsWithNames.map(normalizeHeader);

  return headers.findIndex((header) => exact.has(header) || startsWith.some((prefix) => header.startsWith(prefix)));
}

function findHeaderRow(rows: SheetRow[]): SheetRow {
  const headerRow = rows.find((row) => {
    const headers = row.values.map(normalizeHeader);
    return (
      headers.includes("cliente proveedor") &&
      headers.includes("mov descripcion") &&
      headers.includes("numero")
    );
  });

  if (!headerRow) {
    throw new Error("No se encontro la fila de encabezados de cuenta corriente en el Excel.");
  }

  return headerRow;
}

function headerIndexes(headerRow: SheetRow): HeaderIndexes {
  const headers = headerRow.values.map(normalizeHeader);
  const indexes: HeaderIndexes = {
    clientCode: findHeaderIndex(headers, ["Cliente/Proveedor"]),
    clientName: findHeaderIndex(headers, ["Razon social"]),
    movementCode: findHeaderIndex(headers, ["Mov codigo"]),
    movementDescription: findHeaderIndex(headers, ["Mov descripcion"]),
    number: findHeaderIndex(headers, ["Numero"]),
    issueDate: findHeaderIndex(headers, ["Fecha"]),
    dueDate: findHeaderIndex(headers, ["Fecha vto"]),
    dueAmount: findHeaderIndex(headers, ["Importe vto"]),
    balanceAmount: findHeaderIndex(headers, [], ["Saldo vto al"]),
    currency: findHeaderIndex(headers, ["Moneda"])
  };

  const required: Array<[keyof HeaderIndexes, string]> = [
    ["clientCode", "Cliente/Proveedor"],
    ["clientName", "Razon social"],
    ["movementDescription", "Mov descripcion"],
    ["number", "Numero"]
  ];

  const missing = required.filter(([key]) => indexes[key] < 0).map(([, label]) => label);
  if (missing.length > 0) {
    throw new Error(`Faltan columnas requeridas en el Excel: ${missing.join(", ")}.`);
  }

  return indexes;
}

function mapMovementDescription(description: string): DocumentTypeMapping | undefined {
  const normalized = normalizeText(description);
  const isETicket = normalized.includes("E TICKET") || normalized.includes("ETICKET");

  if (normalized.includes("NOTA DE CREDITO")) {
    return {
      documentType: isETicket ? "CE" : "NC",
      documentTypeLabel: isETicket ? "NOTA DE CREDITO E-TICKET" : "NOTA DE CREDITO"
    };
  }

  if (normalized.includes("NOTA DE DEBITO")) {
    return {
      documentType: isETicket ? "DE" : "ND",
      documentTypeLabel: isETicket ? "NOTA DE DEBITO E-TICKET" : "NOTA DE DEBITO"
    };
  }

  if (normalized.includes("FACTURA") || normalized.includes("TICKET")) {
    return {
      documentType: isETicket ? "ET" : "FC",
      documentTypeLabel: isETicket ? "E-TICKET" : "FACTURA"
    };
  }

  return undefined;
}

function formatExcelDate(value: string): string {
  const trimmed = value.trim();
  const parsed = Number(trimmed.replace(",", "."));

  if (Number.isFinite(parsed) && parsed > 20000 && parsed < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(parsed) * 86400000);
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = String(date.getUTCFullYear());
    return `${day}/${month}/${year}`;
  }

  return trimmed;
}

export async function readFacturacionExcel(
  excelPath: string,
  defaultTypeLetter: string,
  documentTypes = new Set<FacturacionDocumentType>(allFacturacionDocumentTypes),
  startRow = 1
): Promise<FacturacionExcelData> {
  const rows = await readExcelSheetRows(excelPath);
  const headerRow = findHeaderRow(rows);
  const indexes = headerIndexes(headerRow);
  const documents: FacturacionExpectedDocument[] = [];
  let skippedRows = 0;
  let unsupportedRows = 0;

  for (const row of rows.filter((item) => item.rowNumber > headerRow.rowNumber && item.rowNumber >= startRow)) {
    const movementDescription = getCell(row, indexes.movementDescription);
    const rawNumber = getCell(row, indexes.number);
    const number = normalizeNumber(rawNumber);

    if (!movementDescription || !number) {
      skippedRows += 1;
      continue;
    }

    const mapping = mapMovementDescription(movementDescription);
    if (!mapping || !documentTypes.has(mapping.documentType)) {
      unsupportedRows += 1;
      continue;
    }

    documents.push({
      rowNumber: row.rowNumber,
      clientCode: getCell(row, indexes.clientCode),
      clientName: getCell(row, indexes.clientName),
      movementCode: getCell(row, indexes.movementCode),
      movementDescription,
      documentType: mapping.documentType,
      documentTypeLabel: mapping.documentTypeLabel,
      typeLetter: defaultTypeLetter.toUpperCase(),
      number,
      issueDate: formatExcelDate(getCell(row, indexes.issueDate)),
      dueDate: formatExcelDate(getCell(row, indexes.dueDate)),
      dueAmount: getCell(row, indexes.dueAmount),
      balanceAmount: getCell(row, indexes.balanceAmount),
      currency: getCell(row, indexes.currency),
      rawCells: row.values.map((value) => String(value ?? "").trim())
    });
  }

  return { documents, skippedRows, unsupportedRows };
}
