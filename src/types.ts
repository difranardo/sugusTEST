export type BrowserName = "chrome" | "edge" | "firefox";
export type MatchMode = "strict" | "primary";

export interface AppConfig {
  url: string;
  username: string;
  password: string;
  excelPath: string;
  browser: BrowserName;
  headless: boolean;
  outputDir: string;
  waitMs: number;
  timeoutMs: number;
  candidatesMenuPauseMs: number;
  candidatesAfterClickPauseMs: number;
  candidatesPageTimeoutMs: number;
  liquidacionesMenuPauseMs: number;
  liquidacionesMenuTimeoutMs: number;
  liquidacionesAfterClickPauseMs: number;
  liquidacionesPageTimeoutMs: number;
  facturacionMenuPauseMs: number;
  facturacionMenuTimeoutMs: number;
  facturacionAfterClickPauseMs: number;
  facturacionPageTimeoutMs: number;
  facturacionTipo: string;
  facturacionFechaDesde: string;
  facturacionUrl: string;
  limit?: number;
  startRow?: number;
  keepOpen: boolean;
  matchMode: MatchMode;
}

export interface Candidate {
  rowNumber: number;
  employeeId: string;
  firstName: string;
  secondName: string;
  firstSurname: string;
  secondSurname: string;
  email: string;
  document: string;
  expectedFirstNames: string;
  expectedLastNames: string;
}

export interface SugusGridRow {
  candidateCode: string;
  firstNames: string;
  lastNames: string;
  documentType: string;
  document: string;
  email: string;
  legajos: string;
}

export type ValidationStatus =
  | "MATCH"
  | "NOT_FOUND"
  | "NAME_MISMATCH"
  | "DOCUMENT_MISMATCH"
  | "MULTIPLE_MATCHES"
  | "ERROR";

export interface ValidationResult {
  candidate: Candidate;
  status: ValidationStatus;
  matched: boolean;
  reason: string;
  foundCount: number;
  found?: SugusGridRow;
  error?: string;
}
