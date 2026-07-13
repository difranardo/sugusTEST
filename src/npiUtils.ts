import * as fs from "node:fs/promises";
import * as path from "node:path";
import { By, until, WebDriver, WebElement } from "selenium-webdriver";

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitVisible(driver: WebDriver, locator: By, timeoutMs: number): Promise<WebElement> {
  const element = await driver.wait(until.elementLocated(locator), timeoutMs);
  await driver.wait(until.elementIsVisible(element), timeoutMs);
  return element;
}

export async function waitEnabled(driver: WebDriver, locator: By, timeoutMs: number): Promise<WebElement> {
  const element = await waitVisible(driver, locator, timeoutMs);
  await driver.wait(until.elementIsEnabled(element), timeoutMs);
  return element;
}

export async function clickWithJsFallback(driver: WebDriver, element: WebElement): Promise<void> {
  try {
    await element.click();
  } catch {
    await driver.executeScript("arguments[0].click();", element);
  }
}

export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseLocalizedDecimal(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, "");
  if (!cleaned) return Number.NaN;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) normalized = cleaned.replace(/,/g, "");
  else if (lastComma >= 0) normalized = cleaned.replace(",", ".");
  return Number(normalized);
}

export async function ensureNpiOutputDir(outputDir: string): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  return outputDir;
}

export async function screenshot(driver: WebDriver, outputDir: string, filename: string): Promise<string> {
  await ensureNpiOutputDir(outputDir);
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const fullPath = path.join(outputDir, safeName);
  await fs.writeFile(fullPath, await driver.takeScreenshot(), "base64");
  return fullPath;
}
