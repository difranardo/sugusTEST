import { ExcelRow, readExcelRows } from "./excel";
import { normalizeHeader } from "./normalize";
import {
  LiquidacionConceptExpected,
  LiquidacionEmployeeExpected,
  LiquidacionNumberExpected,
  LiquidacionesExcelData
} from "./liquidacionesTypes";

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

function normalizeCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = Number(trimmed.replace(",", "."));
  if (Number.isFinite(parsed) && Number.isInteger(parsed)) {
    return String(parsed);
  }

  return trimmed;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const serial = Number(trimmed);
  if (Number.isFinite(serial) && serial > 20000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 24 * 60 * 60 * 1000);
    return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  }

  const parts = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!parts) {
    return trimmed;
  }

  const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
  return `${pad2(Number(parts[1]))}/${pad2(Number(parts[2]))}/${year}`;
}

function compareCodes(a: string, b: string): number {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }
  return a.localeCompare(b);
}

function makeConcept(rowNumber: number, row: Map<string, unknown>): LiquidacionConceptExpected {
  return {
    rowNumber,
    conceptType: normalizeCode(getCell(row, "Tipo concepto")),
    conceptCode: normalizeCode(getCell(row, "Concepto (liq)")),
    conceptDescription: getCell(row, "Descripcion concepto (liq)"),
    hlConcept: getCell(row, "Concepto para HL"),
    quantity: getCell(row, "Cantidad (liq)"),
    unitValue: getCell(row, "Valor unitario (liq)"),
    amount: getCell(row, "Importe (liq)"),
    billedAmount: getCell(row, "Monto Fac", "Monto facturado", "Importe facturado", "Monto factura", "Importe factura"),
    costCenter: normalizeCode(getCell(row, "Centro costo (liq)")),
    costCenterDescription: getCell(row, "Desc centro costo (liq)"),
    laborAccum: normalizeCode(getCell(row, "Acumul laboral")),
    group: getCell(row, "Grupo"),
    taxableAmount: getCell(row, "Importe gravado JUB")
  };
}

export async function readLiquidacionesExcel(excelPath: string, startRow = 2): Promise<LiquidacionesExcelData> {
  const rows = await readExcelRows(excelPath);
  const employeeGroups = new Map<string, LiquidacionEmployeeExpected>();
  let skippedRows = 0;
  let rowsWithLiquidacion = 0;

  for (const { rowNumber, rawRow } of rows) {
    if (rowNumber < startRow) {
      continue;
    }

    const row = rowToNormalizedMap(rawRow);
    const externalNumber = normalizeCode(getCell(row, "Numero de liquidacion"));
    if (!externalNumber) {
      skippedRows += 1;
      continue;
    }

    rowsWithLiquidacion += 1;
    const employeeId = normalizeCode(getCell(row, "N funcionario", "Nro funcionario", "Numero funcionario"));
    const employeeName = getCell(row, "Apellidos y nombres");
    const key = `${externalNumber}|${employeeId || employeeName}`;
    const liquidationDate = normalizeDate(getCell(row, "Fecha de liquidacion"));
    const concept = makeConcept(rowNumber, row);

    if (!employeeGroups.has(key)) {
      const period = normalizeCode(getCell(row, "Periodo", "Período", "Periodo liquidacion", "Periodo liquidación"));
      employeeGroups.set(key, {
        externalNumber,
        employeeId,
        employeeName,
        document: normalizeCode(getCell(row, "Documento identidad")),
        liquidationDate,
        period,
        description: getCell(row, "Descripcion liquidacion"),
        liquidationType: getCell(row, "Tipo liquidacion (liq)"),
        costCenter: normalizeCode(getCell(row, "Centro costo (car)")),
        costCenterDescription: getCell(row, "Desc centro costo (car)"),
        concepts: [],
        sourceRows: []
      });
    }

    const group = employeeGroups.get(key);
    if (group) {
      group.concepts.push(concept);
      group.sourceRows.push(rowNumber);
    }
  }

  const byNumber = new Map<string, LiquidacionNumberExpected>();
  for (const group of employeeGroups.values()) {
    if (!byNumber.has(group.externalNumber)) {
      byNumber.set(group.externalNumber, { externalNumber: group.externalNumber, employees: [] });
    }
    byNumber.get(group.externalNumber)?.employees.push(group);
  }

  const groups = [...byNumber.values()]
    .map((group) => ({
      ...group,
      employees: group.employees.sort((a, b) => compareCodes(a.employeeId, b.employeeId))
    }))
    .sort((a, b) => compareCodes(a.externalNumber, b.externalNumber));

  return { groups, skippedRows, rowsWithLiquidacion };
}
