import * as fs from "node:fs";
import * as path from "node:path";
import { Browser, Builder, By, Key, WebDriver, WebElement } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";
import * as edge from "selenium-webdriver/edge";
import * as firefox from "selenium-webdriver/firefox";
import { AppConfig } from "./types";
import { LiquidacionDetailConceptRow, LiquidacionGridRow } from "./liquidacionesTypes";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LiquidacionesBot {
  private driver?: WebDriver;

  constructor(private readonly config: AppConfig) {}

  async start(): Promise<void> {
    this.driver = await this.createDriver();
  }

  async stop(): Promise<void> {
    if (this.driver && !this.config.keepOpen) {
      await this.driver.quit();
    }
  }

  async login(): Promise<void> {
    const driver = this.requireDriver();
    await driver.get(this.config.url);

    await this.typeById("vUSERNAME", this.config.username);
    await this.typeById("vUSERPASSWORD", this.config.password);
    await this.click(By.id("LOGIN"));

    await this.waitForReady();
    await this.waitForDisplayedWithProgress(
      By.id("MENUTOGGLE_MPAGE"),
      this.config.liquidacionesMenuTimeoutMs,
      "home despues del login"
    );
  }

  async openLiquidacionesPage(): Promise<void> {
    try {
      try {
        this.log(`Pausa inicial para que cargue el home: ${this.msToSeconds(this.config.liquidacionesMenuPauseMs)}s.`);
        await sleep(this.config.liquidacionesMenuPauseMs);
        this.log("Abriendo menu lateral de liquidaciones...");
        await this.openMenuIfNeeded("Liquidaciones", this.config.liquidacionesMenuTimeoutMs);

        this.log("Click en Liquidaciones.");
        await this.expandMenuByCode("Liquidaciones", "Liquidaciones", this.config.liquidacionesMenuTimeoutMs);
        await sleep(1000);

        this.log("Click en Consulta de Liquidaciones.");
        await this.clickMenuLinkByCode(
          "Sugus.WWSGS_Liquidacion",
          "Consulta de Liquidaciones",
          this.config.liquidacionesMenuTimeoutMs
        );
        this.log(
          `Click enviado. Espero Consulta de Liquidaciones hasta ${this.msToSeconds(
            this.config.liquidacionesPageTimeoutMs
          )}s.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`No pude abrir por menu (${message}). Entro directo a Consulta de Liquidaciones.`);
        await this.goToLiquidacionesUrl();
      }

      await this.waitLiquidacionesPageLoaded();
      this.log("Pantalla Consulta de Liquidaciones cargada.");
    } catch (error) {
      const diagnostic = await this.saveDiagnostic("open-liquidaciones-page");
      const currentUrl = await this.safeCurrentUrl();
      const title = await this.safeTitle();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}. URL actual: ${currentUrl}. Titulo: ${title}. Diagnostico guardado en ${diagnostic}`
      );
    }
  }

  async searchLiquidacion(externalNumber: string, expectedRows = 0): Promise<LiquidacionGridRow[]> {
    await this.ensureLiquidacionesPage();
    await this.setInputById("vLIQRECLEG", "0");
    await this.setInputById("vLIQPERLIQ", "0");
    await this.setInputById("vLIQCORLIQ_FILTER", externalNumber);
    await this.submitSearch("vLIQCORLIQ_FILTER");
    await this.waitForGridFiltered(externalNumber);
    return this.readAllLiquidacionGridRows(externalNumber, expectedRows);
  }

  async readDetailConcepts(row: LiquidacionGridRow, expectedRows = 0): Promise<LiquidacionDetailConceptRow[]> {
    const href = row.detailHref || row.displayHref;
    if (!href) {
      throw new Error(`No se encontro link de detalle para recurso ${row.employeeId}.`);
    }

    await this.requireDriver().get(href);
    await this.waitForReady(this.config.timeoutMs);
    await sleep(this.config.waitMs);
    return this.readAllDetailConceptRows(expectedRows);
  }

  async saveDiagnostic(name: string): Promise<string> {
    const driver = this.requireDriver();
    const diagnosticsDir = path.join(this.config.outputDir, "diagnostics");
    fs.mkdirSync(diagnosticsDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
    const basePath = path.join(diagnosticsDir, `${stamp}-${name}`);
    const screenshotPath = `${basePath}.png`;
    const htmlPath = `${basePath}.html`;

    try {
      fs.writeFileSync(screenshotPath, await driver.takeScreenshot(), "base64");
    } catch {
      // Best-effort diagnostics.
    }

    try {
      fs.writeFileSync(htmlPath, await driver.getPageSource(), "utf8");
    } catch {
      // Best-effort diagnostics.
    }

    return `${screenshotPath} / ${htmlPath}`;
  }

  private async createDriver(): Promise<WebDriver> {
    const seleniumBrowser = this.config.browser === "edge" ? Browser.EDGE : this.config.browser;
    const builder = new Builder().forBrowser(seleniumBrowser);

    if (this.config.browser === "chrome") {
      const options = new chrome.Options();
      options.addArguments("--window-size=1440,1000", "--log-level=3", "--disable-logging");
      options.excludeSwitches("enable-logging");
      if (this.config.headless) {
        options.addArguments("--headless=new", "--disable-gpu");
      }
      builder.setChromeOptions(options);
    }

    if (this.config.browser === "edge") {
      const options = new edge.Options();
      options.addArguments("--window-size=1440,1000", "--log-level=3", "--disable-logging");
      options.excludeSwitches("enable-logging");
      if (this.config.headless) {
        options.addArguments("--headless=new", "--disable-gpu");
      }
      builder.setEdgeOptions(options);
    }

    if (this.config.browser === "firefox") {
      const options = new firefox.Options().windowSize({ width: 1440, height: 1000 });
      if (this.config.headless) {
        options.addArguments("-headless");
      }
      builder.setFirefoxOptions(options);
    }

    return builder.build();
  }

  private async ensureLiquidacionesPage(): Promise<void> {
    const url = await this.safeCurrentUrl();
    if (url.toLowerCase().includes("sugus.wwsgs_liquidacion.aspx")) {
      await this.waitForElementPresent(By.id("vLIQCORLIQ_FILTER"), this.config.timeoutMs);
      return;
    }

    await this.goToLiquidacionesUrl();
    await this.waitLiquidacionesPageLoaded();
  }

  private async goToLiquidacionesUrl(): Promise<void> {
    const liquidacionesUrl = new URL("sugus.wwsgs_liquidacion.aspx", this.config.url).toString();
    await this.requireDriver().get(liquidacionesUrl);
  }

  private async waitLiquidacionesPageLoaded(): Promise<void> {
    await sleep(this.config.liquidacionesAfterClickPauseMs);
    await this.waitForReady(this.config.liquidacionesPageTimeoutMs);
    await this.waitForDisplayedWithProgress(
      By.id("vLIQCORLIQ_FILTER"),
      this.config.liquidacionesPageTimeoutMs,
      "Consulta de Liquidaciones"
    );
    await this.waitForElementPresent(By.id("GridContainerTbl"), this.config.timeoutMs);
  }

  private async openMenuIfNeeded(menuText: string, timeoutMs = this.config.timeoutMs): Promise<void> {
    const locator = this.menuTextLocator(menuText);
    if (await this.isDisplayed(locator)) {
      return;
    }

    await this.click(By.id("MENUTOGGLE_MPAGE"), 8000);
    await sleep(this.config.liquidacionesMenuPauseMs);
    await this.waitForDisplayedWithProgress(locator, timeoutMs, `menu ${menuText}`);
  }

  private async clickMenuItem(text: string, timeoutMs = this.config.timeoutMs): Promise<void> {
    const element = await this.waitForDisplayedWithProgress(this.menuTextLocator(text), timeoutMs, `opcion ${text}`);
    const clickable = await this.closestClickable(element);
    await this.clickElement(clickable);
    await this.waitForReady(timeoutMs);
  }

  private async expandMenuByCode(code: string, label: string, timeoutMs: number): Promise<void> {
    const element = await this.waitForElementPresent(this.menuCodeLocator(code), timeoutMs);
    const expanded = await this.safeAttribute(element, "aria-expanded");
    if (expanded === "true") {
      return;
    }

    await this.clickElementEvenIfHidden(element);
    await this.waitForReady(timeoutMs);
    await sleep(1000);
    this.log(`Menu ${label} expandido.`);
  }

  private async clickMenuLinkByCode(code: string, label: string, timeoutMs: number): Promise<void> {
    const element = await this.waitForElementPresent(this.menuCodeLocator(code), timeoutMs);
    await this.clickElementEvenIfHidden(element);
    await this.waitForReady(timeoutMs);
    this.log(`Click enviado en ${label}.`);
  }

  private menuTextLocator(text: string): By {
    return By.xpath(`//span[normalize-space(.)=${this.xpathLiteral(text)}] | //a[normalize-space(.)=${this.xpathLiteral(text)}]`);
  }

  private menuCodeLocator(code: string): By {
    return By.css(`a[data-k2btcode="${this.cssAttributeValue(code)}"]`);
  }

  private cssAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private async closestClickable(element: WebElement): Promise<WebElement> {
    return (await this.requireDriver().executeScript(
      "return arguments[0].closest('a,button,input,[role=\"button\"],[data-gx-evt]') || arguments[0];",
      element
    )) as WebElement;
  }

  private xpathLiteral(text: string): string {
    if (!text.includes("'")) {
      return `'${text}'`;
    }

    if (!text.includes('"')) {
      return `"${text}"`;
    }

    return `concat('${text.replace(/'/g, "',\"'\",'")}')`;
  }

  private async submitSearch(inputId: string): Promise<void> {
    const searchButton = await this.requireDriver().findElements(By.id("SEARCHBUTTON"));
    if (searchButton.length > 0) {
      await this.clickElement(searchButton[0]);
    } else {
      const input = await this.waitForElementPresent(By.id(inputId), this.config.timeoutMs);
      try {
        await input.sendKeys(Key.ENTER);
      } catch {
        await this.requireDriver().executeScript("arguments[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));", input);
      }
    }

    await this.waitForReady();
    await sleep(this.config.waitMs);
  }

  private async waitForGridFiltered(externalNumber: string): Promise<void> {
    const endAt = Date.now() + this.config.timeoutMs;

    while (Date.now() < endAt) {
      const rows = await this.readLiquidacionGridRows();
      if (rows.length === 0 || rows.every((row) => !row.externalNumber || row.externalNumber === externalNumber)) {
        return;
      }
      await sleep(500);
    }

    throw new Error(`La grilla no quedo filtrada por liquidacion gente ${externalNumber}.`);
  }

  private async readAllLiquidacionGridRows(externalNumber: string, expectedRows: number): Promise<LiquidacionGridRow[]> {
    const allRows: LiquidacionGridRow[] = [];
    const seen = new Set<string>();
    const maxPages = 50;

    for (let page = 0; page < maxPages; page += 1) {
      const rows = (await this.readLiquidacionGridRows()).filter(
        (row) => !row.externalNumber || row.externalNumber === externalNumber
      );

      for (const row of rows) {
        const key = `${row.internalNumber}|${row.employeeId}|${row.employeeName}`;
        if (!seen.has(key)) {
          seen.add(key);
          allRows.push(row);
        }
      }

      if (expectedRows > 0 && allRows.length >= expectedRows) {
        break;
      }

      const clickedNext = await this.clickNextPageButton();
      if (!clickedNext) {
        break;
      }
      await sleep(this.config.waitMs);
      await this.waitForReady();
    }

    return allRows;
  }

  private async readAllDetailConceptRows(expectedRows: number): Promise<LiquidacionDetailConceptRow[]> {
    const allRows: LiquidacionDetailConceptRow[] = [];
    const seen = new Set<string>();
    const maxPages = 50;

    for (let page = 0; page < maxPages; page += 1) {
      const rows = await this.readDetailConceptRows();
      const pageOccurrences = new Map<string, number>();

      for (const row of rows) {
        const rawKey = row.rawCells.join("|");
        const occurrence = (pageOccurrences.get(rawKey) ?? 0) + 1;
        pageOccurrences.set(rawKey, occurrence);
        const key = `${rawKey}#${occurrence}`;
        if (!seen.has(key)) {
          seen.add(key);
          allRows.push(row);
        }
      }

      if (expectedRows > 0 && allRows.length >= expectedRows) {
        break;
      }

      const clickedNext = await this.clickNextPageButton();
      if (!clickedNext) {
        break;
      }
      await sleep(this.config.waitMs);
      await this.waitForReady();
    }

    return allRows;
  }

  private async readLiquidacionGridRows(): Promise<LiquidacionGridRow[]> {
    return (await this.requireDriver().executeScript(`
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const pick = (row, selector) => {
        const node = row.querySelector(selector);
        return normalize(node ? node.textContent : '');
      };
      const hrefFor = (row, selector) => {
        const node = row.querySelector(selector);
        const link = node ? node.closest('a') : null;
        return link ? link.href : '';
      };
      return Array.from(document.querySelectorAll('tr[id^="GridContainerRow_"]')).map((row) => {
        const suffix = (row.id.match(/_(\\d+)$/) || [,''])[1];
        return {
          suffix,
          companyCode: pick(row, '[id^="span_CIACOD_"]'),
          externalNumber: pick(row, '[id^="span_LIQCORLIQ_"]'),
          internalNumber: pick(row, '[id^="span_LIQNRO_"]'),
          typeCode: pick(row, '[id^="span_TLICOD_"]'),
          typeDescription: pick(row, '[id^="span_vTLIDES_"]'),
          period: pick(row, '[id^="span_LIQPERLIQ_"]'),
          companyName: pick(row, '[id^="span_vEMPRAZ_"]'),
          employeeName: pick(row, '[id^="span_vRECAPENOM_"]'),
          employeeId: pick(row, '[id^="span_LIQRECLEG_"]'),
          status: pick(row, '[id^="span_LIQEST_"]'),
          receiptNumber: pick(row, '[id^="span_LIQRCSNRO_"]'),
          receiptPrinted: pick(row, '[id^="span_LIQRCSMAREMI_"]'),
          invoiceNumber: pick(row, '[id^="span_LIQFACNRO_"]'),
          liquidationDate: pick(row, '[id^="span_LIQFEC_"]'),
          detailHref: hrefFor(row, '[id^="vDETALLE_"]'),
          displayHref: hrefFor(row, '[id^="vDISPLAY_"]'),
          rawText: normalize(row.textContent)
        };
      }).filter((row) => row.internalNumber || row.externalNumber || row.employeeId || row.employeeName);
    `)) as LiquidacionGridRow[];
  }

  private async readDetailConceptRows(): Promise<LiquidacionDetailConceptRow[]> {
    return (await this.requireDriver().executeScript(`
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const normalize = (value) => clean(value)
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase();
      const colIndex = (node, fallback) => {
        const value = Number(node.getAttribute('data-colindex'));
        return Number.isFinite(value) ? value : fallback;
      };
      const cellText = (cellsByColumn, index) => {
        const cell = cellsByColumn.get(index);
        return cell ? clean(cell.textContent) : '';
      };
      const firstIndex = (headers, tests) => {
        const found = headers.find(({ header }) => tests.some((test) => test(header)));
        return found ? found.index : -1;
      };
      const allIndexes = (headers, tests) => headers
        .filter(({ header }) => tests.some((test) => test(header)))
        .map(({ index }) => index);

      const tables = Array.from(document.querySelectorAll('table'));
      const result = [];

      for (const table of tables) {
        const headerNodes = Array.from(table.querySelectorAll('thead th'));
        const headers = headerNodes
          .map((header, index) => ({ header: normalize(header.textContent), index: colIndex(header, index) }))
          .filter(({ header }) => header);
        const hasConcept = headers.some(({ header }) => header.includes('concepto'));
        const hasAmount = headers.some(({ header }) => header.includes('importe') || header.includes('cantidad') || header.includes('valor'));
        if (!hasConcept || !hasAmount) {
          continue;
        }

        const conceptIndexes = allIndexes(headers, [(header) => header.includes('concepto')]);
        const conceptIndex = conceptIndexes[0] ?? -1;
        const descriptionDirectIndex = firstIndex(headers, [(header) => header.includes('descripcion'), (header) => header === 'desc']);
        const descriptionIndex = descriptionDirectIndex >= 0 ? descriptionDirectIndex : (conceptIndexes[1] ?? -1);
        const quantityIndex = firstIndex(headers, [(header) => header.includes('cantidad'), (header) => header === 'cant']);
        const unitValueIndex = firstIndex(headers, [(header) => header.includes('unitario') || header.includes('valor')]);
        const amountIndex = firstIndex(headers, [
          (header) => header.includes('importe') && !header.includes('gravado') && !header.includes('jub')
        ]);
        const taxableIndex = firstIndex(headers, [(header) => header.includes('gravado') || header.includes('jub')]);
        const typeIndex = firstIndex(headers, [(header) => header.includes('tipo')]);
        const costCenterIndex = firstIndex(headers, [(header) => header.includes('centro') && header.includes('costo')]);

        const rows = Array.from(table.querySelectorAll('tbody tr')).filter((row) => row.querySelectorAll('td').length > 0);
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          const cellsByColumn = new Map(cells.map((cell, index) => [colIndex(cell, index), cell]));
          const rawCells = cells.map((cell) => clean(cell.textContent));
          const rawText = clean(row.textContent);
          if (!rawText) {
            continue;
          }

          result.push({
            conceptType: cellText(cellsByColumn, typeIndex),
            conceptCode: cellText(cellsByColumn, conceptIndex),
            conceptDescription: cellText(cellsByColumn, descriptionIndex),
            quantity: cellText(cellsByColumn, quantityIndex),
            unitValue: cellText(cellsByColumn, unitValueIndex),
            amount: cellText(cellsByColumn, amountIndex),
            costCenter: cellText(cellsByColumn, costCenterIndex),
            taxableAmount: cellText(cellsByColumn, taxableIndex),
            rawCells,
            rawText
          });
        }
      }

      return result;
    `)) as LiquidacionDetailConceptRow[];
  }

  private async clickNextPageButton(): Promise<boolean> {
    const next = (await this.requireDriver().executeScript(`
      const textFor = (element) => [
        element.textContent,
        element.getAttribute('title'),
        element.getAttribute('aria-label'),
        element.getAttribute('alt'),
        element.getAttribute('value'),
        element.id,
        element.name
      ].filter(Boolean).join(' ').toLowerCase();
      const disabled = (element) =>
        element.disabled ||
        element.classList.contains('disabled') ||
        element.classList.contains('gx-disabled') ||
        element.getAttribute('aria-disabled') === 'true';
      const candidates = Array.from(document.querySelectorAll('a,button,input,img')).filter((element) => {
        if (disabled(element)) return false;
        const text = textFor(element);
        if (/anterior|prev|previous|primero|first/.test(text)) return false;
        return /siguiente|next|proximo|proxima|ultimo|last|\\b>\\b|»|›/.test(text);
      });
      const element = candidates[0];
      return element ? (element.closest('a,button,input,[role="button"],[data-gx-evt]') || element) : null;
    `)) as WebElement | null;

    if (!next) {
      return false;
    }

    await this.clickElement(next);
    return true;
  }

  private async typeById(id: string, value: string): Promise<void> {
    const element = await this.waitForDisplayed(By.id(id), this.config.timeoutMs);
    await this.setInputValue(element, value);
  }

  private async setInputById(id: string, value: string): Promise<void> {
    const element = await this.waitForElementPresent(By.id(id), this.config.timeoutMs);
    await this.setInputValue(element, value);
  }

  private async setInputValue(element: WebElement, value: string): Promise<void> {
    const driver = this.requireDriver();
    await driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });", element);
    try {
      await element.clear();
      if (value) {
        await element.sendKeys(value);
      }
    } catch {
      await driver.executeScript("arguments[0].value = arguments[1];", element, value);
    }
    await driver.executeScript(
      "arguments[0].dispatchEvent(new Event('input', { bubbles: true })); arguments[0].dispatchEvent(new Event('change', { bubbles: true })); arguments[0].blur();",
      element
    );
  }

  private async click(by: By, timeoutMs = this.config.timeoutMs): Promise<void> {
    const element = await this.waitForDisplayed(by, timeoutMs);
    await this.clickElement(element);
  }

  private async clickElement(element: WebElement): Promise<void> {
    const driver = this.requireDriver();
    await driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });", element);
    try {
      await element.click();
    } catch {
      await driver.executeScript("arguments[0].click();", element);
    }
  }

  private async clickElementEvenIfHidden(element: WebElement): Promise<void> {
    if (await this.elementIsDisplayed(element)) {
      await this.clickElement(element);
      return;
    }

    await this.requireDriver().executeScript("arguments[0].click();", element);
  }

  private async waitForDisplayed(by: By, timeoutMs: number): Promise<WebElement> {
    const driver = this.requireDriver();
    const endAt = Date.now() + timeoutMs;

    while (Date.now() < endAt) {
      const elements = await driver.findElements(by);
      for (const element of elements) {
        if (await this.elementIsDisplayed(element)) {
          return element;
        }
      }
      await sleep(200);
    }

    throw new Error(`No se encontro elemento visible: ${by.toString()}`);
  }

  private async waitForElementPresent(by: By, timeoutMs: number): Promise<WebElement> {
    const driver = this.requireDriver();
    const endAt = Date.now() + timeoutMs;

    while (Date.now() < endAt) {
      const elements = await driver.findElements(by);
      if (elements.length > 0) {
        return elements[0];
      }
      await sleep(200);
    }

    throw new Error(`No se encontro elemento en DOM: ${by.toString()}`);
  }

  private async waitForDisplayedWithProgress(by: By, timeoutMs: number, label: string): Promise<WebElement> {
    const driver = this.requireDriver();
    const startedAt = Date.now();
    const endAt = startedAt + timeoutMs;
    let nextProgressAt = startedAt + 10000;

    while (Date.now() < endAt) {
      const elements = await driver.findElements(by);
      for (const element of elements) {
        if (await this.elementIsDisplayed(element)) {
          return element;
        }
      }

      const now = Date.now();
      if (now >= nextProgressAt) {
        const elapsed = this.msToSeconds(now - startedAt);
        const total = this.msToSeconds(timeoutMs);
        this.log(`Sigo esperando ${label}... ${elapsed}s/${total}s`);
        nextProgressAt = now + 10000;
      }

      await sleep(500);
    }

    throw new Error(`No se encontro elemento visible: ${by.toString()}`);
  }

  private async isDisplayed(by: By): Promise<boolean> {
    const elements = await this.requireDriver().findElements(by);
    for (const element of elements) {
      if (await this.elementIsDisplayed(element)) {
        return true;
      }
    }
    return false;
  }

  private async elementIsDisplayed(element: WebElement): Promise<boolean> {
    try {
      return await element.isDisplayed();
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs = this.config.timeoutMs): Promise<void> {
    const driver = this.requireDriver();
    await driver.wait(async () => {
      const readyState = await driver.executeScript("return document.readyState");
      return readyState === "complete" || readyState === "interactive";
    }, timeoutMs);
  }

  private async safeCurrentUrl(): Promise<string> {
    try {
      return await this.requireDriver().getCurrentUrl();
    } catch {
      return "(no disponible)";
    }
  }

  private async safeTitle(): Promise<string> {
    try {
      return await this.requireDriver().getTitle();
    } catch {
      return "(no disponible)";
    }
  }

  private async safeAttribute(element: WebElement, name: string): Promise<string> {
    try {
      return (await element.getAttribute(name)) ?? "";
    } catch {
      return "";
    }
  }

  private requireDriver(): WebDriver {
    if (!this.driver) {
      throw new Error("El driver no fue inicializado.");
    }
    return this.driver;
  }

  private log(message: string): void {
    console.log(`[Sugus] ${message}`);
  }

  private msToSeconds(ms: number): number {
    return Math.round(ms / 1000);
  }
}
