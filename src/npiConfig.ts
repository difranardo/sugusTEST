import * as path from "node:path";
import dotenv from "dotenv";
import { BrowserName } from "./types";

dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta la variable obligatoria ${name} en .env`);
  }
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} debe ser numérico. Valor recibido: ${raw}`);
  }
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "si", "sí"].includes(raw)) return true;
  if (["false", "0", "no"].includes(raw)) return false;
  throw new Error(`${name} debe ser true o false. Valor recibido: ${raw}`);
}

function listEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function browserEnv(): BrowserName {
  const value = (process.env.SUGUS_BROWSER ?? "chrome").trim().toLowerCase();
  if (value === "chrome" || value === "edge" || value === "firefox") return value;
  throw new Error(`SUGUS_BROWSER no soportado: ${value}`);
}

export interface NpiBotConfig {
  baseUrl: string;
  username: string;
  password: string;
  browser: BrowserName;
  headless: boolean;
  keepOpen: boolean;
  waitMs: number;
  timeoutMs: number;
  menuPauseMs: number;
  afterClickPauseMs: number;
  pageTimeoutMs: number;
  menuTimeoutMs: number;
  matchMode: "strict" | "contains";
  allowWrite: boolean;
  directNavigationFallback: boolean;
  screenshotOnPass: boolean;
  outputDir: string;
  npiNumber: string;
  serviceTypeValue?: string;
  businessUnitValue?: string;
  positionValue?: string;
  userCompanyValue?: string;
  plantValue?: string;
  maintenanceBranchValue?: string;
  accountOperatorValue?: string;
  state: "A" | "I";
  conditionPayment: string;
  observation: string;
  forbiddenActiveIds: string[];
  groupSubgroupValue?: string;
  categoryText?: string;
  salaryDecrement: number;
  runFixedAmountSave: boolean;
}

export function loadNpiConfig(): NpiBotConfig {
  const matchMode = (process.env.NPI_MATCH_MODE ?? "strict").trim().toLowerCase();
  if (matchMode !== "strict" && matchMode !== "contains") {
    throw new Error("NPI_MATCH_MODE debe ser strict o contains");
  }

  const state = (process.env.NPI_STATE ?? "A").trim().toUpperCase();
  if (state !== "A" && state !== "I") {
    throw new Error("NPI_STATE debe ser A o I para completar la búsqueda");
  }

  return {
    baseUrl: required("SUGUS_URL"),
    username: required("SUGUS_USER"),
    password: required("SUGUS_PASS"),
    browser: browserEnv(),
    headless: boolEnv("SUGUS_HEADLESS", false),
    keepOpen: boolEnv("SUGUS_KEEP_OPEN", false),
    waitMs: numberEnv("SUGUS_WAIT_MS", 2000),
    timeoutMs: numberEnv("SUGUS_TIMEOUT_MS", 60000),
    menuPauseMs: numberEnv("SUGUS_NPI_MENU_PAUSE_MS", 5000),
    afterClickPauseMs: numberEnv("SUGUS_NPI_AFTER_CLICK_PAUSE_MS", 5000),
    pageTimeoutMs: numberEnv("SUGUS_NPI_PAGE_TIMEOUT_MS", 120000),
    menuTimeoutMs: numberEnv("SUGUS_NPI_MENU_TIMEOUT_MS", 120000),
    matchMode,
    allowWrite: boolEnv("SUGUS_ALLOW_WRITE", false),
    directNavigationFallback: boolEnv("SUGUS_DIRECT_NAV_FALLBACK", true),
    screenshotOnPass: boolEnv("SUGUS_SCREENSHOT_ON_PASS", false),
    outputDir: process.env.NPI_OUTPUT_DIR?.trim() || path.resolve(process.cwd(), "reports", "payroll-2962"),
    npiNumber: required("NPI_TEST_NUMBER"),
    serviceTypeValue: process.env.NPI_SERVICE_TYPE_VALUE?.trim() || undefined,
    businessUnitValue: process.env.NPI_BUSINESS_UNIT_VALUE?.trim() || undefined,
    positionValue: process.env.NPI_POSITION_VALUE?.trim() || undefined,
    userCompanyValue: process.env.NPI_USER_COMPANY_VALUE?.trim() || undefined,
    plantValue: process.env.NPI_PLANT_VALUE?.trim() || undefined,
    maintenanceBranchValue: process.env.NPI_MAINTENANCE_BRANCH_VALUE?.trim() || undefined,
    accountOperatorValue: process.env.NPI_ACCOUNT_OPERATOR_VALUE?.trim() || undefined,
    state: state as "A" | "I",
    conditionPayment: (process.env.NPI_CONDITION_PAYMENT ?? "30").trim(),
    observation: (process.env.NPI_TEST_OBSERVATION ?? "QA PAYROLL-2962").trim(),
    forbiddenActiveIds: listEnv("NPI_FORBIDDEN_ACTIVE_IDS"),
    groupSubgroupValue: process.env.NPI_GROUP_SUBGROUP_VALUE?.trim() || undefined,
    categoryText: process.env.NPI_CATEGORY_TEXT?.trim() || undefined,
    salaryDecrement: numberEnv("NPI_SALARY_DECREMENT", 0.01),
    runFixedAmountSave: boolEnv("NPI_RUN_FIXED_AMOUNT_SAVE", false)
  };
}
