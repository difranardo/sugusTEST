import * as path from "node:path";
import dotenv from "dotenv";
import { AppConfig, BrowserName, MatchMode } from "./types";

dotenv.config();

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

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "yes", "si", "y"].includes(String(value).toLowerCase());
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBrowser(value: string): BrowserName {
  if (value === "chrome" || value === "edge" || value === "firefox") {
    return value;
  }
  throw new Error(`Browser no soportado: ${value}. Usar chrome, edge o firefox.`);
}

function parseMatchMode(value: string): MatchMode {
  if (value === "strict" || value === "primary") {
    return value;
  }
  throw new Error(`Match mode no soportado: ${value}. Usar strict o primary.`);
}

export function loadConfig(argv = process.argv.slice(2)): AppConfig {
  const args = parseArgs(argv);
  const excelPath = asString(args.excel, process.env.EXCEL_PATH || path.resolve(process.cwd(), "ACTIVOS.xlsx"));
  const username = asString(args.user, process.env.SUGUS_USER);
  const password = asString(args.pass, process.env.SUGUS_PASS);

  if (!username) {
    throw new Error("Falta SUGUS_USER. Cargarlo en .env o pasar --user.");
  }

  if (!password) {
    throw new Error("Falta SUGUS_PASS. Cargarlo en .env o pasar --pass.");
  }

  return {
    url: asString(args.url, process.env.SUGUS_URL || "https://sugus-uat-uy.randstad.com.uy/login.aspx"),
    username,
    password,
    excelPath,
    browser: parseBrowser(asString(args.browser, process.env.SUGUS_BROWSER || "chrome")),
    headless: asBoolean(args.headless, asBoolean(process.env.SUGUS_HEADLESS, false)),
    outputDir: asString(args.out, process.env.OUTPUT_DIR || path.resolve(process.cwd(), "reports")),
    waitMs: asNumber(args.waitMs, asNumber(process.env.SUGUS_WAIT_MS, 900)),
    timeoutMs: asNumber(args.timeoutMs, asNumber(process.env.SUGUS_TIMEOUT_MS, 30000)),
    candidatesMenuPauseMs: asNumber(
      args.candidatesMenuPauseMs,
      asNumber(process.env.SUGUS_CANDIDATES_MENU_PAUSE_MS, 2000)
    ),
    candidatesAfterClickPauseMs: asNumber(
      args.candidatesAfterClickPauseMs,
      asNumber(process.env.SUGUS_CANDIDATES_AFTER_CLICK_PAUSE_MS, 5000)
    ),
    candidatesPageTimeoutMs: asNumber(
      args.candidatesPageTimeoutMs,
      asNumber(process.env.SUGUS_CANDIDATES_PAGE_TIMEOUT_MS, 120000)
    ),
    liquidacionesMenuPauseMs: asNumber(
      args.liquidacionesMenuPauseMs,
      asNumber(process.env.SUGUS_LIQUIDACIONES_MENU_PAUSE_MS, 5000)
    ),
    liquidacionesMenuTimeoutMs: asNumber(
      args.liquidacionesMenuTimeoutMs,
      asNumber(process.env.SUGUS_LIQUIDACIONES_MENU_TIMEOUT_MS, 120000)
    ),
    liquidacionesAfterClickPauseMs: asNumber(
      args.liquidacionesAfterClickPauseMs,
      asNumber(process.env.SUGUS_LIQUIDACIONES_AFTER_CLICK_PAUSE_MS, 5000)
    ),
    liquidacionesPageTimeoutMs: asNumber(
      args.liquidacionesPageTimeoutMs,
      asNumber(process.env.SUGUS_LIQUIDACIONES_PAGE_TIMEOUT_MS, 120000)
    ),
    facturacionMenuPauseMs: asNumber(
      args.facturacionMenuPauseMs,
      asNumber(process.env.SUGUS_FACTURACION_MENU_PAUSE_MS, 5000)
    ),
    facturacionMenuTimeoutMs: asNumber(
      args.facturacionMenuTimeoutMs,
      asNumber(process.env.SUGUS_FACTURACION_MENU_TIMEOUT_MS, 120000)
    ),
    facturacionAfterClickPauseMs: asNumber(
      args.facturacionAfterClickPauseMs,
      asNumber(process.env.SUGUS_FACTURACION_AFTER_CLICK_PAUSE_MS, 5000)
    ),
    facturacionPageTimeoutMs: asNumber(
      args.facturacionPageTimeoutMs,
      asNumber(process.env.SUGUS_FACTURACION_PAGE_TIMEOUT_MS, 120000)
    ),
    facturacionTipo: asString(args.tipo, process.env.SUGUS_FACTURACION_TIPO || "A").toUpperCase(),
    facturacionFechaDesde: asString(
      args.facturacionFechaDesde,
      process.env.SUGUS_FACTURACION_FECHA_DESDE || "01/01/2000"
    ),
    facturacionUrl: asString(args.facturacionUrl, process.env.SUGUS_FACTURACION_URL || ""),
    limit: args.limit === undefined ? undefined : asNumber(args.limit, 0),
    startRow: args.startRow === undefined ? undefined : asNumber(args.startRow, 2),
    keepOpen: asBoolean(args.keepOpen, false),
    matchMode: parseMatchMode(asString(args.matchMode, process.env.SUGUS_MATCH_MODE || "strict"))
  };
}
