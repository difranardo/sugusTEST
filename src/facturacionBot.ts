import * as fs from "node:fs";
import * as path from "node:path";
import { Browser, Builder, By, Key, WebDriver, WebElement } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";
import * as edge from "selenium-webdriver/edge";
import * as firefox from "selenium-webdriver/firefox";
import { AppConfig } from "./types";
import {
  FacturacionExpectedDocument,
  FacturacionGridRow,
  FacturacionValidationResult
} from "./facturacionTypes";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FacturacionBot {
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
      this.config.facturacionMenuTimeoutMs,
      "home despues del login"
    );
  }

  async openFacturacionPage(): Promise<void> {
    try {
      try {
        this.log(`Pausa inicial para que cargue el home: ${this.msToSeconds(this.config.facturacionMenuPauseMs)}s.`);
        await sleep(this.config.facturacionMenuPauseMs);
        this.log("Abriendo menu lateral de facturacion...");
        await this.openMenuIfNeeded(this.config.facturacionMenuTimeoutMs);

        this.log("Click en Facturacion.");
        await this.expandMenuByCode("Facturacion", this.config.facturacionMenuTimeoutMs);
        await sleep(1000);

        this.log("Click en Facturas / NC / ND.");
        await this.clickMenuByText("Facturas / NC / ND", this.config.facturacionMenuTimeoutMs);
        this.log(
          `Click enviado. Espero Facturas / NC / ND hasta ${this.msToSeconds(
            this.config.facturacionPageTimeoutMs
          )}s.`
        );
      } catch (error) {
        if (!this.config.facturacionUrl) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.log(`No pude abrir por menu (${message}). Entro por URL directa de facturacion.`);
        await this.requireDriver().get(this.config.facturacionUrl);
      }

      await this.waitFacturacionPageLoaded(this.config.facturacionAfterClickPauseMs);
      this.log("Pantalla Facturas / NC / ND cargada.");
    } catch (error) {
      const diagnostic = await this.saveDiagnostic("open-facturacion-page");
      const currentUrl = await this.safeCurrentUrl();
      const title = await this.safeTitle();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}. URL actual: ${currentUrl}. Titulo: ${title}. Diagnostico guardado en ${diagnostic}`
      );
    }
  }

  async validateDocument(expected: FacturacionExpectedDocument): Promise<FacturacionValidationResult> {
    const rows = await this.searchDocument(expected);
    const matches = rows.filter((row) => this.rowMatchesExpected(row, expected));

    if (matches.length === 1) {
      return {
        expected,
        status: "MATCH",
        matched: true,
        reason: "Comprobante encontrado.",
        foundCount: rows.length,
        found: matches[0],
        rows
      };
    }

    if (matches.length > 1) {
      return {
        expected,
        status: "MULTIPLE_MATCHES",
        matched: false,
        reason: `La busqueda devolvio ${matches.length} filas para el mismo comprobante.`,
        foundCount: matches.length,
        found: matches[0],
        rows
      };
    }

    return {
      expected,
      status: "NOT_FOUND",
      matched: false,
      reason: rows.length > 0 ? "La grilla no devolvio el numero esperado." : "No aparecio en la grilla.",
      foundCount: rows.length,
      found: rows[0],
      rows
    };
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

  private async searchDocument(expected: FacturacionExpectedDocument): Promise<FacturacionGridRow[]> {
    await this.ensureFacturacionPage();
    const previousGridSignature = await this.gridSignature();
    await this.prepareStableFilters();
    await this.setSelectById("vE_FACTIPDOC", expected.documentType, false);
    await this.setInputById("vE_FACTIP", expected.typeLetter || this.config.facturacionTipo, false);
    await this.setInputById("vE_FACNRO", expected.number);
    await this.submitSearch("vE_FACNRO");
    await this.waitForGridFiltered(expected, previousGridSignature);
    return this.readGridRows();
  }

  private async ensureFacturacionPage(): Promise<void> {
    if (await this.isFacturacionListPage()) {
      return;
    }

    this.log("La pagina actual no es la lista de Facturas / NC / ND; vuelvo a abrirla.");
    if (this.config.facturacionUrl) {
      await this.requireDriver().get(this.config.facturacionUrl);
      await this.waitFacturacionPageLoaded(0);
      return;
    }

    await this.openFacturacionPage();
  }

  private async prepareStableFilters(): Promise<void> {
    await this.setInputIfPresent("vE_CFAFECDES", this.config.facturacionFechaDesde, false);
    await this.setInputIfPresent("vE_CFAFECHAS", "", false);
    await this.setInputIfPresent("vE_EMPCODPOS", "0", false);
    await this.setSelectIfPresent("vE_ESTADOCMP", " ", false);
    await this.setSelectIfPresent("vE_MONID", "0", false);
  }

  private async waitFacturacionPageLoaded(initialPauseMs: number): Promise<void> {
    if (initialPauseMs > 0) {
      await sleep(initialPauseMs);
    }

    await this.waitForReady(this.config.facturacionPageTimeoutMs);
    await this.waitForDisplayedWithProgress(
      By.id("vE_FACTIPDOC"),
      this.config.facturacionPageTimeoutMs,
      "Facturas / NC / ND"
    );
    await this.waitForFacturacionListPage(this.config.facturacionPageTimeoutMs);
  }

  private async openMenuIfNeeded(timeoutMs = this.config.timeoutMs): Promise<void> {
    const locator = this.menuCodeLocator("Facturacion");
    if (await this.isDisplayed(locator)) {
      return;
    }

    await this.click(By.id("MENUTOGGLE_MPAGE"), 8000);
    await sleep(this.config.facturacionMenuPauseMs);
    await this.waitForDisplayedWithProgress(locator, timeoutMs, "menu Facturacion");
  }

  private async expandMenuByCode(code: string, timeoutMs: number): Promise<void> {
    const element = await this.waitForElementPresent(this.menuCodeLocator(code), timeoutMs);
    const expanded = await this.safeAttribute(element, "aria-expanded");
    if (expanded === "true") {
      return;
    }

    await this.clickElementEvenIfHidden(element);
    await this.waitForReady(timeoutMs);
    await sleep(1000);
    this.log(`Menu ${code} expandido.`);
  }

  private async clickMenuByText(text: string, timeoutMs: number): Promise<void> {
    const element = await this.waitForMenuText(text, timeoutMs);
    await this.clickElementEvenIfHidden(element);
    await this.waitForReady(timeoutMs);
  }

  private menuCodeLocator(code: string): By {
    return By.css(`a[data-k2btcode="${this.cssAttributeValue(code)}"]`);
  }

  private cssAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private async waitForMenuText(text: string, timeoutMs: number): Promise<WebElement> {
    const endAt = Date.now() + timeoutMs;

    while (Date.now() < endAt) {
      const element = (await this.requireDriver().executeScript(
        `
        const normalize = (value) => (value || '')
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        const expected = normalize(arguments[0]);
        const candidates = Array.from(document.querySelectorAll('a, span.sidebar-nav-item, .sidebar-nav-item-content'));
        const found = candidates.find((element) => normalize(element.textContent) === expected);
        return found ? (found.closest('a,button,[role="button"],[data-gx-evt]') || found) : null;
        `,
        text
      )) as WebElement | null;

      if (element) {
        return element;
      }

      await sleep(500);
    }

    throw new Error(`No se encontro opcion de menu: ${text}`);
  }

  private async waitForFacturacionListPage(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    const endAt = startedAt + timeoutMs;
    let nextProgressAt = startedAt + 10000;

    while (Date.now() < endAt) {
      if (await this.isFacturacionListPage()) {
        return;
      }

      const now = Date.now();
      if (now >= nextProgressAt) {
        const elapsed = this.msToSeconds(now - startedAt);
        const total = this.msToSeconds(timeoutMs);
        this.log(`Sigo esperando la grilla de Facturas / NC / ND... ${elapsed}s/${total}s`);
        nextProgressAt = now + 10000;
      }

      await sleep(500);
    }

    throw new Error("No se pudo confirmar la grilla de Facturas / NC / ND.");
  }

  private async isFacturacionListPage(): Promise<boolean> {
    return (await this.requireDriver().executeScript(`
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const normalize = (value) => clean(value)
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const title = normalize((document.querySelector('#TITLE') || document.querySelector('h1'))?.textContent || '');
      const typeSelect = document.querySelector('#vE_FACTIPDOC');
      const typeOptions = Array.from(typeSelect?.options || []).map((option) => option.value);
      const table = document.querySelector('#Gridelement1ContainerTbl');
      const headers = Array.from(table?.querySelectorAll('thead th') || []).map((header) => normalize(header.textContent));
      return Boolean(
        title.includes('facturas nc nd') &&
        typeOptions.includes('FC') &&
        typeOptions.includes('NC') &&
        table &&
        headers.includes('comprobante') &&
        headers.includes('numero')
      );
    `)) as boolean;
  }

  private async submitSearch(inputId: string): Promise<void> {
    const directButtons = await this.requireDriver().findElements(By.id("SEARCHBUTTON"));
    if (directButtons.length > 0) {
      await this.clickElementEvenIfHidden(directButtons[0]);
      await this.waitForReady();
      await sleep(this.config.waitMs);
      return;
    }

    const searchButton = await this.findSearchButton();
    if (searchButton) {
      await this.clickElementEvenIfHidden(searchButton);
    } else {
      const input = await this.waitForElementPresent(By.id(inputId), this.config.timeoutMs);
      try {
        await input.sendKeys(Key.ENTER);
      } catch {
        await this.requireDriver().executeScript(
          "arguments[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));",
          input
        );
      }
    }

    await this.waitForReady();
    await sleep(this.config.waitMs);
  }

  private async findSearchButton(): Promise<WebElement | null> {
    return (await this.requireDriver().executeScript(`
      const normalize = (value) => (value || '')
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      };
      const textFor = (element) => [
        element.textContent,
        element.getAttribute('title'),
        element.getAttribute('aria-label'),
        element.getAttribute('alt'),
        element.getAttribute('value'),
        element.getAttribute('data-event'),
        element.id,
        element.name
      ].filter(Boolean).join(' ');
      const candidates = Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],a,img,[data-event]'));
      const found = candidates.find((element) => {
        const text = normalize(textFor(element));
        return visible(element) && /buscar|search/.test(text);
      });
      return found ? (found.closest('a,button,input,[role="button"],[data-gx-evt]') || found) : null;
    `)) as WebElement | null;
  }

  private async waitForGridFiltered(
    expected: FacturacionExpectedDocument,
    previousGridSignature: string
  ): Promise<void> {
    const endAt = Date.now() + Math.max(this.config.waitMs * 6, 5000);
    let lastGridSignature = previousGridSignature;
    let emptySince = 0;

    while (Date.now() < endAt) {
      const rows = await this.readGridRows();
      if (rows.some((row) => this.rowMatchesExpected(row, expected))) {
        await sleep(this.config.waitMs);
        return;
      }

      const currentSignature = await this.gridSignature();
      if (rows.length === 0) {
        emptySince = emptySince || Date.now();
        if (Date.now() - emptySince >= Math.max(this.config.waitMs, 1000)) {
          return;
        }
        await sleep(500);
        continue;
      }

      emptySince = 0;
      if (currentSignature && currentSignature !== previousGridSignature && currentSignature === lastGridSignature) {
        return;
      }
      lastGridSignature = currentSignature;
      await sleep(500);
    }
  }

  private async gridSignature(): Promise<string> {
    return (await this.requireDriver().executeScript(`
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const table = document.querySelector('#Gridelement1ContainerTbl');
      if (!table) return '';
      const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 25);
      return rows.map((row) => clean(row.textContent)).join('\\n');
    `)) as string;
  }

  private async readGridRows(): Promise<FacturacionGridRow[]> {
    return (await this.requireDriver().executeScript(`
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const normalize = (value) => clean(value)
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const normalizeNumber = (value) => {
        const digits = String(value || '').replace(/\\D/g, '').replace(/^0+/, '');
        return digits || (String(value || '').match(/0+/) ? '0' : '');
      };
      const colIndex = (node, fallback) => {
        const rawValue = node.getAttribute('data-colindex');
        if (rawValue === null || rawValue === '') return fallback;
        const value = Number(rawValue);
        return Number.isFinite(value) ? value : fallback;
      };
      const firstIndex = (headers, tests, fallback) => {
        const found = headers.find(({ header }) => tests.some((test) => test(header)));
        return found ? found.index : fallback;
      };
      const cellText = (cellsByColumn, index) => {
        const cell = cellsByColumn.get(index);
        return cell ? clean(cell.textContent) : '';
      };
      const table = document.querySelector('#Gridelement1ContainerTbl') ||
        Array.from(document.querySelectorAll('table')).find((candidate) => normalize(candidate.textContent).includes('comprobante'));
      if (!table) {
        return [];
      }

      const headers = Array.from(table.querySelectorAll('thead th'))
        .map((header, index) => ({ header: normalize(header.textContent), index: colIndex(header, index) }))
        .filter(({ header }) => header);

      const typeIndex = firstIndex(headers, [(header) => header === 'tipo'], 11);
      const typeLetterIndex = firstIndex(headers, [(header) => header === 't'], 12);
      const branchIndex = firstIndex(headers, [(header) => header === 'boca'], 13);
      const numberIndex = firstIndex(headers, [(header) => header === 'numero'], 14);
      const comprobanteIndex = firstIndex(headers, [(header) => header === 'comprobante'], 15);
      const dateIndex = firstIndex(headers, [(header) => header === 'fecha'], 16);
      const statusIndex = firstIndex(headers, [(header) => header === 'estado'], 17);
      const clientIndex = firstIndex(headers, [(header) => header === 'empresa usuaria'], 18);
      const grossIndex = firstIndex(headers, [(header) => header === 'bruto'], 19);
      const subTotalIndex = firstIndex(headers, [(header) => header === 'sub total'], 20);
      const ivaIndex = firstIndex(headers, [(header) => header === 'i v a' || header === 'iva'], 21);
      const totalIndex = firstIndex(headers, [(header) => header === 'total'], 22);
      const currencyIndex = firstIndex(headers, [(header) => header === 'moneda'], 23);
      const authorizationDateIndex = firstIndex(headers, [(header) => header.includes('fec autoriz')], 24);
      const caeIndex = firstIndex(headers, [(header) => header === 'cae'], 29);

      return Array.from(table.querySelectorAll('tbody tr')).map((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const cellsByColumn = new Map(cells.map((cell, index) => [colIndex(cell, index), cell]));
        const rawCells = cells.map((cell) => clean(cell.textContent));
        const comprobante = cellText(cellsByColumn, comprobanteIndex);
        const explicitNumber = cellText(cellsByColumn, numberIndex);
        const number = normalizeNumber(explicitNumber) || normalizeNumber(comprobante);
        return {
          documentType: cellText(cellsByColumn, typeIndex),
          documentTypeLabel: cellText(cellsByColumn, typeIndex),
          typeLetter: cellText(cellsByColumn, typeLetterIndex),
          branch: cellText(cellsByColumn, branchIndex),
          number,
          comprobante,
          date: cellText(cellsByColumn, dateIndex),
          status: cellText(cellsByColumn, statusIndex),
          clientName: cellText(cellsByColumn, clientIndex),
          gross: cellText(cellsByColumn, grossIndex),
          subTotal: cellText(cellsByColumn, subTotalIndex),
          iva: cellText(cellsByColumn, ivaIndex),
          total: cellText(cellsByColumn, totalIndex),
          currency: cellText(cellsByColumn, currencyIndex),
          authorizationDate: cellText(cellsByColumn, authorizationDateIndex),
          cae: cellText(cellsByColumn, caeIndex),
          rawCells,
          rawText: clean(row.textContent)
        };
      }).filter((row) => row.rawText && (row.number || row.comprobante || row.clientName));
    `)) as FacturacionGridRow[];
  }

  private rowMatchesExpected(row: FacturacionGridRow, expected: FacturacionExpectedDocument): boolean {
    return this.normalizeNumber(row.number || row.comprobante) === this.normalizeNumber(expected.number);
  }

  private normalizeNumber(value: string): string {
    const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
    return digits || (String(value || "").match(/0+/) ? "0" : "");
  }

  private async typeById(id: string, value: string): Promise<void> {
    const element = await this.waitForDisplayed(By.id(id), this.config.timeoutMs);
    await this.setInputValue(element, value);
  }

  private async setInputById(id: string, value: string, triggerEvents = true): Promise<void> {
    const element = await this.waitForElementPresent(By.id(id), this.config.timeoutMs);
    await this.setInputValue(element, value, triggerEvents);
  }

  private async setInputIfPresent(id: string, value: string, triggerEvents = true): Promise<void> {
    const elements = await this.requireDriver().findElements(By.id(id));
    if (elements.length === 0) {
      return;
    }

    await this.setInputValue(elements[0], value, triggerEvents);
  }

  private async setSelectById(id: string, value: string, triggerEvents = true): Promise<void> {
    const element = await this.waitForElementPresent(By.id(id), this.config.timeoutMs);
    const changed = await this.setSelectValue(element, value, triggerEvents);
    if (!changed) {
      throw new Error(`No existe la opcion ${value} en el select ${id}.`);
    }
  }

  private async setSelectIfPresent(id: string, value: string, triggerEvents = true): Promise<void> {
    const elements = await this.requireDriver().findElements(By.id(id));
    if (elements.length === 0) {
      return;
    }

    await this.setSelectValue(elements[0], value, triggerEvents);
  }

  private async setSelectValue(element: WebElement, value: string, triggerEvents = true): Promise<boolean> {
    return (await this.requireDriver().executeScript(
      `
      const select = arguments[0];
      const value = arguments[1];
      const triggerEvents = arguments[2];
      const option = Array.from(select.options || []).find((item) => item.value === value);
      if (!option) return false;
      select.value = value;
      if (triggerEvents) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.blur();
      }
      return true;
      `,
      element,
      value,
      triggerEvents
    )) as boolean;
  }

  private async setInputValue(element: WebElement, value: string, triggerEvents = true): Promise<void> {
    const driver = this.requireDriver();
    await driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });", element);

    if (!triggerEvents) {
      await driver.executeScript("arguments[0].value = arguments[1];", element, value);
      return;
    }

    try {
      await driver.executeScript("arguments[0].value = '';", element);
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
