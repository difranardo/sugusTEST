import * as fs from "node:fs";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { Candidate } from "./types";
import { joinParts, normalizeDocument, normalizeHeader } from "./normalize";

export type ExcelRow = Record<string, unknown>;
type XmlNode = string | number | boolean | null | undefined | Record<string, unknown> | XmlNode[];

interface SheetRow {
  rowNumber: number;
  values: string[];
}

function rowToNormalizedMap(row: ExcelRow): Map<string, unknown> {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeHeader(key), value);
  }
  return normalized;
}

function getCell(row: Map<string, unknown>, ...headers: string[]): string {
  for (const header of headers) {
    const value = row.get(normalizeHeader(header));
    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function readText(node: XmlNode): string {
  if (node === null || node === undefined) {
    return "";
  }

  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(readText).join("");
  }

  if ("#text" in node) {
    return readText(node["#text"] as XmlNode);
  }

  if ("t" in node) {
    return readText(node.t as XmlNode);
  }

  if ("r" in node) {
    return readText(node.r as XmlNode);
  }

  return "";
}

function columnIndexFromRef(cellRef: string): number {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] ?? "").toUpperCase();
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - "A".charCodeAt(0) + 1);
  }

  return Math.max(index - 1, 0);
}

async function parseXml(zip: JSZip, filePath: string, optional = false): Promise<Record<string, unknown>> {
  const file = zip.file(filePath);
  if (!file) {
    if (optional) {
      return {};
    }
    throw new Error(`No se encontro ${filePath} dentro del XLSX.`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "#text"
  });

  return parser.parse(await file.async("text")) as Record<string, unknown>;
}

function getFirstWorksheetPath(workbookXml: Record<string, unknown>, relsXml: Record<string, unknown>): string {
  const workbook = workbookXml.workbook as Record<string, unknown> | undefined;
  const sheetsNode = workbook?.sheets as Record<string, unknown> | undefined;
  const firstSheet = toArray(sheetsNode?.sheet as Record<string, unknown> | Record<string, unknown>[] | undefined)[0];

  if (!firstSheet) {
    throw new Error("El Excel no tiene hojas.");
  }

  const relationshipId = String(firstSheet["r:id"] ?? "");
  const rels = relsXml.Relationships as Record<string, unknown> | undefined;
  const relationships = toArray(rels?.Relationship as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const relationship = relationships.find((rel) => String(rel.Id ?? "") === relationshipId);
  const target = String(relationship?.Target ?? "");

  if (!target) {
    throw new Error("No se pudo resolver la primera hoja del Excel.");
  }

  if (target.startsWith("/")) {
    return target.slice(1);
  }

  return `xl/${target}`.replace(/\\/g, "/");
}

function readSharedStrings(sharedStringsXml: Record<string, unknown>): string[] {
  const sst = sharedStringsXml.sst as Record<string, unknown> | undefined;
  return toArray(sst?.si as XmlNode | XmlNode[] | undefined).map(readText);
}

function readCellValue(cell: Record<string, unknown>, sharedStrings: string[]): string {
  const type = String(cell.t ?? "");

  if (type === "s") {
    const sharedStringIndex = Number(cell.v ?? 0);
    return sharedStrings[sharedStringIndex] ?? "";
  }

  if (type === "inlineStr") {
    return readText(cell.is as XmlNode);
  }

  return readText(cell.v as XmlNode);
}

function readSheetRows(sheetXml: Record<string, unknown>, sharedStrings: string[]): SheetRow[] {
  const worksheet = sheetXml.worksheet as Record<string, unknown> | undefined;
  const sheetData = worksheet?.sheetData as Record<string, unknown> | undefined;
  const rows = toArray(sheetData?.row as Record<string, unknown> | Record<string, unknown>[] | undefined);

  return rows.map((row, index) => {
    const cells = toArray(row.c as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const values: string[] = [];

    for (const cell of cells) {
      const ref = String(cell.r ?? "");
      values[columnIndexFromRef(ref)] = readCellValue(cell, sharedStrings).trim();
    }

    return {
      rowNumber: Number(row.r ?? index + 1),
      values
    };
  });
}

export async function readExcelRows(excelPath: string): Promise<Array<{ rowNumber: number; rawRow: ExcelRow }>> {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`No existe el Excel: ${excelPath}`);
  }

  const zip = await JSZip.loadAsync(fs.readFileSync(excelPath));
  const workbookXml = await parseXml(zip, "xl/workbook.xml");
  const relsXml = await parseXml(zip, "xl/_rels/workbook.xml.rels");
  const sharedStringsXml = await parseXml(zip, "xl/sharedStrings.xml", true);
  const sharedStrings = readSharedStrings(sharedStringsXml);
  const sheetXml = await parseXml(zip, getFirstWorksheetPath(workbookXml, relsXml));
  const sheetRows = readSheetRows(sheetXml, sharedStrings);
  const headerRow = sheetRows.find((row) => row.values.some(Boolean));

  if (!headerRow) {
    throw new Error("No se encontro fila de encabezados en el Excel.");
  }

  const headers = headerRow.values;
  return sheetRows
    .filter((row) => row.rowNumber > headerRow.rowNumber)
    .map((row) => {
      const rawRow: ExcelRow = {};
      headers.forEach((header, index) => {
        if (header) {
          rawRow[header] = row.values[index] ?? "";
        }
      });
      return { rowNumber: row.rowNumber, rawRow };
    });
}

export async function readCandidates(excelPath: string): Promise<Candidate[]> {
  const rows = await readExcelRows(excelPath);

  return rows
    .map(({ rowNumber, rawRow }): Candidate => {
      const row = rowToNormalizedMap(rawRow);
      const firstName = getCell(row, "1er nombre", "primer nombre");
      const secondName = getCell(row, "2do nombre", "segundo nombre");
      const firstSurname = getCell(row, "1er apellido", "primer apellido");
      const secondSurname = getCell(row, "2do apellido", "segundo apellido");

      return {
        rowNumber,
        employeeId: getCell(row, "N funcionario", "Nro funcionario", "Numero funcionario", "No funcionario"),
        firstName,
        secondName,
        firstSurname,
        secondSurname,
        email: getCell(row, "Correo electronico", "Email", "Correo"),
        document: normalizeDocument(getCell(row, "Documento identidad", "Documento", "Nro documento")),
        expectedFirstNames: joinParts([firstName, secondName]),
        expectedLastNames: joinParts([firstSurname, secondSurname])
      };
    })
    .filter((candidate) => candidate.expectedFirstNames || candidate.expectedLastNames || candidate.document);
}
