import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Browser, Builder, logging, WebDriver } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";
import * as edge from "selenium-webdriver/edge";
import * as firefox from "selenium-webdriver/firefox";
import { NpiBot } from "./npiBot";
import { loadNpiConfig, NpiBotConfig } from "./npiConfig";
import { Payroll2962Scenarios } from "./npiScenarios";
import { ensureNpiOutputDir, screenshot } from "./npiUtils";

async function buildDriver(config: NpiBotConfig): Promise<WebDriver> {
  const browser = config.browser === "edge" ? Browser.EDGE : config.browser;
  const builder = new Builder().forBrowser(browser);
  if (config.browser === "chrome") {
    const options = new chrome.Options();
    options.addArguments("--window-size=1600,1100", "--disable-notifications", "--disable-popup-blocking", "--lang=es-UY");
    options.excludeSwitches("enable-logging");
    if (config.headless) options.addArguments("--headless=new", "--disable-gpu");
    builder.setChromeOptions(options);
  } else if (config.browser === "edge") {
    const options = new edge.Options();
    options.addArguments("--window-size=1600,1100", "--disable-notifications", "--disable-popup-blocking", "--lang=es-UY");
    options.excludeSwitches("enable-logging");
    if (config.headless) options.addArguments("--headless=new", "--disable-gpu");
    builder.setEdgeOptions(options);
  } else {
    const options = new firefox.Options().windowSize({ width: 1600, height: 1100 });
    if (config.headless) options.addArguments("-headless");
    builder.setFirefoxOptions(options);
  }
  const logs = new logging.Preferences();
  logs.setLevel(logging.Type.BROWSER, logging.Level.ALL);
  builder.setLoggingPrefs(logs);
  const driver = await builder.build();
  await driver.manage().setTimeouts({ implicit: 0, pageLoad: config.pageTimeoutMs, script: config.timeoutMs });
  return driver;
}

async function main(): Promise<void> {
  const config = loadNpiConfig();
  const outputDir = await ensureNpiOutputDir(config.outputDir);
  const driver = await buildDriver(config);
  try {
    const bot = new NpiBot(driver, config);
    console.log("[1/3] Iniciando sesión en RANDY QA...");
    await bot.login();
    console.log("[2/3] Abriendo Modificación Masiva NPI...");
    await bot.openMassNpiModification();
    console.log("[3/3] Ejecutando escenarios PAYROLL-2962...");
    const results = await new Payroll2962Scenarios(driver, config).run();
    const report = {
      ticket: "PAYROLL-2962",
      generatedAt: new Date().toISOString(),
      environment: new URL(config.baseUrl).host,
      allowWrite: config.allowWrite,
      results
    };
    const reportPath = path.join(outputDir, "payroll-2962-report.json");
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.table(results.map((result) => ({
      escenario: result.name,
      estado: result.status,
      segundos: (result.durationMs / 1000).toFixed(1),
      detalle: result.detail?.split("\n")[0] ?? ""
    })));
    console.log(`Reporte: ${reportPath}`);
    if (results.some((result) => result.status === "FAILED")) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    try {
      console.error(`Captura: ${await screenshot(driver, config.outputDir, `${Date.now()}-fatal-error.png`)}`);
    } catch {
      // Preservar el error original.
    }
    process.exitCode = 1;
  } finally {
    if (!config.keepOpen) await driver.quit();
  }
}

void main();
