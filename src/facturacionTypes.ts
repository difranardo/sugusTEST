export type FacturacionDocumentType = "FC" | "ET" | "NC" | "CE" | "ND" | "DE";

export type FacturacionStatus = "MATCH" | "NOT_FOUND" | "MULTIPLE_MATCHES" | "ERROR";

export interface FacturacionExpectedDocument {
  rowNumber: number;
  clientCode: string;
  clientName: string;
  movementCode: string;
  movementDescription: string;
  documentType: FacturacionDocumentType;
  documentTypeLabel: string;
  typeLetter: string;
  number: string;
  issueDate: string;
  dueDate: string;
  dueAmount: string;
  balanceAmount: string;
  currency: string;
  rawCells: string[];
}

export interface FacturacionExcelData {
  documents: FacturacionExpectedDocument[];
  skippedRows: number;
  unsupportedRows: number;
}

export interface FacturacionGridRow {
  documentType: string;
  documentTypeLabel: string;
  typeLetter: string;
  branch: string;
  number: string;
  comprobante: string;
  date: string;
  status: string;
  clientName: string;
  gross: string;
  subTotal: string;
  iva: string;
  total: string;
  currency: string;
  authorizationDate: string;
  cae: string;
  rawCells: string[];
  rawText: string;
}

export interface FacturacionValidationResult {
  expected: FacturacionExpectedDocument;
  status: FacturacionStatus;
  matched: boolean;
  reason: string;
  foundCount: number;
  found?: FacturacionGridRow;
  rows?: FacturacionGridRow[];
  error?: string;
}
