export type LiquidacionStatus =
  | "MATCH"
  | "LIST_MISMATCH"
  | "NOT_FOUND_LIST"
  | "MULTIPLE_LIST_ROWS"
  | "DETAIL_MISMATCH"
  | "EXTRA_IN_UAT"
  | "ERROR";

export interface LiquidacionConceptExpected {
  rowNumber: number;
  conceptType: string;
  conceptCode: string;
  conceptDescription: string;
  hlConcept: string;
  quantity: string;
  unitValue: string;
  amount: string;
  billedAmount: string;
  costCenter: string;
  costCenterDescription: string;
  laborAccum: string;
  group: string;
  taxableAmount: string;
}

export interface LiquidacionEmployeeExpected {
  externalNumber: string;
  employeeId: string;
  employeeName: string;
  document: string;
  liquidationDate: string;
  period: string;
  description: string;
  liquidationType: string;
  costCenter: string;
  costCenterDescription: string;
  concepts: LiquidacionConceptExpected[];
  sourceRows: number[];
}

export interface LiquidacionNumberExpected {
  externalNumber: string;
  employees: LiquidacionEmployeeExpected[];
}

export interface LiquidacionesExcelData {
  groups: LiquidacionNumberExpected[];
  skippedRows: number;
  rowsWithLiquidacion: number;
}

export interface LiquidacionGridRow {
  suffix: string;
  companyCode: string;
  externalNumber: string;
  internalNumber: string;
  typeCode: string;
  typeDescription: string;
  period: string;
  companyName: string;
  employeeName: string;
  employeeId: string;
  status: string;
  receiptNumber: string;
  receiptPrinted: string;
  invoiceNumber: string;
  liquidationDate: string;
  detailHref: string;
  displayHref: string;
  rawText: string;
}

export interface LiquidacionDetailConceptRow {
  conceptType: string;
  conceptCode: string;
  conceptDescription: string;
  quantity: string;
  unitValue: string;
  amount: string;
  billedAmount: string;
  costCenter: string;
  taxableAmount: string;
  rawCells: string[];
  rawText: string;
}

export interface LiquidacionValidationResult {
  externalNumber: string;
  employeeId: string;
  employeeName: string;
  internalNumber: string;
  status: LiquidacionStatus;
  matched: boolean;
  reason: string;
  expectedConcepts: number;
  foundConcepts: number;
  missingConcepts: string[];
  mismatchedConcepts: string[];
  extraConcepts: string[];
  listRow?: LiquidacionGridRow;
  error?: string;
}
