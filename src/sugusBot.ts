import * as fs from "node:fs";
import * as path from "node:path";
import { Browser, Builder, By, WebDriver, WebElement } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";
import * as edge from "selenium-webdriver/edge";
import * as firefox from "selenium-webdriver/firefox";
import { AppConfig, Candidate, SugusGridRow, ValidationResult } from "./types";
import { candidateDocumentMatches, candidateNameMatches } from "./matching";
import { normalizeDocument } from "./normalize";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SugusBot {
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
    await this.waitForDisplayed(By.id("MENUTOGGLE_MPAGE"), this.config.timeoutMs);
  }

  async openCandidatesPage(): Promise<void> {
    try {
      await this.openMenuIfNeeded();
      await this.clickMenuItem("Candidatos");
      await sleep(this.config.candidatesMenuPauseMs);
      await this.clickMenuItem("Trabajar con Candidatos", this.config.candidatesPageTimeoutMs);
      await sleep(this.config.candidatesAfterClickPauseMs);
      await this.waitForReady(this.config.candidatesPageTimeoutMs);
      await this.waitForDisplayed(By.id("vK2BTOOLSGENERICSEARCHFIELD"), this.config.candidatesPageTimeoutMs);
      await this.ensureAdvancedFiltersVisible();
    } catch (error) {
      const diagnostic = await this.saveDiagnostic("open-candidates-page");
      const currentUrl = await this.safeCurrentUrl();
      const title = await this.safeTitle();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}. URL actual: ${currentUrl}. Titulo: ${title}. Diagnostico guardado en ${diagnostic}`
      );
    }
  }

  async validateCandidate(candidate: Candidate): Promise<ValidationResult> {
    if (candidate.document) {
      const byDocument = await this.searchByDocument(candidate.document);
      const documentMatches = byDocument.filter((row) => candidateDocumentMatches(candidate, row));
      const nameAndDocumentMatches = documentMatches.filter((row) =>
        candidateNameMatches(candidate, row, this.config.matchMode)
      );

      if (nameAndDocumentMatches.length === 1) {
        return {
          candidate,
          status: "MATCH",
          matched: true,
          reason: "Documento, nombre y apellido coinciden.",
          foundCount: byDocument.length,
          found: nameAndDocumentMatches[0]
        };
      }

      if (nameAndDocumentMatches.length > 1) {
        return {
          candidate,
          status: "MULTIPLE_MATCHES",
          matched: false,
          reason: "Hay mas de un candidato con el mismo documento y nombre/apellido.",
          foundCount: nameAndDocumentMatches.length,
          found: nameAndDocumentMatches[0]
        };
      }

      if (documentMatches.length > 0) {
        return {
          candidate,
          status: "NAME_MISMATCH",
          matched: false,
          reason: "El documento existe, pero nombre/apellido no coinciden.",
          foundCount: documentMatches.length,
          found: documentMatches[0]
        };
      }
    }

    const byName = await this.searchByName(candidate);
    const nameMatches = byName.filter((row) => candidateNameMatches(candidate, row, this.config.matchMode));
    const exactMatches = nameMatches.filter((row) => {
      return !candidate.document || normalizeDocument(row.document) === candidate.document;
    });

    if (exactMatches.length === 1) {
      return {
        candidate,
        status: "MATCH",
        matched: true,
        reason: "Nombre/apellido coinciden. Documento no fue usado o tambien coincide.",
        foundCount: byName.length,
        found: exactMatches[0]
      };
    }

    if (exactMatches.length > 1) {
      return {
        candidate,
        status: "MULTIPLE_MATCHES",
        matched: false,
        reason: "Hay mas de un candidato que coincide con los datos esperados.",
        foundCount: exactMatches.length,
        found: exactMatches[0]
      };
    }

    if (nameMatches.length > 0 && candidate.document) {
      return {
        candidate,
        status: "DOCUMENT_MISMATCH",
        matched: false,
        reason: "Nombre/apellido existen, pero el documento no coincide.",
        foundCount: nameMatches.length,
        found: nameMatches[0]
      };
    }

    return {
      candidate,
      status: "NOT_FOUND",
      matched: false,
      reason: "No se encontro por documento ni por nombre/apellido.",
      foundCount: byName.length
    };
  }

  private async createDriver(): Promise<WebDriver> {
    const seleniumBrowser = this.config.browser === "edge" ? Browser.EDGE : this.config.browser;
    const builder = new Builder().forBrowser(seleniumBrowser);

    if (this.config.browser === "chrome") {
      const options = new chrome.Options();
      options.addArguments("--window-size=1440,1000");
      if (this.config.headless) {
        options.addArguments("--headless=new", "--disable-gpu");
      }
      builder.setChromeOptions(options);
    }

    if (this.config.browser === "edge") {
      const options = new edge.Options();
      options.addArguments("--window-size=1440,1000");
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

  private async openMenuIfNeeded(): Promise<void> {
    const candidatosLocator = this.menuTextLocator("Candidatos");
    if (await this.isDisplayed(candidatosLocator)) {
      return;
    }

    await this.click(By.id("MENUTOGGLE_MPAGE"), 8000);
    await this.waitForDisplayed(candidatosLocator, this.config.timeoutMs);
  }

  private async clickMenuItem(text: string, timeoutMs = this.config.timeoutMs): Promise<void> {
    const element = await this.waitForDisplayed(this.menuTextLocator(text), timeoutMs);
    const clickable = await this.closestClickable(element);
    await this.clickElement(clickable);
    await this.waitForReady(timeoutMs);
  }

  private menuTextLocator(text: string): By {
    return By.xpath(`//span[normalize-space(.)=${this.xpathLiteral(text)}] | //a[normalize-space(.)=${this.xpathLiteral(text)}]`);
  }

  private async closestClickable(element: WebElement): Promise<WebElement> {
    const driver = this.requireDriver();
    return (await driver.executeScript(
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

  private async searchByDocument(document: string): Promise<SugusGridRow[]> {
    await this.ensureAdvancedFiltersVisible();
    await this.clearFilters();
    await this.typeById("vCANDOCNRO_FILTRO", document);
    await this.submitSearch();
    return this.readGridRows();
  }

  private async searchByName(candidate: Candidate): Promise<SugusGridRow[]> {
    await this.ensureAdvancedFiltersVisible();
    await this.clearFilters();
    await this.typeById("vCANNOM_FILTRO", candidate.firstName);
    await this.typeById("vCANAPE_FILTRO", candidate.firstSurname);
    await this.submitSearch();
    return this.readGridRows();
  }

  private async clearFilters(): Promise<void> {
    await this.clearInputIfPresent("vK2BTOOLSGENERICSEARCHFIELD");
    await this.clearInputIfPresent("vCANNOM_FILTRO");
    await this.clearInputIfPresent("vCANAPE_FILTRO");
    await this.clearInputIfPresent("vCANDOCNRO_FILTRO");
    await this.clearInputIfPresent("vEMAILFILTRO");
  }

  private async submitSearch(): Promise<void> {
    await this.click(By.id("SEARCHBUTTON"));
    await this.waitForReady();
    await sleep(this.config.waitMs);
  }

  private async ensureAdvancedFiltersVisible(): Promise<void> {
    const visible = await this.isDisplayed(By.id("vCANDOCNRO_FILTRO"));
    if (!visible) {
      await this.click(By.id("FILTERTOGGLE_COMBINED"));
      await this.waitForDisplayed(By.id("vCANDOCNRO_FILTRO"), this.config.timeoutMs);
    }
  }

  private async readGridRows(): Promise<SugusGridRow[]> {
    const driver = this.requireDriver();
    await this.waitForReady();
    return (await driver.executeScript(`
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const pick = (row, selector) => {
        const node = row.querySelector(selector);
        return normalize(node ? node.textContent : '');
      };
      return Array.from(document.querySelectorAll('tr[id^="GridContainerRow_"]')).map((row) => ({
        candidateCode: pick(row, '[id^="span_CANCOD_"]'),
        firstNames: pick(row, '[id^="span_CANNOMBRES_"]'),
        lastNames: pick(row, '[id^="span_CANAPELLID_"]'),
        documentType: pick(row, '[id^="span_DOCNOMABR_"]'),
        document: pick(row, '[id^="span_CANDOCNRO_"], [id^="span_vNRODOCUMENTO_"]'),
        email: pick(row, '[id^="span_vEMAIL_"]'),
        legajos: pick(row, '[id^="span_vLEGAJOSN_"]')
      }));
    `)) as SugusGridRow[];
  }

  private async typeById(id: string, value: string): Promise<void> {
    const element = await this.waitForDisplayed(By.id(id), this.config.timeoutMs);
    await this.setInputValue(element, value);
  }

  private async clearInputIfPresent(id: string): Promise<void> {
    const elements = await this.requireDriver().findElements(By.id(id));
    if (elements.length === 0) {
      return;
    }
    if (!(await this.elementIsDisplayed(elements[0]))) {
      return;
    }
    await this.setInputValue(elements[0], "");
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

  private async optionalClick(by: By, timeoutMs: number): Promise<boolean> {
    try {
      await this.click(by, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  private async saveDiagnostic(name: string): Promise<string> {
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

  private async clickElement(element: WebElement): Promise<void> {
    const driver = this.requireDriver();
    await driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });", element);
    try {
      await element.click();
    } catch {
      await driver.executeScript("arguments[0].click();", element);
    }
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

  private requireDriver(): WebDriver {
    if (!this.driver) {
      throw new Error("El driver no fue inicializado.");
    }
    return this.driver;
  }
}
